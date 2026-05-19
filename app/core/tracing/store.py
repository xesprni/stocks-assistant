"""SQLite-backed Agent tracing store."""

from __future__ import annotations

import json
import logging
import sqlite3
import uuid
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("stocks-assistant.tracing")

MAX_TRACE_STRING_CHARS = 50_000
MAX_RESPONSE_PREVIEW_CHARS = 1_000
_TRUNCATION_MARKER = "\n\n[Trace payload truncated: {original} chars total]"
_SECRET_KEYS = ("api_key", "authorization", "password", "secret", "token")


def _new_id() -> str:
    return str(uuid.uuid4())


def _now() -> str:
    return datetime.now().isoformat(timespec="milliseconds")


def _iso_from_timestamp(value: Optional[float]) -> str:
    if value is None:
        return _now()
    return datetime.fromtimestamp(value).isoformat(timespec="milliseconds")


def _duration_ms(started_at: Optional[float], ended_at: Optional[float]) -> Optional[float]:
    if started_at is None or ended_at is None:
        return None
    return max(0.0, (ended_at - started_at) * 1000)


def _decode_json(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


def _clean_text(value: str) -> str:
    if len(value) <= MAX_TRACE_STRING_CHARS:
        return value
    return value[:MAX_TRACE_STRING_CHARS] + _TRUNCATION_MARKER.format(original=len(value))


def _sanitize_payload(value: Any, key: str = "") -> Any:
    key_lower = key.lower()
    if key_lower and any(secret in key_lower for secret in _SECRET_KEYS):
        return "[redacted]"

    if isinstance(value, str):
        return _clean_text(value)
    if isinstance(value, list):
        return [_sanitize_payload(item) for item in value]
    if isinstance(value, dict):
        if value.get("type") == "thinking":
            return {"type": "thinking", "omitted": True}
        return {str(k): _sanitize_payload(v, str(k)) for k, v in value.items()}
    return value


def _json_dumps(value: Any) -> str:
    return json.dumps(_sanitize_payload(value), ensure_ascii=False, separators=(",", ":"))


def _preview(text: str | None) -> str:
    if not text:
        return ""
    compact = " ".join(text.strip().split())
    if len(compact) <= MAX_RESPONSE_PREVIEW_CHARS:
        return compact
    return compact[:MAX_RESPONSE_PREVIEW_CHARS] + f"... [{len(compact)} chars total]"


class TraceStore:
    """Persist Agent run traces in the chat sessions SQLite database."""

    def __init__(self, workspace_dir: str):
        root = Path(workspace_dir).expanduser()
        self.db_path = root / "sessions" / "sessions.db"
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def create_run(self, session_id: str, user_message: str) -> dict[str, str]:
        run_id = _new_id()
        now = _now()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO trace_runs (
                    id, session_id, status, started_at, final_response_preview
                )
                VALUES (?, ?, ?, ?, ?)
                """,
                (run_id, session_id, "running", now, ""),
            )
            root_event_id = self._insert_event(
                conn,
                run_id=run_id,
                parent_id=None,
                node_type="agent_run",
                title="Agent run",
                status="running",
                started_at=now,
                ended_at=None,
                duration_ms=None,
                summary=_preview(user_message),
                payload={"session_id": session_id, "user_message": user_message},
            )
            conn.commit()
        return {"run_id": run_id, "root_event_id": root_event_id}

    def add_event(
        self,
        run_id: str,
        node_type: str,
        title: str,
        status: str = "done",
        payload: Optional[dict[str, Any]] = None,
        parent_id: Optional[str] = None,
        started_at: Optional[float | str] = None,
        ended_at: Optional[float | str] = None,
        duration_ms: Optional[float] = None,
        summary: str = "",
    ) -> str:
        start = self._coerce_time(started_at) if started_at is not None else _now()
        end = self._coerce_time(ended_at) if ended_at is not None else None
        with self._connect() as conn:
            event_id = self._insert_event(
                conn,
                run_id=run_id,
                parent_id=parent_id,
                node_type=node_type,
                title=title,
                status=status,
                started_at=start,
                ended_at=end,
                duration_ms=duration_ms,
                summary=summary,
                payload=payload or {},
            )
            conn.commit()
        return event_id

    def update_event(
        self,
        event_id: str,
        status: Optional[str] = None,
        payload: Optional[dict[str, Any]] = None,
        ended_at: Optional[float | str] = None,
        duration_ms: Optional[float] = None,
        summary: Optional[str] = None,
        title: Optional[str] = None,
    ) -> None:
        fields: list[str] = []
        params: list[Any] = []
        if status is not None:
            fields.append("status = ?")
            params.append(status)
        if payload is not None:
            fields.append("payload_json = ?")
            params.append(_json_dumps(payload))
        if ended_at is not None:
            fields.append("ended_at = ?")
            params.append(self._coerce_time(ended_at))
        if duration_ms is not None:
            fields.append("duration_ms = ?")
            params.append(duration_ms)
        if summary is not None:
            fields.append("summary = ?")
            params.append(summary)
        if title is not None:
            fields.append("title = ?")
            params.append(title)
        if not fields:
            return
        params.append(event_id)
        with self._connect() as conn:
            conn.execute(f"UPDATE trace_events SET {', '.join(fields)} WHERE id = ?", params)
            conn.commit()

    def finish_run(
        self,
        run_id: str,
        root_event_id: str,
        status: str,
        user_message_id: Optional[str] = None,
        assistant_message_id: Optional[str] = None,
        final_response: str = "",
        error: Optional[str] = None,
    ) -> None:
        now = _now()
        run_row = None
        with self._connect() as conn:
            run_row = conn.execute(
                "SELECT started_at FROM trace_runs WHERE id = ?",
                (run_id,),
            ).fetchone()
            duration = None
            if run_row:
                try:
                    started = datetime.fromisoformat(run_row["started_at"])
                    ended = datetime.fromisoformat(now)
                    duration = max(0.0, (ended - started).total_seconds() * 1000)
                except ValueError:
                    duration = None
            conn.execute(
                """
                UPDATE trace_runs
                SET user_message_id = ?,
                    assistant_message_id = ?,
                    status = ?,
                    ended_at = ?,
                    duration_ms = ?,
                    error = ?,
                    final_response_preview = ?
                WHERE id = ?
                """,
                (
                    user_message_id,
                    assistant_message_id,
                    status,
                    now,
                    duration,
                    error,
                    _preview(final_response),
                    run_id,
                ),
            )
            conn.execute(
                """
                UPDATE trace_events
                SET status = ?, ended_at = ?, duration_ms = ?
                WHERE id = ?
                """,
                (status, now, duration, root_event_id),
            )
            self._insert_event(
                conn,
                run_id=run_id,
                parent_id=root_event_id,
                node_type="agent_end" if status != "error" else "error",
                title="Agent finished" if status != "error" else "Agent failed",
                status=status,
                started_at=now,
                ended_at=now,
                duration_ms=0,
                summary=_preview(error or final_response),
                payload={
                    "user_message_id": user_message_id,
                    "assistant_message_id": assistant_message_id,
                    "final_response": final_response,
                    "error": error,
                },
            )
            conn.commit()

    def get_session_traces(self, session_id: str, limit: int = 20) -> dict[str, Any]:
        clean_limit = max(1, min(limit, 100))
        with self._connect() as conn:
            run_rows = conn.execute(
                """
                SELECT id, session_id, user_message_id, assistant_message_id, status,
                       started_at, ended_at, duration_ms, error, final_response_preview
                FROM trace_runs
                WHERE session_id = ?
                ORDER BY started_at DESC
                LIMIT ?
                """,
                (session_id, clean_limit),
            ).fetchall()
            runs = []
            for row in run_rows:
                run = self._run_row_to_dict(row)
                event_rows = conn.execute(
                    """
                    SELECT id, run_id, seq, parent_id, node_type, title, status,
                           started_at, ended_at, duration_ms, summary, payload_json
                    FROM trace_events
                    WHERE run_id = ?
                    ORDER BY seq ASC
                    """,
                    (run["id"],),
                ).fetchall()
                run["events"] = [self._event_row_to_dict(event_row) for event_row in event_rows]
                runs.append(run)
        return {"session_id": session_id, "runs": runs, "total": len(runs)}

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS trace_runs (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    user_message_id TEXT,
                    assistant_message_id TEXT,
                    status TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    ended_at TEXT,
                    duration_ms REAL,
                    error TEXT,
                    final_response_preview TEXT NOT NULL DEFAULT '',
                    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
                    FOREIGN KEY(user_message_id) REFERENCES messages(id) ON DELETE SET NULL,
                    FOREIGN KEY(assistant_message_id) REFERENCES messages(id) ON DELETE SET NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS trace_events (
                    id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    seq INTEGER NOT NULL,
                    parent_id TEXT,
                    node_type TEXT NOT NULL,
                    title TEXT NOT NULL,
                    status TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    ended_at TEXT,
                    duration_ms REAL,
                    summary TEXT NOT NULL DEFAULT '',
                    payload_json TEXT NOT NULL DEFAULT '{}',
                    FOREIGN KEY(run_id) REFERENCES trace_runs(id) ON DELETE CASCADE,
                    FOREIGN KEY(parent_id) REFERENCES trace_events(id) ON DELETE SET NULL,
                    UNIQUE(run_id, seq)
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_trace_runs_session_started ON trace_runs(session_id, started_at)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_trace_events_run_seq ON trace_events(run_id, seq)")
            conn.commit()

    def _insert_event(
        self,
        conn: sqlite3.Connection,
        run_id: str,
        parent_id: Optional[str],
        node_type: str,
        title: str,
        status: str,
        started_at: str,
        ended_at: Optional[str],
        duration_ms: Optional[float],
        summary: str,
        payload: dict[str, Any],
    ) -> str:
        event_id = _new_id()
        seq = conn.execute(
            "SELECT COALESCE(MAX(seq), -1) + 1 FROM trace_events WHERE run_id = ?",
            (run_id,),
        ).fetchone()[0]
        conn.execute(
            """
            INSERT INTO trace_events (
                id, run_id, seq, parent_id, node_type, title, status,
                started_at, ended_at, duration_ms, summary, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event_id,
                run_id,
                seq,
                parent_id,
                node_type,
                title,
                status,
                started_at,
                ended_at,
                duration_ms,
                summary,
                _json_dumps(payload),
            ),
        )
        return event_id

    @staticmethod
    def _coerce_time(value: float | str) -> str:
        if isinstance(value, (float, int)):
            return _iso_from_timestamp(float(value))
        return value

    @staticmethod
    def _run_row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "session_id": row["session_id"],
            "user_message_id": row["user_message_id"],
            "assistant_message_id": row["assistant_message_id"],
            "status": row["status"],
            "started_at": row["started_at"],
            "ended_at": row["ended_at"],
            "duration_ms": row["duration_ms"],
            "error": row["error"],
            "final_response_preview": row["final_response_preview"],
        }

    @staticmethod
    def _event_row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "run_id": row["run_id"],
            "seq": row["seq"],
            "parent_id": row["parent_id"],
            "node_type": row["node_type"],
            "title": row["title"],
            "status": row["status"],
            "started_at": row["started_at"],
            "ended_at": row["ended_at"],
            "duration_ms": row["duration_ms"],
            "summary": row["summary"],
            "payload": _decode_json(row["payload_json"], {}),
        }


