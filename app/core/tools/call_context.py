"""单次工具调用的显式能力与旧工具兼容边界。"""

from __future__ import annotations

import copy
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol


class CancellationSignal(Protocol):
    def is_set(self) -> bool: ...


class AgentCancelledError(RuntimeError):
    """工具和 Agent 共用的停止信号，不作为普通失败重试。"""


@dataclass(frozen=True)
class ToolCallContext:
    tool_call_id: str = ""
    tool_name: str = ""
    cancel_event: CancellationSignal | None = None
    event_emitter: Callable[[str, dict[str, Any] | None], None] | None = None
    thinking_enabled: bool = False
    model: Any = None
    memory_manager: Any = None
    skill_manager: Any = None
    skill_filter: frozenset[str] | None = None
    delegation_runtime: Any = None
    # 只有委派适配器和旧工具使用父 Agent；普通内置工具使用上面的窄能力。
    parent_agent: Any = None
    user_id: str | None = None
    settings: Any = None
    workspace_dir: str | None = None

    def raise_if_cancelled(self) -> None:
        if self.cancel_event is not None and self.cancel_event.is_set():
            raise AgentCancelledError("Agent run cancelled")

    @classmethod
    def from_legacy_tool(cls, tool: Any) -> ToolCallContext:
        parent = getattr(tool, "context", None)
        call = getattr(tool, "current_tool_call", None) or {}
        skill_filter = getattr(parent, "active_skill_filter", None)
        return cls(
            tool_call_id=call.get("id", ""),
            tool_name=getattr(tool, "name", ""),
            cancel_event=getattr(tool, "cancel_event", None),
            event_emitter=getattr(tool, "event_emitter", None),
            thinking_enabled=bool(getattr(tool, "thinking_enabled", False)),
            model=getattr(tool, "model", None),
            memory_manager=getattr(parent, "memory_manager", None),
            skill_manager=getattr(parent, "skill_manager", None),
            skill_filter=frozenset(skill_filter) if skill_filter is not None else None,
            delegation_runtime=getattr(tool, "delegation_runtime", None),
            parent_agent=parent,
            user_id=getattr(tool, "user_id", None),
            settings=getattr(tool, "settings", None),
        )


def bind_legacy_tool[T](tool: T, context: ToolCallContext) -> T:
    """旧 execute(params) 的属性兼容集中在此，调用间不修改共享工具实例。"""
    bound = copy.copy(tool)
    legacy: Any = bound
    if hasattr(legacy, "config"):
        legacy.config = copy.deepcopy(legacy.config)
    for name, value in {
        "model": context.model,
        "context": context.parent_agent,
        "event_emitter": context.event_emitter,
        "cancel_event": context.cancel_event,
        "thinking_enabled": context.thinking_enabled,
        "delegation_runtime": context.delegation_runtime,
        "current_tool_call": {"id": context.tool_call_id, "name": context.tool_name}
        if context.tool_call_id
        else None,
    }.items():
        setattr(bound, name, value)
    return bound
