import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.core.session import ChatSessionStore
from app.core.tools.base_tool import BaseTool, ToolResult
from app.core.tools.delegate_agent import DelegateAgentTool
from app.core.tracing import TraceRecorder, TraceStore


class NamedTool(BaseTool):
    def __init__(self, name: str):
        self.name = name
        self.description = name
        self.params = {"type": "object", "properties": {}}

    def execute(self, params: dict) -> ToolResult:
        return ToolResult.success(f"{self.name} ok")


class FakeParentAgent:
    def __init__(self, tools=None, depth=0):
        self.model = object()
        self.tools = tools or [NamedTool("web_fetch"), NamedTool("bash"), NamedTool("delegate_agent")]
        self.max_context_tokens = 50_000
        self.max_context_turns = 20
        self.memory_manager = None
        self.workspace_dir = "."
        self.skill_manager = None
        self.enable_skills = True
        self.multi_agent_depth = depth


class FakeAgent:
    def __init__(self, *args, **kwargs):
        self.tools = kwargs.get("tools") or []
        self.multi_agent_depth = kwargs.get("multi_agent_depth", 0)

    def run_stream(self, user_message: str, on_event=None, clear_history=False, skill_filter=None):
        if "slow" in user_message:
            time.sleep(0.02)
        if on_event:
            on_event({"type": "agent_start", "timestamp": time.time(), "data": {}})
            on_event({"type": "message_update", "timestamp": time.time(), "data": {"delta": f"child:{user_message}"}})
            on_event({"type": "message_end", "timestamp": time.time(), "data": {"content": f"child:{user_message}"}})
            on_event({"type": "agent_end", "timestamp": time.time(), "data": {"final_response": f"done:{user_message}"}})
        return f"done:{user_message}"


