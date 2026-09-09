"""委派的运行隔离、协作取消、技能权限与跨 Agent 产物传递。"""

import copy
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest

from app.core.agent.agent import Agent
from app.core.agent.delegation_runtime import DelegationRuntime, LinkedCancellation
from app.core.agent.executor import AgentCancelledError
from app.core.skills.manager import SkillManager
from app.core.tools.base_tool import BaseTool, ToolResult
from app.core.tools.read_skill import ReadSkillTool


class ScriptedModel:
    def __init__(self, calls):
        self.calls = calls
        self.requests = []

    def call_stream(self, request):
        self.requests.append(copy.deepcopy(request))
        if len(self.requests) == 1:
            yield {
                "choices": [
                    {
                        "delta": {
                            "tool_calls": [
                                {
                                    "index": index,
                                    "id": f"call-{index}",
                                    "function": {
                                        "name": name,
                                        "arguments": json.dumps(arguments),
                                    },
                                }
                                for index, (name, arguments) in enumerate(self.calls)
                            ]
                        },
                        "finish_reason": "tool_calls",
                    }
                ]
            }
        else:
            yield {"choices": [{"delta": {"content": "done"}, "finish_reason": "stop"}]}


def test_linked_cancellation_wakes_on_parent_and_does_not_cancel_siblings():
    parent = threading.Event()
    first = LinkedCancellation(parent)
    second = LinkedCancellation(parent)
    first.set()
    assert first.wait(0)
    assert not parent.is_set()
    assert not second.is_set()

    with ThreadPoolExecutor(max_workers=1) as pool:
        waiting = pool.submit(second.wait)
        parent.set()
        assert waiting.result(timeout=1)
    assert not second.timed_out


def test_linked_deadline_starts_at_creation_and_wait_timeout_is_not_cancellation():
    token = LinkedCancellation(timeout_seconds=0.02)
    assert not token.wait(0)
    assert not token.is_set()
    assert token.wait(1)
    assert token.timed_out
    assert LinkedCancellation(timeout_seconds=0).timed_out


def test_linked_cancellation_cascades_through_multiple_levels():
    parent = LinkedCancellation()
    child = LinkedCancellation(parent)
    grandchild = LinkedCancellation(child)
    parent.set()
    assert grandchild.wait(0)


def test_shared_capacity_is_bounded_and_reusable():
    runtime = DelegationRuntime(2)
    assert runtime.slots.acquire(blocking=False)
    assert runtime.slots.acquire(blocking=False)
    assert not runtime.slots.acquire(blocking=False)
    runtime.slots.release()
    assert runtime.slots.acquire(blocking=False)
    runtime.slots.release()
    runtime.slots.release()
    with pytest.raises(ValueError):
        runtime.slots.release()
    with pytest.raises(ValueError, match="positive"):
        DelegationRuntime(0)


@pytest.mark.parametrize("cancelled", [False, True])
def test_agent_run_shares_runtime_with_parallel_tools_and_restores_context(cancelled):
    observations = []
    token = threading.Event()

    class InspectContextTool(BaseTool):
        name = "inspect"

        def execute(self, params):
            observations.append(self.delegation_runtime)
            assert self.context.delegation_runtime is self.delegation_runtime
            assert self.cancel_event is self.context.active_cancel_event is token
            assert self.thinking_enabled is self.context.active_thinking_enabled is True
            assert self.context.active_skill_filter == set()
            if cancelled:
                raise AgentCancelledError("stopped inside tool")
            return ToolResult.success("ok")

    agent = Agent(
        "system",
        model=ScriptedModel([("inspect", {}), ("inspect", {})]),
        tools=[InspectContextTool()],
        settings=SimpleNamespace(multi_agent_max_parallel_agents=2),
    )
    previous_token = threading.Event()
    previous_runtime = DelegationRuntime(1)
    agent.active_skill_filter = {"previous"}
    agent.active_cancel_event = previous_token
    agent.delegation_runtime = previous_runtime
    if cancelled:
        with pytest.raises(AgentCancelledError, match="stopped inside tool"):
            agent.run_stream("run", cancel_event=token, thinking_enabled=True, skill_filter=[])
    else:
        assert (
            agent.run_stream("run", cancel_event=token, thinking_enabled=True, skill_filter=[])
            == "done"
        )
    assert len(observations) == 2
    assert observations[0] is observations[1]
    assert observations[0] is not previous_runtime
    assert agent.active_skill_filter == {"previous"}
    assert agent.active_cancel_event is previous_token
    assert agent.active_thinking_enabled is False
    assert agent.delegation_runtime is previous_runtime


