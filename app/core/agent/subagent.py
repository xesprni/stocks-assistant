"""Sub-agent orchestration helpers for delegate_agent."""

from __future__ import annotations

import copy
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Any, Callable, Optional

from app.config import get_settings
from app.core.agent.agent import Agent
from app.core.tools.base_tool import BaseTool


class SubAgentValidationError(ValueError):
    """Raised when a delegate_agent request violates policy."""


@dataclass
class PreparedSubAgentTask:
    index: int
    task_id: str
    role_name: str
    role: dict[str, Any]
    task: str
    tools: list[BaseTool]
    tool_names: list[str]
    max_steps: int
    skill_filter: Optional[list[str]]


class SubAgentRunner:
    """Run a bounded batch of isolated child Agents."""

    def __init__(
        self,
        parent_agent: Agent,
        event_emitter: Optional[Callable[[str, dict[str, Any]], None]] = None,
        parent_tool_call_id: Optional[str] = None,
    ):
        self.parent_agent = parent_agent
        self.event_emitter = event_emitter
        self.parent_tool_call_id = parent_tool_call_id
        self.settings = get_settings()

    def run_batch(self, raw_tasks: Any) -> dict[str, Any]:
        if not self.settings.multi_agent_enabled:
            raise SubAgentValidationError("Multi-agent delegation is disabled")

        parent_depth = int(getattr(self.parent_agent, "multi_agent_depth", 0) or 0)
        max_depth = max(0, int(self.settings.multi_agent_max_depth or 0))
        if parent_depth >= max_depth:
            raise SubAgentValidationError("Sub-agents cannot call delegate_agent")

        if not isinstance(raw_tasks, list) or not raw_tasks:
            raise SubAgentValidationError("tasks must be a non-empty array")

        max_parallel = max(1, int(self.settings.multi_agent_max_parallel_agents or 1))
        if len(raw_tasks) > max_parallel:
            raise SubAgentValidationError(f"Too many sub-agent tasks: maximum is {max_parallel}")

        prepared = [self._prepare_task(index, item) for index, item in enumerate(raw_tasks)]
        batch_id = f"subagents_{uuid.uuid4().hex[:12]}"

        self._emit("subagent_batch_start", {
            "batch_id": batch_id,
            "task_count": len(prepared),
            "roles": [task.role_name for task in prepared],
            "parent_tool_call_id": self.parent_tool_call_id,
        })

        started = time.time()
        results: list[Optional[dict[str, Any]]] = [None] * len(prepared)
        with ThreadPoolExecutor(max_workers=min(max_parallel, len(prepared)), thread_name_prefix="subagent") as executor:
            future_map = {executor.submit(self._run_one, batch_id, task): task.index for task in prepared}
            for future in as_completed(future_map):
                index = future_map[future]
                try:
                    results[index] = future.result()
                except Exception as exc:
                    task = prepared[index]
                    results[index] = {
                        "task_id": task.task_id,
                        "role": task.role_name,
                        "status": "error",
                        "final_response": "",
                        "duration_ms": 0,
                        "error": str(exc),
                    }

        final_results = [result for result in results if result is not None]
        status = "success" if all(result.get("status") == "success" for result in final_results) else "partial_error"
        duration_ms = (time.time() - started) * 1000
        self._emit("subagent_batch_end", {
            "batch_id": batch_id,
            "status": status,
            "duration_ms": duration_ms,
            "result_count": len(final_results),
            "parent_tool_call_id": self.parent_tool_call_id,
        })
        return {
            "batch_id": batch_id,
            "status": status,
            "duration_ms": duration_ms,
            "results": final_results,
        }

    def _prepare_task(self, index: int, item: Any) -> PreparedSubAgentTask:
        if not isinstance(item, dict):
            raise SubAgentValidationError(f"Task #{index + 1} must be an object")

        task_text = str(item.get("task") or "").strip()
        if not task_text:
            raise SubAgentValidationError(f"Task #{index + 1} is missing task")

        role_name = str(item.get("role") or "").strip()
        roles = self.settings.multi_agent_roles or {}
        role = roles.get(role_name)
        if not role_name or not isinstance(role, dict):
            available = ", ".join(sorted(roles.keys())) or "(none)"
            raise SubAgentValidationError(f"Unknown sub-agent role: {role_name or '(empty)'}. Available: {available}")

        available_tools = {tool.name: tool for tool in getattr(self.parent_agent, "tools", [])}
        requested_tools = self._coerce_tool_names(item.get("tools"))
        role_allowlist = self._coerce_tool_names(role.get("tool_allowlist"), allow_none=False)
        role_allowed = set(role_allowlist)
        dangerous_tools = set(str(name) for name in (self.settings.multi_agent_dangerous_tools or []))
        allow_dangerous = bool(role.get("allow_dangerous_tools", False))

        if requested_tools is None:
            selected_names = [name for name in role_allowlist if name in available_tools]
        else:
            selected_names = requested_tools

        unknown = [name for name in selected_names if name not in available_tools]
        if unknown:
            raise SubAgentValidationError(f"Unknown tool(s) for sub-agent: {', '.join(unknown)}")

        not_allowed = [name for name in selected_names if name not in role_allowed]
        if not_allowed:
            raise SubAgentValidationError(
                f"Tool(s) not allowed for role {role_name}: {', '.join(not_allowed)}"
            )

        if "delegate_agent" in selected_names:
            raise SubAgentValidationError("Sub-agents cannot receive the delegate_agent tool")

        dangerous = [name for name in selected_names if name in dangerous_tools]
        if dangerous and not allow_dangerous:
            raise SubAgentValidationError(
                f"Dangerous tool(s) are disabled for role {role_name}: {', '.join(dangerous)}"
            )

        role_max_steps = self._as_positive_int(role.get("max_steps"), self.settings.multi_agent_default_max_steps)
        requested_steps = self._as_positive_int(item.get("max_steps"), role_max_steps)
        max_steps = max(1, min(requested_steps, role_max_steps))
        skill_filter = self._coerce_string_list(item.get("skill_filter"))

        task_id = str(item.get("id") or f"task_{index + 1}").strip() or f"task_{index + 1}"
        child_tools = [self._clone_tool(available_tools[name]) for name in selected_names]
        return PreparedSubAgentTask(
            index=index,
            task_id=task_id,
            role_name=role_name,
            role=role,
            task=task_text,
            tools=child_tools,
            tool_names=selected_names,
            max_steps=max_steps,
            skill_filter=skill_filter,
        )

    def _run_one(self, batch_id: str, task: PreparedSubAgentTask) -> dict[str, Any]:
        started = time.time()
        self._emit("subagent_start", {
            "batch_id": batch_id,
            "task_id": task.task_id,
            "role": task.role_name,
            "task": task.task,
            "tools": task.tool_names,
            "max_steps": task.max_steps,
        })

        status = "success"
        final_response = ""
        error = None
        try:
            child_agent = Agent(
                system_prompt=str(task.role.get("system_prompt") or ""),
                model=self.parent_agent.model,
                tools=task.tools,
                max_steps=task.max_steps,
                max_context_tokens=self.parent_agent.max_context_tokens,
                max_context_turns=self.parent_agent.max_context_turns,
                memory_manager=self.parent_agent.memory_manager,
                workspace_dir=self.parent_agent.workspace_dir,
                skill_manager=self.parent_agent.skill_manager,
                enable_skills=self.parent_agent.enable_skills,
                multi_agent_depth=int(getattr(self.parent_agent, "multi_agent_depth", 0) or 0) + 1,
            )
            final_response = child_agent.run_stream(
                user_message=task.task,
                on_event=self._child_event_wrapper(batch_id, task),
                clear_history=True,
                skill_filter=task.skill_filter,
            )
        except Exception as exc:
            status = "error"
            error = str(exc)
        duration_ms = (time.time() - started) * 1000
        result = {
            "task_id": task.task_id,
            "role": task.role_name,
            "status": status,
            "final_response": final_response,
            "duration_ms": duration_ms,
        }
        if error:
            result["error"] = error
        self._emit("subagent_end", {
            "batch_id": batch_id,
            "task_id": task.task_id,
            "role": task.role_name,
            "status": status,
            "duration_ms": duration_ms,
            "final_response": final_response,
            "error": error,
        })
        return result

    def _child_event_wrapper(self, batch_id: str, task: PreparedSubAgentTask):
        def on_child_event(event: dict[str, Any]) -> None:
            self._emit("subagent_event", {
                "batch_id": batch_id,
                "task_id": task.task_id,
                "role": task.role_name,
                "child_event_type": event.get("type"),
                "child_timestamp": event.get("timestamp"),
                "child_data": event.get("data") or {},
            })

        return on_child_event

    def _emit(self, event_type: str, data: dict[str, Any]) -> None:
        if not self.event_emitter:
            return
        self.event_emitter(event_type, data)

    @staticmethod
    def _clone_tool(tool: BaseTool) -> BaseTool:
        try:
            cloned = tool.__class__()
        except Exception:
            cloned = copy.copy(tool)
        if hasattr(tool, "config"):
            cloned.config = copy.deepcopy(getattr(tool, "config"))
        for attr in ("workspace_dir", "cwd", "default_timeout", "task_store"):
            if hasattr(tool, attr):
                setattr(cloned, attr, getattr(tool, attr))
        cloned.model = None
        if hasattr(cloned, "context"):
            cloned.context = None
        if hasattr(cloned, "event_emitter"):
            cloned.event_emitter = None
        return cloned

    @staticmethod
    def _coerce_tool_names(value: Any, allow_none: bool = True) -> Optional[list[str]]:
        if value is None:
            return None if allow_none else []
        if not isinstance(value, list):
            raise SubAgentValidationError("tools must be an array of tool names")
        names = []
        for item in value:
            name = str(item or "").strip()
            if name:
                names.append(name)
        return names

    @staticmethod
    def _coerce_string_list(value: Any) -> Optional[list[str]]:
        if value is None:
            return None
        if not isinstance(value, list):
            raise SubAgentValidationError("skill_filter must be an array of skill names")
        return [str(item).strip() for item in value if str(item).strip()]

    @staticmethod
    def _as_positive_int(value: Any, default: Any) -> int:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            parsed = int(default or 1)
        return max(1, parsed)