def fake_settings(**overrides):
    roles = {
        "researcher": {
            "description": "Research",
            "system_prompt": "Research.",
            "tool_allowlist": ["web_fetch"],
            "max_steps": 4,
            "allow_dangerous_tools": False,
        },
        "danger": {
            "description": "Danger",
            "system_prompt": "Danger.",
            "tool_allowlist": ["bash", "delegate_agent"],
            "max_steps": 4,
            "allow_dangerous_tools": False,
        },
    }
    base = {
        "multi_agent_enabled": True,
        "multi_agent_max_parallel_agents": 3,
        "multi_agent_default_max_steps": 8,
        "multi_agent_max_depth": 1,
        "multi_agent_dangerous_tools": ["bash", "write_file", "scheduler"],
        "multi_agent_roles": roles,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


class DelegateAgentToolTest(unittest.TestCase):
    def run_tool(self, params, settings=None, parent=None):
        tool = DelegateAgentTool()
        tool.context = parent or FakeParentAgent()
        events = []
        tool.event_emitter = lambda event_type, data: events.append({"type": event_type, "data": data})
        tool.current_tool_call = {"id": "parent-tool", "name": "delegate_agent"}
        with patch("app.core.agent.subagent.get_settings", return_value=settings or fake_settings()):
            with patch("app.core.agent.subagent.Agent", FakeAgent):
                result = tool.execute(params)
        return result, events

    def test_disabled_returns_error(self):
        result, _events = self.run_tool(
            {"tasks": [{"role": "researcher", "task": "test", "tools": ["web_fetch"]}]},
            settings=fake_settings(multi_agent_enabled=False),
        )
        self.assertEqual(result.status, "error")
        self.assertIn("disabled", result.result)

    def test_rejects_unknown_role_and_tool_policy_violations(self):
        result, _ = self.run_tool({"tasks": [{"role": "missing", "task": "test"}]})
        self.assertEqual(result.status, "error")
        self.assertIn("Unknown sub-agent role", result.result)

        result, _ = self.run_tool({"tasks": [{"role": "researcher", "task": "test", "tools": ["unknown"]}]})
        self.assertEqual(result.status, "error")
        self.assertIn("Unknown tool", result.result)

        result, _ = self.run_tool({"tasks": [{"role": "researcher", "task": "test", "tools": ["bash"]}]})
        self.assertEqual(result.status, "error")
        self.assertIn("not allowed", result.result)

        result, _ = self.run_tool({"tasks": [{"role": "danger", "task": "test", "tools": ["bash"]}]})
        self.assertEqual(result.status, "error")
        self.assertIn("Dangerous tool", result.result)

    def test_rejects_too_many_tasks_and_delegate_tool(self):
        tasks = [{"role": "researcher", "task": f"task {idx}", "tools": ["web_fetch"]} for idx in range(4)]
        result, _ = self.run_tool({"tasks": tasks})
        self.assertEqual(result.status, "error")
        self.assertIn("maximum is 3", result.result)

        result, _ = self.run_tool({"tasks": [{"role": "danger", "task": "test", "tools": ["delegate_agent"]}]})
        self.assertEqual(result.status, "error")
        self.assertIn("cannot receive", result.result)

    def test_parallel_results_preserve_input_order_and_wrap_child_messages(self):
        result, events = self.run_tool({
            "tasks": [
                {"id": "slow", "role": "researcher", "task": "slow task", "tools": ["web_fetch"]},
                {"id": "fast", "role": "researcher", "task": "fast task", "tools": ["web_fetch"]},
            ],
        })
        self.assertEqual(result.status, "success")
        responses = [item["final_response"] for item in result.result["results"]]
        self.assertEqual(responses, ["done:slow task", "done:fast task"])
        event_types = [event["type"] for event in events]
        self.assertIn("subagent_event", event_types)
        self.assertNotIn("message_update", event_types)


class SubAgentTraceTest(unittest.TestCase):
    def test_trace_records_subagent_tree(self):
        with tempfile.TemporaryDirectory() as tmp:
            session = ChatSessionStore(tmp).create_session(title="trace")
            store = TraceStore(tmp)
            recorder = TraceRecorder.start(store, session_id=session["id"], user_message="analyze")

            recorder.handle_event({"type": "turn_start", "timestamp": 1.0, "data": {"turn": 1}})
            recorder.handle_event({
                "type": "tool_execution_start",
                "timestamp": 1.1,
                "data": {"tool_call_id": "parent-tool", "tool_name": "delegate_agent", "arguments": {}},
            })
            recorder.handle_event({
                "type": "subagent_batch_start",
                "timestamp": 1.2,
                "data": {"batch_id": "batch-1", "task_count": 1, "parent_tool_call_id": "parent-tool"},
            })
            recorder.handle_event({
                "type": "subagent_start",
                "timestamp": 1.3,
                "data": {"batch_id": "batch-1", "task_id": "t1", "role": "researcher", "task": "research"},
            })
            recorder.handle_event({
                "type": "subagent_event",
                "timestamp": 1.4,
                "data": {
                    "batch_id": "batch-1",
                    "task_id": "t1",
                    "role": "researcher",
                    "child_event_type": "message_update",
                    "child_timestamp": 1.4,
                    "child_data": {"delta": "hello"},
                },
            })
            recorder.handle_event({
                "type": "subagent_event",
                "timestamp": 1.5,
                "data": {
                    "batch_id": "batch-1",
                    "task_id": "t1",
                    "role": "researcher",
                    "child_event_type": "message_end",
                    "child_timestamp": 1.5,
                    "child_data": {"content": "hello"},
                },
            })
            recorder.handle_event({
                "type": "subagent_end",
                "timestamp": 1.6,
                "data": {"batch_id": "batch-1", "task_id": "t1", "role": "researcher", "status": "success", "final_response": "hello"},
            })
            recorder.handle_event({
                "type": "subagent_batch_end",
                "timestamp": 1.7,
                "data": {"batch_id": "batch-1", "status": "success", "duration_ms": 500},
            })
            recorder.handle_event({
                "type": "tool_execution_end",
                "timestamp": 1.8,
                "data": {"tool_call_id": "parent-tool", "tool_name": "delegate_agent", "status": "success", "result": {}, "execution_time": 0.7},
            })
            recorder.finish(status="done", final_response="final")

            run = store.get_session_traces(session_id=session["id"], limit=1)["runs"][0]
            events = run["events"]
            by_type = {event["node_type"]: event for event in events}
            self.assertIn("subagent_batch", by_type)
            self.assertIn("subagent", by_type)
            self.assertIn("subagent_message_delta", by_type)
            self.assertEqual(by_type["subagent"]["parent_id"], by_type["subagent_batch"]["id"])


if __name__ == "__main__":
    unittest.main()
