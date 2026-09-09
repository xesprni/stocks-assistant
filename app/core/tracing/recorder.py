"""Serialize stream events into the existing trace node hierarchy."""

from __future__ import annotations

import logging
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from app.core.tracing.payloads import _duration_ms, _new_id, _preview

if TYPE_CHECKING:
    from app.core.tracing.store import TraceStore

logger = logging.getLogger("stocks-assistant.tracing")


@dataclass(frozen=True)
class _SubagentEvent:
    batch_id: str
    task_id: str
    role: str
    event_type: str
    envelope: dict[str, Any]
    data: dict[str, Any]
    timestamp: float | None
    parent_id: str


class TraceRecorder:
    """Map Agent stream events into persisted trace events."""

    def __init__(self, store: TraceStore, run_id: str, root_event_id: str):
        self.store = store
        self.run_id = run_id
        self.root_event_id = root_event_id
        self._closed = False
        # SQLite 写入集中到单线程，避免流式事件并发入库时打乱父子节点关系。
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="trace-recorder")
        self.current_turn_id: str | None = None
        self.turn_events: dict[int, str] = {}
        self.llm_events: dict[str, dict[str, Any]] = {}
        self.tool_events: dict[str, dict[str, Any]] = {}
        # message_update 是 token 级高频事件，先缓冲，等 message_end/LLM 结束时合并成一条记录。
        self.message_buffer: list[str] = []
        self.message_delta_count = 0
        # 子 Agent 事件用 batch_id/task_id 维持独立层级，避免并行任务互相抢当前节点。
        self.subagent_batches: dict[str, dict[str, Any]] = {}
        self.subagent_tasks: dict[tuple[str, str], dict[str, Any]] = {}
        self.subagent_turns: dict[tuple[str, str, int], str] = {}
        self.subagent_tools: dict[tuple[str, str, str], dict[str, Any]] = {}
        self.subagent_llm_events: dict[tuple[str, str, str], dict[str, Any]] = {}
        self.subagent_message_buffers: dict[tuple[str, str], list[str]] = {}
        self.subagent_message_counts: dict[tuple[str, str], int] = {}
        self._handlers: dict[str, Callable[[dict[str, Any], float | None], None]] = {
            "turn_start": self._on_turn_start,
            "turn_end": self._on_turn_end,
            "llm_call_start": self._on_llm_call_start,
            "message_update": self._on_message_update,
            "message_end": self._on_message_end,
            "llm_call_end": self._on_llm_call_end,
            "llm_call_error": self._on_llm_call_error,
            "tool_execution_start": self._on_tool_execution_start,
            "tool_execution_end": self._on_tool_execution_end,
            "subagent_batch_start": self._on_subagent_batch_start,
            "subagent_batch_end": self._on_subagent_batch_end,
            "subagent_start": self._on_subagent_start,
            "subagent_end": self._on_subagent_end,
            "subagent_event": self._handle_subagent_event,
            "error": self._on_error,
        }
        self._child_handlers: dict[str, Callable[[_SubagentEvent], None]] = {
            "turn_start": self._on_child_turn_start,
            "turn_end": self._on_child_turn_end,
            "llm_call_start": self._on_child_llm_call_start,
            "llm_call_end": self._on_child_llm_call_end,
            "llm_call_error": self._on_child_llm_call_end,
            "message_update": self._on_child_message_update,
            "message_end": self._on_child_message_end,
            "tool_execution_start": self._on_child_tool_execution_start,
            "tool_execution_end": self._on_child_tool_execution_end,
            "error": self._on_child_error,
        }

    @classmethod
    def start(cls, store: TraceStore, session_id: str, user_message: str) -> TraceRecorder:
        created = store.create_run(session_id=session_id, user_message=user_message)
        return cls(store=store, run_id=created["run_id"], root_event_id=created["root_event_id"])

    def handle_event(self, event: dict[str, Any]) -> None:
        if self._closed:
            return
        try:
            self._executor.submit(self._safe_handle_event, deepcopy(event))
        except RuntimeError as exc:
            logger.warning("Failed to enqueue trace event: %s", exc)

    def _safe_handle_event(self, event: dict[str, Any]) -> None:
        try:
            self._handle_event(event)
        except Exception as exc:
            logger.warning("Failed to persist trace event: %s", exc)

    def finish(
        self,
        status: str,
        user_message_id: str | None = None,
        assistant_message_id: str | None = None,
        final_response: str = "",
        error: str | None = None,
    ) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            future = self._executor.submit(
                self._safe_finish,
                status,
                user_message_id,
                assistant_message_id,
                final_response,
                error,
            )
            future.result()
        except RuntimeError as exc:
            logger.warning("Failed to enqueue trace finish: %s", exc)
        finally:
            self._executor.shutdown(wait=True, cancel_futures=False)

    def _safe_finish(
        self,
        status: str,
        user_message_id: str | None,
        assistant_message_id: str | None,
        final_response: str,
        error: str | None,
    ) -> None:
        try:
            self._flush_message_delta()
            self._flush_all_subagent_message_deltas()
            self.store.finish_run(
                run_id=self.run_id,
                root_event_id=self.root_event_id,
                status=status,
                user_message_id=user_message_id,
                assistant_message_id=assistant_message_id,
                final_response=final_response,
                error=error,
            )
        except Exception as exc:
            logger.warning("Failed to finish trace run: %s", exc)

    def _handle_event(self, event: dict[str, Any]) -> None:
        handler = self._handlers.get(event.get("type", ""))
        if handler is not None:
            handler(event.get("data") or {}, event.get("timestamp"))

    def _on_turn_start(self, data: dict[str, Any], timestamp: float | None) -> None:
        turn = data.get("turn")
        title = f"Turn {turn}" if turn else "Agent turn"
        event_id = self.store.add_event(
            self.run_id,
            node_type="turn",
            title=title,
            status="running",
            payload=data,
            parent_id=self.root_event_id,
            started_at=timestamp,
            summary=title,
        )
        if isinstance(turn, int):
            self.turn_events[turn] = event_id
        self.current_turn_id = event_id

    def _on_turn_end(self, data: dict[str, Any], timestamp: float | None) -> None:
        turn = data.get("turn")
        event_id = self.turn_events.get(turn) if isinstance(turn, int) else self.current_turn_id
        if event_id:
            status = "done" if not data.get("error") else "error"
            self.store.update_event(event_id, status=status, payload=data, ended_at=timestamp)

    def _on_llm_call_start(self, data: dict[str, Any], timestamp: float | None) -> None:
        call_id = str(data.get("llm_call_id") or _new_id())
        request_payload = data.get("request") or {}
        event_id = self.store.add_event(
            self.run_id,
            node_type="llm_call",
            title="LLM call",
            status="running",
            payload={"request": request_payload, "retry_count": data.get("retry_count")},
            parent_id=self.current_turn_id or self.root_event_id,
            started_at=timestamp,
            summary=f"{data.get('message_count', 0)} messages",
        )
        self.llm_events[call_id] = {
            "event_id": event_id,
            "started_at": timestamp,
            "request": request_payload,
        }

    def _on_message_update(self, data: dict[str, Any], timestamp: float | None) -> None:
        delta = data.get("delta")
        if isinstance(delta, str):
            self.message_buffer.append(delta)
            self.message_delta_count += 1

    def _on_message_end(self, data: dict[str, Any], timestamp: float | None) -> None:
        self._flush_message_delta(parent_id=self._active_llm_event_id())

    def _on_llm_call_end(self, data: dict[str, Any], timestamp: float | None) -> None:
        self._flush_message_delta(parent_id=self._active_llm_event_id())
        call_id = str(data.get("llm_call_id") or "")
        info = self.llm_events.pop(call_id, None)
        response_payload = data.get("response") or {}
        duration = data.get("duration_ms")
        payload = {
            "request": (info or {}).get("request"),
            "response": response_payload,
            "stop_reason": data.get("stop_reason"),
            "retry_count": data.get("retry_count"),
        }
        if info:
            self.store.update_event(
                info["event_id"],
                status="done",
                payload=payload,
                ended_at=timestamp,
                duration_ms=duration
                if isinstance(duration, (int, float))
                else _duration_ms(info.get("started_at"), timestamp),
                summary=self._llm_summary(response_payload),
            )
        else:
            self.store.add_event(
                self.run_id,
                node_type="llm_call",
                title="LLM call",
                status="done",
                payload=payload,
                parent_id=self.current_turn_id or self.root_event_id,
                started_at=timestamp,
                ended_at=timestamp,
                duration_ms=0,
                summary=self._llm_summary(response_payload),
            )

    def _on_llm_call_error(self, data: dict[str, Any], timestamp: float | None) -> None:
        self._flush_message_delta(parent_id=self._active_llm_event_id())
        call_id = str(data.get("llm_call_id") or "")
        info = self.llm_events.pop(call_id, None)
        payload = {
            "request": (info or {}).get("request"),
            "error": data.get("error"),
            "retry_count": data.get("retry_count"),
        }
        if info:
            self.store.update_event(
                info["event_id"],
                status="error",
                payload=payload,
                ended_at=timestamp,
                duration_ms=_duration_ms(info.get("started_at"), timestamp),
                summary=str(data.get("error") or "LLM call failed"),
            )
        else:
            self.store.add_event(
                self.run_id,
                node_type="error",
                title="LLM call failed",
                status="error",
                payload=payload,
                parent_id=self.current_turn_id or self.root_event_id,
                started_at=timestamp,
                ended_at=timestamp,
                duration_ms=0,
                summary=str(data.get("error") or "LLM call failed"),
            )

    def _on_tool_execution_start(self, data: dict[str, Any], timestamp: float | None) -> None:
        tool_call_id = str(data.get("tool_call_id") or _new_id())
        tool_name = str(data.get("tool_name") or "tool")
        event_id = self.store.add_event(
            self.run_id,
            node_type="tool_call",
            title=f"Tool call: {tool_name}",
            status="running",
            payload={
                "tool_call_id": tool_call_id,
                "tool_name": tool_name,
                "arguments": data.get("arguments"),
            },
            parent_id=self.current_turn_id or self.root_event_id,
            started_at=timestamp,
            summary=tool_name,
        )
        self.tool_events[tool_call_id] = {
            "event_id": event_id,
            "started_at": timestamp,
            "tool_name": tool_name,
            "arguments": data.get("arguments"),
        }

    def _on_tool_execution_end(self, data: dict[str, Any], timestamp: float | None) -> None:
        tool_call_id = str(data.get("tool_call_id") or "")
        info = self.tool_events.pop(tool_call_id, None)
        tool_name = str(data.get("tool_name") or (info or {}).get("tool_name") or "tool")
        status = "done" if data.get("status") == "success" else "error"
        duration = data.get("execution_time")
        duration_ms = duration * 1000 if isinstance(duration, (int, float)) else None
        call_payload = {
            "tool_call_id": tool_call_id,
            "tool_name": tool_name,
            "arguments": (info or {}).get("arguments"),
            "status": data.get("status"),
            "execution_time": data.get("execution_time"),
        }
        result_payload = {
            "tool_call_id": tool_call_id,
            "tool_name": tool_name,
            "status": data.get("status"),
            "execution_time": data.get("execution_time"),
            "result": data.get("result"),
        }
        parent_id = self.current_turn_id or self.root_event_id
        if info:
            # tool_call 只保留请求侧信息；结果单独落到 tool_result，展开时才有清晰分工。
            parent_id = info["event_id"]
            self.store.update_event(
                info["event_id"],
                status=status,
                payload=call_payload,
                ended_at=timestamp,
                duration_ms=duration_ms,
                summary=f"{tool_name}: {data.get('status') or status}",
            )
        self.store.add_event(
            self.run_id,
            node_type="tool_result",
            title=f"Tool result: {tool_name}",
            status=status,
            payload=result_payload,
            parent_id=parent_id,
            started_at=timestamp,
            ended_at=timestamp,
            duration_ms=0,
            summary=f"{tool_name}: {data.get('status') or status}",
        )

    def _on_subagent_batch_start(self, data: dict[str, Any], timestamp: float | None) -> None:
        batch_id = str(data.get("batch_id") or _new_id())
        parent_tool_call_id = str(data.get("parent_tool_call_id") or "")
        parent_id = self.current_turn_id or self.root_event_id
        tool_info = self.tool_events.get(parent_tool_call_id)
        if tool_info:
            parent_id = tool_info["event_id"]
        event_id = self.store.add_event(
            self.run_id,
            node_type="subagent_batch",
            title="Sub-agent batch",
            status="running",
            payload=data,
            parent_id=parent_id,
            started_at=timestamp,
            summary=f"{data.get('task_count', 0)} sub-agent task(s)",
        )
        self.subagent_batches[batch_id] = {"event_id": event_id, "started_at": timestamp}

    def _on_subagent_batch_end(self, data: dict[str, Any], timestamp: float | None) -> None:
        batch_id = str(data.get("batch_id") or "")
        info = self.subagent_batches.pop(batch_id, None)
        if info:
            status = "done" if data.get("status") == "success" else "error"
            duration = data.get("duration_ms")
            self.store.update_event(
                info["event_id"],
                status=status,
                payload=data,
                ended_at=timestamp,
                duration_ms=duration
                if isinstance(duration, (int, float))
                else _duration_ms(info.get("started_at"), timestamp),
                summary=f"Sub-agent batch: {data.get('status') or status}",
            )

    def _on_subagent_start(self, data: dict[str, Any], timestamp: float | None) -> None:
        batch_id = str(data.get("batch_id") or "")
        task_id = str(data.get("task_id") or _new_id())
        role = str(data.get("role") or "subagent")
        batch_info = self.subagent_batches.get(batch_id)
        parent_id = (batch_info or {}).get("event_id") or self.current_turn_id or self.root_event_id
        event_id = self.store.add_event(
            self.run_id,
            node_type="subagent",
            title=f"Sub-agent: {role}",
            status="running",
            payload=data,
            parent_id=parent_id,
            started_at=timestamp,
            summary=_preview(str(data.get("task") or "")),
        )
        self.subagent_tasks[(batch_id, task_id)] = {
            "event_id": event_id,
            "started_at": timestamp,
            "role": role,
        }

    def _on_subagent_end(self, data: dict[str, Any], timestamp: float | None) -> None:
        batch_id = str(data.get("batch_id") or "")
        task_id = str(data.get("task_id") or "")
        self._flush_subagent_message_delta(batch_id, task_id)
        info = self.subagent_tasks.pop((batch_id, task_id), None)
        if info:
            status = "done" if data.get("status") == "success" else "error"
            duration = data.get("duration_ms")
            self.store.update_event(
                info["event_id"],
                status=status,
                payload=data,
                ended_at=timestamp,
                duration_ms=duration
                if isinstance(duration, (int, float))
                else _duration_ms(info.get("started_at"), timestamp),
                summary=_preview(
                    str(data.get("final_response") or data.get("error") or "Sub-agent finished")
                ),
            )

    def _on_error(self, data: dict[str, Any], timestamp: float | None) -> None:
        self.store.add_event(
            self.run_id,
            node_type="error",
            title="Agent error",
            status="error",
            payload=data,
            parent_id=self.current_turn_id or self.root_event_id,
            started_at=timestamp,
            ended_at=timestamp,
            duration_ms=0,
            summary=str(data.get("error") or "Agent error"),
        )

    def _handle_subagent_event(self, data: dict[str, Any], timestamp: float | None) -> None:
        batch_id = str(data.get("batch_id") or "")
        task_id = str(data.get("task_id") or "")
        child_type = str(data.get("child_event_type") or "")
        handler = self._child_handlers.get(child_type)
        if handler is None:
            return
        # 子任务先统一解析定位信息，再按原事件类型处理，避免并行任务共享当前节点。
        handler(
            _SubagentEvent(
                batch_id=batch_id,
                task_id=task_id,
                role=str(data.get("role") or "subagent"),
                event_type=child_type,
                envelope=data,
                data=data.get("child_data") if isinstance(data.get("child_data"), dict) else {},
                timestamp=data.get("child_timestamp") or timestamp,
                parent_id=self._subagent_parent_id(batch_id, task_id),
            )
        )

    def _on_child_turn_start(self, event: _SubagentEvent) -> None:
        turn = event.data.get("turn")
        title = f"{event.role} turn {turn}" if turn else f"{event.role} turn"
        event_id = self.store.add_event(
            self.run_id,
            node_type="subagent_turn",
            title=title,
            status="running",
            payload=event.envelope,
            parent_id=event.parent_id,
            started_at=event.timestamp,
            summary=title,
        )
        if isinstance(turn, int):
            self.subagent_turns[(event.batch_id, event.task_id, turn)] = event_id

    def _on_child_turn_end(self, event: _SubagentEvent) -> None:
        turn = event.data.get("turn")
        event_id = (
            self.subagent_turns.get((event.batch_id, event.task_id, turn))
            if isinstance(turn, int)
            else None
        )
        if event_id:
            self.store.update_event(
                event_id,
                status="done" if not event.data.get("error") else "error",
                payload=event.envelope,
                ended_at=event.timestamp,
                summary=f"{event.role} turn {turn} done",
            )

    def _on_child_llm_call_start(self, event: _SubagentEvent) -> None:
        call_id = str(event.data.get("llm_call_id") or _new_id())
        event_id = self.store.add_event(
            self.run_id,
            node_type="subagent_llm_call",
            title=f"{event.role} LLM call",
            status="running",
            payload=event.envelope,
            parent_id=self._subagent_active_turn_id(event.batch_id, event.task_id)
            or event.parent_id,
            started_at=event.timestamp,
            summary=f"{event.data.get('message_count', 0)} messages",
        )
        self.subagent_llm_events[(event.batch_id, event.task_id, call_id)] = {
            "event_id": event_id,
            "started_at": event.timestamp,
        }

    def _on_child_llm_call_end(self, event: _SubagentEvent) -> None:
        self._flush_subagent_message_delta(event.batch_id, event.task_id)
        call_id = str(event.data.get("llm_call_id") or "")
        info = self.subagent_llm_events.pop((event.batch_id, event.task_id, call_id), None)
        if info:
            is_error = event.event_type == "llm_call_error"
            duration = event.data.get("duration_ms")
            response_payload = (
                event.data.get("response") if isinstance(event.data.get("response"), dict) else {}
            )
            self.store.update_event(
                info["event_id"],
                status="error" if is_error else "done",
                payload=event.envelope,
                ended_at=event.timestamp,
                duration_ms=duration
                if isinstance(duration, (int, float))
                else _duration_ms(info.get("started_at"), event.timestamp),
                summary=str(event.data.get("error") or self._llm_summary(response_payload)),
            )

    def _on_child_message_update(self, event: _SubagentEvent) -> None:
        delta = event.data.get("delta")
        if isinstance(delta, str):
            key = (event.batch_id, event.task_id)
            self.subagent_message_buffers.setdefault(key, []).append(delta)
            self.subagent_message_counts[key] = self.subagent_message_counts.get(key, 0) + 1

    def _on_child_message_end(self, event: _SubagentEvent) -> None:
        self._flush_subagent_message_delta(event.batch_id, event.task_id)

    def _on_child_tool_execution_start(self, event: _SubagentEvent) -> None:
        tool_call_id = str(event.data.get("tool_call_id") or _new_id())
        tool_name = str(event.data.get("tool_name") or "tool")
        event_id = self.store.add_event(
            self.run_id,
            node_type="subagent_tool_call",
            title=f"{event.role} tool: {tool_name}",
            status="running",
            payload={
                "batch_id": event.batch_id,
                "task_id": event.task_id,
                "role": event.role,
                "tool_call_id": tool_call_id,
                "tool_name": tool_name,
                "arguments": event.data.get("arguments"),
            },
            parent_id=self._subagent_active_turn_id(event.batch_id, event.task_id)
            or event.parent_id,
            started_at=event.timestamp,
            summary=tool_name,
        )
        self.subagent_tools[(event.batch_id, event.task_id, tool_call_id)] = {
            "event_id": event_id,
            "started_at": event.timestamp,
            "tool_name": tool_name,
            "arguments": event.data.get("arguments"),
        }

    def _on_child_tool_execution_end(self, event: _SubagentEvent) -> None:
        tool_call_id = str(event.data.get("tool_call_id") or "")
        info = self.subagent_tools.pop((event.batch_id, event.task_id, tool_call_id), None)
        tool_name = str(event.data.get("tool_name") or (info or {}).get("tool_name") or "tool")
        status = "done" if event.data.get("status") == "success" else "error"
        duration = event.data.get("execution_time")
        duration_ms = duration * 1000 if isinstance(duration, (int, float)) else None
        call_payload = {
            "batch_id": event.batch_id,
            "task_id": event.task_id,
            "role": event.role,
            "tool_call_id": tool_call_id,
            "tool_name": tool_name,
            "arguments": (info or {}).get("arguments"),
            "status": event.data.get("status"),
            "execution_time": event.data.get("execution_time"),
        }
        result_payload = {
            **call_payload,
            "result": event.data.get("result"),
        }
        parent_id = (
            (info or {}).get("event_id")
            or self._subagent_active_turn_id(event.batch_id, event.task_id)
            or event.parent_id
        )
        if info:
            self.store.update_event(
                info["event_id"],
                status=status,
                payload=call_payload,
                ended_at=event.timestamp,
                duration_ms=duration_ms,
                summary=f"{tool_name}: {event.data.get('status') or status}",
            )
        self.store.add_event(
            self.run_id,
            node_type="subagent_tool_result",
            title=f"{event.role} tool result: {tool_name}",
            status=status,
            payload=result_payload,
            parent_id=parent_id,
            started_at=event.timestamp,
            ended_at=event.timestamp,
            duration_ms=0,
            summary=f"{tool_name}: {event.data.get('status') or status}",
        )

    def _on_child_error(self, event: _SubagentEvent) -> None:
        self.store.add_event(
            self.run_id,
            node_type="subagent_error",
            title=f"{event.role} error",
            status="error",
            payload=event.envelope,
            parent_id=event.parent_id,
            started_at=event.timestamp,
            ended_at=event.timestamp,
            duration_ms=0,
            summary=str(event.data.get("error") or "Sub-agent error"),
        )

    def _subagent_parent_id(self, batch_id: str, task_id: str) -> str:
        task_info = self.subagent_tasks.get((batch_id, task_id))
        if task_info:
            return task_info["event_id"]
        batch_info = self.subagent_batches.get(batch_id)
        if batch_info:
            return batch_info["event_id"]
        return self.current_turn_id or self.root_event_id

    def _subagent_active_turn_id(self, batch_id: str, task_id: str) -> str | None:
        # dict 保持插入顺序，反向扫描可以找到该子任务最近打开的 turn。
        for b_id, t_id, _turn in reversed(self.subagent_turns.keys()):
            if b_id == batch_id and t_id == task_id:
                return self.subagent_turns[(b_id, t_id, _turn)]
        return None

    def _flush_subagent_message_delta(self, batch_id: str, task_id: str) -> None:
        key = (batch_id, task_id)
        buffer = self.subagent_message_buffers.get(key)
        if not buffer:
            return
        content = "".join(buffer)
        count = self.subagent_message_counts.get(key, 0)
        self.store.add_event(
            self.run_id,
            node_type="subagent_message_delta",
            title="Sub-agent message stream",
            status="done",
            payload={
                "batch_id": batch_id,
                "task_id": task_id,
                "content": content,
                "delta_count": count,
                "content_length": len(content),
            },
            parent_id=self._subagent_active_turn_id(batch_id, task_id)
            or self._subagent_parent_id(batch_id, task_id),
            summary=_preview(content),
        )
        self.subagent_message_buffers[key] = []
        self.subagent_message_counts[key] = 0

    def _flush_all_subagent_message_deltas(self) -> None:
        for batch_id, task_id in list(self.subagent_message_buffers.keys()):
            self._flush_subagent_message_delta(batch_id, task_id)

    def _flush_message_delta(self, parent_id: str | None = None) -> None:
        if not self.message_buffer:
            return
        content = "".join(self.message_buffer)
        self.store.add_event(
            self.run_id,
            node_type="message_delta",
            title="Assistant message stream",
            status="done",
            payload={
                "content": content,
                "delta_count": self.message_delta_count,
                "content_length": len(content),
            },
            parent_id=parent_id or self.current_turn_id or self.root_event_id,
            summary=_preview(content),
        )
        self.message_buffer = []
        self.message_delta_count = 0

    def _active_llm_event_id(self) -> str | None:
        if not self.llm_events:
            return None
        last_key = next(reversed(self.llm_events))
        return self.llm_events[last_key].get("event_id")

    @staticmethod
    def _llm_summary(response: dict[str, Any]) -> str:
        content = response.get("content")
        if isinstance(content, str) and content.strip():
            return _preview(content)
        tool_calls = response.get("tool_calls")
        if isinstance(tool_calls, list) and tool_calls:
            names = [
                str(item.get("name") or "tool") for item in tool_calls if isinstance(item, dict)
            ]
            return f"Tool calls: {', '.join(names)}"
        return "LLM response"