@pytest.mark.parametrize("mode", ["raise", "return_success", "return_error"])
def test_cancellation_inside_tool_never_finishes_parent_successfully(mode):
    token = threading.Event()
    events = []

    class CancellingTool(BaseTool):
        name = "stop"

        def execute(self, params):
            if mode == "raise":
                raise AgentCancelledError("cancelled")
            self.cancel_event.set()
            if mode == "return_error":
                raise RuntimeError("upstream interrupted")
            return ToolResult.success("late result")

    model = ScriptedModel([("stop", {})])
    agent = Agent("system", model=model, tools=[CancellingTool()])
    with pytest.raises(AgentCancelledError):
        agent.run_stream("stop", cancel_event=token, on_event=events.append)
    assert len(model.requests) == 1
    assert not any(event["type"] == "agent_end" for event in events)
    tool_end = next(event for event in events if event["type"] == "tool_execution_end")
    assert tool_end["data"]["status"] == "cancelled"


@pytest.fixture
def skill_manager(tmp_path):
    builtin = tmp_path / "builtin"
    skill = builtin / "demo"
    skill.mkdir(parents=True)
    (skill / "SKILL.md").write_text(
        "---\nname: demo\ndescription: Demonstration\n---\nPrivate skill body\n",
        encoding="utf-8",
    )
    return SkillManager(builtin_dir=str(builtin), custom_dir=str(tmp_path / "custom"))


def test_empty_skill_filter_means_no_skills_in_index_and_snapshot(skill_manager):
    assert len(skill_manager.filter_skills()) == 1
    assert skill_manager.filter_skills([]) == []
    assert not skill_manager.build_skills_prompt([])
    assert skill_manager.build_skill_snapshot([]).resolved_skills == []


@pytest.mark.parametrize("skill_filter,permitted", [(None, True), ([], False), (["demo"], True)])
def test_read_skill_obeys_parent_run_filter(skill_manager, skill_filter, permitted):
    model = ScriptedModel([("read_skill", {"skill_name": "demo"})])
    agent = Agent("system", model=model, tools=[ReadSkillTool()], skill_manager=skill_manager)
    assert agent.run_stream("load demo", skill_filter=skill_filter) == "done"
    tool_result = model.requests[1].messages[-1]["content"][0]
    assert ("Private skill body" in tool_result["content"]) is permitted
    assert bool(tool_result.get("is_error")) is not permitted


def test_successful_tool_artifacts_propagate_to_parent_without_duplicates_or_private_payloads():
    first = {
        "artifact_id": "one",
        "width": 2400,
        "height": 3000,
        "files": {"image": "artifacts/renderings/one/image.png"},
        "html": "private markup",
    }
    second = {"artifact_id": "two", "files": {"image": "artifacts/renderings/two/image.png"}}

    class RenderTool(BaseTool):
        name = "render_image"

        def execute(self, params):
            return ToolResult.success(first)

    class DelegateTool(BaseTool):
        name = "delegate_agent"

        def execute(self, params):
            return ToolResult.success(
                {"results": []},
                ext_data={"rendered_images": [first, second, second, None, {"width": 100}]},
            )

    class FailedTool(BaseTool):
        name = "failed"

        def execute(self, params):
            return ToolResult.fail("failed", ext_data={"rendered_images": [{"artifact_id": "bad"}]})

    model = ScriptedModel([("render_image", {}), ("delegate_agent", {}), ("failed", {})])
    agent = Agent("system", model=model, tools=[RenderTool(), DelegateTool(), FailedTool()])
    assert agent.run_stream("draw") == "done"
    assert [artifact["artifact_id"] for artifact in agent.last_rendered_images] == ["one", "two"]
    assert "private markup" not in json.dumps(agent.last_rendered_images)
    first["files"]["image"] = "mutated"
    second["files"]["image"] = "mutated"
    assert "mutated" not in json.dumps(agent.last_rendered_images)