class TraceRecorder:
    """Map Agent stream events into persisted trace events."""

    def __init__(self, store: TraceStore, run_id: str, root_event_id: str):
        self.store = store
        self.run_id = run_id
        self.root_event_id = root_event_id
        self._closed = False
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="trace-recorder")
        self.current_turn_id: Optional[str] = None
        self.turn_events: dict[int, str] = {}
        self.llm_events: dict[str, dict[str, Any]] = {}
        self.tool_events: dict[str, dict[str, Any]] = {}
        self.message_buffer: list[str] = []
        self.message_delta_count = 0
        self.subagent_batches: dict[str, dict[str, Any]] = {}
        self.subagent_tasks: dict[tuple[str, str], dict[str, Any]] = {}
        self.subagent_turns: dict[tuple[str, str, int], str] = {}
        self.subagent_tools: dict[tuple[str, str, str], dict[str, Any]] = {}
        self.subagent_llm_events: dict[tuple[str, str, str], dict[str, Any]] = {}
        self.subagent_message_buffers: dict[tuple[str, str], list[str]] = {}
        self.subagent_message_counts: dict[tuple[str, str], int] = {}

    @classmethod
    def start(cls, store: TraceStore, session_id: str, user_message: str) -> "TraceRecorder":
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
        user_message_id: Optional[str] = None,
        assistant_message_id: Optional[str] = None,
        final_response: str = "",
        error: Optional[str] = None,
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
        user_message_id: Optional[str],
        assistant_message_id: Optional[str],
        final_response: str,
        error: Optional[str],
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
        event_type = event.get("type")
        data = event.get("data") or {}
        timestamp = event.get("timestamp")

        if event_type == "turn_start":
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
            return

        if event_type == "turn_end":
            turn = data.get("turn")
            event_id = self.turn_events.get(turn) if isinstance(turn, int) else self.current_turn_id
            if event_id:
                status = "done" if not data.get("error") else "error"
                self.store.update_event(event_id, status=status, payload=data, ended_at=timestamp)
            return

        if event_type == "llm_call_start":
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
            return

        if event_type == "message_update":
            delta = data.get("delta")
            if isinstance(delta, str):
                self.message_buffer.append(delta)
                self.message_delta_count += 1
            return

        if event_type == "message_end":
            self._flush_message_delta(parent_id=self._active_llm_event_id())
            return

        if event_type == "llm_call_end":
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
                    duration_ms=duration if isinstance(duration, (int, float)) else _duration_ms(info.get("started_at"), timestamp),
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
            return

        if event_type == "llm_call_error":
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
            return

        if event_type == "tool_execution_start":
            tool_call_id = str(data.get("tool_call_id") or _new_id())
            tool_name = str(data.get("tool_name") or "tool")
            event_id = self.store.add_event(
                self.run_id,
                node_type="tool_call",
                title=f"Tool call: {tool_name}",
                status="running",
                payload={"tool_call_id": tool_call_id, "tool_name": tool_name, "arguments": data.get("arguments")},
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
            return

        if event_type == "tool_execution_end":
            tool_call_id = str(data.get("tool_call_id") or "")
            info = self.tool_events.pop(tool_call_id, None)
            tool_name = str(data.get("tool_name") or (info or {}).get("tool_name") or "tool")
            status = "done" if data.get("status") == "success" else "error"
            duration = data.get("execution_time")
            duration_ms = duration * 1000 if isinstance(duration, (int, float)) else None
            payload = {
                "tool_call_id": tool_call_id,
                "tool_name": tool_name,
                "arguments": (info or {}).get("arguments"),
                "status": data.get("status"),
                "execution_time": data.get("execution_time"),
                "result": data.get("result"),
            }
            parent_id = self.current_turn_id or self.root_event_id
            if info:
                parent_id = info["event_id"]
                self.store.update_event(
                    info["event_id"],
                    status=status,
                    payload=payload,
                    ended_at=timestamp,
                    duration_ms=duration_ms,
                    summary=f"{tool_name}: {data.get('status') or status}",
                )
            self.store.add_event(
                self.run_id,
                node_type="tool_result",
                title=f"Tool result: {tool_name}",
                status=status,
                payload=payload,
                parent_id=parent_id,
                started_at=timestamp,
                ended_at=timestamp,
                duration_ms=0,
                summary=f"{tool_name}: {data.get('status') or status}",
            )
            return

        if event_type == "subagent_batch_start":
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
            return

        if event_type == "subagent_batch_end":
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
                    duration_ms=duration if isinstance(duration, (int, float)) else _duration_ms(info.get("started_at"), timestamp),
                    summary=f"Sub-agent batch: {data.get('status') or status}",
                )
            return

        if event_type == "subagent_start":
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
            self.subagent_tasks[(batch_id, task_id)] = {"event_id": event_id, "started_at": timestamp, "role": role}
            return

        if event_type == "subagent_end":
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
                    duration_ms=duration if isinstance(duration, (int, float)) else _duration_ms(info.get("started_at"), timestamp),
                    summary=_preview(str(data.get("final_response") or data.get("error") or "Sub-agent finished")),
                )
            return

        if event_type == "subagent_event":
            self._handle_subagent_event(data, timestamp)
            return

        if event_type == "error":
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

    def _handle_subagent_event(self, data: dict[str, Any], timestamp: Optional[float]) -> None:
        batch_id = str(data.get("batch_id") or "")
        task_id = str(data.get("task_id") or "")
        role = str(data.get("role") or "subagent")
        child_type = str(data.get("child_event_type") or "")
        child_data = data.get("child_data") if isinstance(data.get("child_data"), dict) else {}
        child_timestamp = data.get("child_timestamp") or timestamp
        subagent_parent = self._subagent_parent_id(batch_id, task_id)

        if child_type == "turn_start":
            turn = child_data.get("turn")
            title = f"{role} turn {turn}" if turn else f"{role} turn"
            event_id = self.store.add_event(
                self.run_id,
                node_type="subagent_turn",
                title=title,
                status="running",
                payload=data,
                parent_id=subagent_parent,
                started_at=child_timestamp,
                summary=title,
            )
            if isinstance(turn, int):
                self.subagent_turns[(batch_id, task_id, turn)] = event_id
            return

        if child_type == "turn_end":
            turn = child_data.get("turn")
            event_id = self.subagent_turns.get((batch_id, task_id, turn)) if isinstance(turn, int) else None
            if event_id:
                self.store.update_event(
                    event_id,
                    status="done" if not child_data.get("error") else "error",
                    payload=data,
                    ended_at=child_timestamp,
                    summary=f"{role} turn {turn} done",
                )
            return

        if child_type == "llm_call_start":
            call_id = str(child_data.get("llm_call_id") or _new_id())
            event_id = self.store.add_event(
                self.run_id,
                node_type="subagent_llm_call",
                title=f"{role} LLM call",
                status="running",
                payload=data,
                parent_id=self._subagent_active_turn_id(batch_id, task_id) or subagent_parent,
                started_at=child_timestamp,
                summary=f"{child_data.get('message_count', 0)} messages",
            )
            self.subagent_llm_events[(batch_id, task_id, call_id)] = {
                "event_id": event_id,
                "started_at": child_timestamp,
            }
            return

        if child_type in {"llm_call_end", "llm_call_error"}:
            self._flush_subagent_message_delta(batch_id, task_id)
            call_id = str(child_data.get("llm_call_id") or "")
            info = self.subagent_llm_events.pop((batch_id, task_id, call_id), None)
            if info:
                is_error = child_type == "llm_call_error"
                duration = child_data.get("duration_ms")
                response_payload = child_data.get("response") if isinstance(child_data.get("response"), dict) else {}
                self.store.update_event(
                    info["event_id"],
                    status="error" if is_error else "done",
                    payload=data,
                    ended_at=child_timestamp,
                    duration_ms=duration if isinstance(duration, (int, float)) else _duration_ms(info.get("started_at"), child_timestamp),
                    summary=str(child_data.get("error") or self._llm_summary(response_payload)),
                )
            return

        if child_type == "message_update":
            delta = child_data.get("delta")
            if isinstance(delta, str):
                key = (batch_id, task_id)
                self.subagent_message_buffers.setdefault(key, []).append(delta)
                self.subagent_message_counts[key] = self.subagent_message_counts.get(key, 0) + 1
            return

        if child_type == "message_end":
            self._flush_subagent_message_delta(batch_id, task_id)
            return

        if child_type == "tool_execution_start":
            tool_call_id = str(child_data.get("tool_call_id") or _new_id())
            tool_name = str(child_data.get("tool_name") or "tool")
            event_id = self.store.add_event(
                self.run_id,
                node_type="subagent_tool_call",
                title=f"{role} tool: {tool_name}",
                status="running",
                payload=data,
                parent_id=self._subagent_active_turn_id(batch_id, task_id) or subagent_parent,
                started_at=child_timestamp,
                summary=tool_name,
            )
            self.subagent_tools[(batch_id, task_id, tool_call_id)] = {
                "event_id": event_id,
                "started_at": child_timestamp,
                "tool_name": tool_name,
            }
            return

        if child_type == "tool_execution_end":
            tool_call_id = str(child_data.get("tool_call_id") or "")
            info = self.subagent_tools.pop((batch_id, task_id, tool_call_id), None)
            tool_name = str(child_data.get("tool_name") or (info or {}).get("tool_name") or "tool")
            status = "done" if child_data.get("status") == "success" else "error"
            duration = child_data.get("execution_time")
            duration_ms = duration * 1000 if isinstance(duration, (int, float)) else None
            parent_id = (info or {}).get("event_id") or self._subagent_active_turn_id(batch_id, task_id) or subagent_parent
            if info:
                self.store.update_event(
                    info["event_id"],
                    status=status,
                    payload=data,
                    ended_at=child_timestamp,
                    duration_ms=duration_ms,
                    summary=f"{tool_name}: {child_data.get('status') or status}",
                )
            self.store.add_event(
                self.run_id,
                node_type="subagent_tool_result",
                title=f"{role} tool result: {tool_name}",
                status=status,
                payload=data,
                parent_id=parent_id,
                started_at=child_timestamp,
                ended_at=child_timestamp,
                duration_ms=0,
                summary=f"{tool_name}: {child_data.get('status') or status}",
            )
            return

        if child_type == "error":
            self.store.add_event(
                self.run_id,
                node_type="subagent_error",
                title=f"{role} error",
                status="error",
                payload=data,
                parent_id=subagent_parent,
                started_at=child_timestamp,
                ended_at=child_timestamp,
                duration_ms=0,
                summary=str(child_data.get("error") or "Sub-agent error"),
            )

    def _subagent_parent_id(self, batch_id: str, task_id: str) -> str:
        task_info = self.subagent_tasks.get((batch_id, task_id))
        if task_info:
            return task_info["event_id"]
        batch_info = self.subagent_batches.get(batch_id)
        if batch_info:
            return batch_info["event_id"]
        return self.current_turn_id or self.root_event_id

    def _subagent_active_turn_id(self, batch_id: str, task_id: str) -> Optional[str]:
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
            parent_id=self._subagent_active_turn_id(batch_id, task_id) or self._subagent_parent_id(batch_id, task_id),
            summary=_preview(content),
        )
        self.subagent_message_buffers[key] = []
        self.subagent_message_counts[key] = 0

    def _flush_all_subagent_message_deltas(self) -> None:
        for batch_id, task_id in list(self.subagent_message_buffers.keys()):
            self._flush_subagent_message_delta(batch_id, task_id)

    def _flush_message_delta(self, parent_id: Optional[str] = None) -> None:
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

    def _active_llm_event_id(self) -> Optional[str]:
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
            names = [str(item.get("name") or "tool") for item in tool_calls if isinstance(item, dict)]
            return f"Tool calls: {', '.join(names)}"
        return "LLM response"