def test_cancelled_child_keeps_completed_evidence_and_artifacts():
    metadata = {
        "evidence": [{"id": "evidence-one"}],
        "sources": [{"id": "source-one"}],
        "rendered_images": [{"artifact_id": "one"}],
    }

    class ResearchTool(BaseTool):
        name = "research"

        def execute(self, params):
            return ToolResult.success("verified finding", ext_data=metadata)

    class CancelledModel(ScriptedModel):
        def call_stream(self, request):
            if self.requests:
                raise AgentCancelledError("stopped before synthesis")
            yield from super().call_stream(request)

    model = CancelledModel([("research", {})])
    agent = Agent("system", model=model, tools=[ResearchTool()])
    with pytest.raises(AgentCancelledError, match="before synthesis"):
        agent.run_stream("research")
    assert agent.last_evidence == metadata["evidence"]
    assert agent.last_sources == metadata["sources"]
    assert agent.last_rendered_images == metadata["rendered_images"]


def test_parallel_cancellation_preserves_metadata_of_already_completed_tool():
    completed = threading.Event()
    metadata = {
        "evidence": [{"id": "evidence-one"}],
        "sources": [{"id": "source-one"}],
        "rendered_images": [{"artifact_id": "one"}],
    }

    class ResearchTool(BaseTool):
        name = "research"

        def execute(self, params):
            return ToolResult.success("verified finding", ext_data=metadata)

    class CancelTool(BaseTool):
        name = "cancel"

        def execute(self, params):
            assert completed.wait(1)
            raise AgentCancelledError("other task cancelled")

    def on_event(event):
        if event["type"] == "tool_execution_end" and event["data"]["tool_name"] == "research":
            completed.set()

    model = ScriptedModel([("research", {}), ("cancel", {})])
    agent = Agent("system", model=model, tools=[ResearchTool(), CancelTool()])
    with pytest.raises(AgentCancelledError, match="other task cancelled"):
        agent.run_stream("research", on_event=on_event)
    assert agent.last_evidence == metadata["evidence"]
    assert agent.last_sources == metadata["sources"]
    assert agent.last_rendered_images == metadata["rendered_images"]


def test_cancellation_at_tool_completion_keeps_metadata_without_emitting_success():
    token = threading.Event()
    events = []
    metadata = {
        "evidence": [{"id": "evidence-one"}],
        "sources": [{"id": "source-one"}],
        "rendered_images": [{"artifact_id": "one"}],
    }

    class ResearchTool(BaseTool):
        name = "research"

        def execute(self, params):
            token.set()
            return ToolResult.success("completed just before cancellation", ext_data=metadata)

    agent = Agent("system", model=ScriptedModel([("research", {})]), tools=[ResearchTool()])
    with pytest.raises(AgentCancelledError):
        agent.run_stream("research", cancel_event=token, on_event=events.append)
    assert agent.last_evidence == metadata["evidence"]
    assert agent.last_sources == metadata["sources"]
    assert agent.last_rendered_images == metadata["rendered_images"]
    tool_events = [event for event in events if event["type"] == "tool_execution_end"]
    assert len(tool_events) == 1
    assert tool_events[0]["data"]["status"] == "cancelled"


def test_delegation_cancellation_exception_keeps_completed_child_metadata():
    events = []
    metadata = {
        "evidence": [{"id": "evidence-one"}],
        "sources": [{"id": "source-one"}],
        "rendered_images": [{"artifact_id": "one"}],
    }

    class DelegateTool(BaseTool):
        name = "delegate_agent"

        def execute(self, params):
            error = AgentCancelledError("parent stopped with completed child work")
            error.metadata = metadata
            raise error

    agent = Agent("system", model=ScriptedModel([("delegate_agent", {})]), tools=[DelegateTool()])
    with pytest.raises(AgentCancelledError, match="completed child work"):
        agent.run_stream("research", on_event=events.append)
    assert agent.last_evidence == metadata["evidence"]
    assert agent.last_sources == metadata["sources"]
    assert agent.last_rendered_images == metadata["rendered_images"]
    assert not any(event["type"] == "agent_end" for event in events)
    tool_events = [event for event in events if event["type"] == "tool_execution_end"]
    assert len(tool_events) == 1
    assert tool_events[0]["data"]["status"] == "cancelled"
