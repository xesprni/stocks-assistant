"""SQLite-backed trace storage and backwards-compatible recorder exports."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from app.core.orm.repositories.tracing import TraceRepository
from app.core.tracing.payloads import (
    _SECRET_KEYS as _SECRET_KEYS,
)
from app.core.tracing.payloads import (
    _TOOL_CALL_NODE_TYPES as _TOOL_CALL_NODE_TYPES,
)
from app.core.tracing.payloads import (
    _TOOL_RESULT_NODE_TYPES as _TOOL_RESULT_NODE_TYPES,
)
from app.core.tracing.payloads import (
    _TRUNCATION_MARKER as _TRUNCATION_MARKER,
)
from app.core.tracing.payloads import (
    MAX_RESPONSE_PREVIEW_CHARS as MAX_RESPONSE_PREVIEW_CHARS,
)
from app.core.tracing.payloads import (
    MAX_TRACE_STRING_CHARS as MAX_TRACE_STRING_CHARS,
)
from app.core.tracing.payloads import (
    _clean_text as _clean_text,
)
from app.core.tracing.payloads import (
    _decode_json as _decode_json,
)
from app.core.tracing.payloads import (
    _drop_payload_keys as _drop_payload_keys,
)
from app.core.tracing.payloads import (
    _duration_ms as _duration_ms,
)
from app.core.tracing.payloads import (
    _iso_from_timestamp as _iso_from_timestamp,
)
from app.core.tracing.payloads import (
    _json_dumps as _json_dumps,
)
from app.core.tracing.payloads import (
    _new_id as _new_id,
)
from app.core.tracing.payloads import (
    _normalize_payload_for_response as _normalize_payload_for_response,
)
from app.core.tracing.payloads import (
    _now as _now,
)
from app.core.tracing.payloads import (
    _preview as _preview,
)
from app.core.tracing.payloads import (
    _sanitize_payload as _sanitize_payload,
)
from app.core.tracing.recorder import TraceRecorder as TraceRecorder


class TraceStore:
    """Persist Agent run traces in the chat sessions SQLite database."""

    def __init__(self, workspace_dir: str, repository: TraceRepository | None = None):
        root = Path(workspace_dir).expanduser()
        self.db_path = root / "sessions" / "sessions.db"
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.repository = repository or TraceRepository(self.db_path)

    def create_run(self, session_id: str, user_message: str) -> dict[str, str]:
        run_id = _new_id()
        root_event_id = _new_id()
        now = _now()
        self.repository.create_run(
            run_id=run_id,
            root_event_id=root_event_id,
            session_id=session_id,
            started_at=now,
            final_response_preview="",
            root_event={
                "parent_id": None,
                "node_type": "agent_run",
                "title": "Agent run",
                "status": "running",
                "started_at": now,
                "ended_at": None,
                "duration_ms": None,
                "summary": _preview(user_message),
                "payload_json": _json_dumps(
                    {"session_id": session_id, "user_message": user_message}
                ),
            },
        )
        return {"run_id": run_id, "root_event_id": root_event_id}

    def add_event(
        self,
        run_id: str,
        node_type: str,
        title: str,
        status: str = "done",
        payload: dict[str, Any] | None = None,
        parent_id: str | None = None,
        started_at: float | str | None = None,
        ended_at: float | str | None = None,
        duration_ms: float | None = None,
        summary: str = "",
    ) -> str:
        start = self._coerce_time(started_at) if started_at is not None else _now()
        end = self._coerce_time(ended_at) if ended_at is not None else None
        event_id = _new_id()
        return self.repository.add_event(
            event_id=event_id,
            run_id=run_id,
            event={
                "parent_id": parent_id,
                "node_type": node_type,
                "title": title,
                "status": status,
                "started_at": start,
                "ended_at": end,
                "duration_ms": duration_ms,
                "summary": summary,
                "payload_json": _json_dumps(payload or {}),
            },
        )

    def update_event(
        self,
        event_id: str,
        status: str | None = None,
        payload: dict[str, Any] | None = None,
        ended_at: float | str | None = None,
        duration_ms: float | None = None,
        summary: str | None = None,
        title: str | None = None,
    ) -> None:
        values: dict[str, Any] = {}
        if status is not None:
            values["status"] = status
        if payload is not None:
            values["payload_json"] = _json_dumps(payload)
        if ended_at is not None:
            values["ended_at"] = self._coerce_time(ended_at)
        if duration_ms is not None:
            values["duration_ms"] = duration_ms
        if summary is not None:
            values["summary"] = summary
        if title is not None:
            values["title"] = title
        self.repository.update_event(event_id, values)

    def finish_run(
        self,
        run_id: str,
        root_event_id: str,
        status: str,
        user_message_id: str | None = None,
        assistant_message_id: str | None = None,
        final_response: str = "",
        error: str | None = None,
    ) -> None:
        now = _now()
        duration = None
        run_row = self.repository.get_run(run_id)
        if run_row:
            try:
                started = datetime.fromisoformat(run_row["started_at"])
                ended = datetime.fromisoformat(now)
                duration = max(0.0, (ended - started).total_seconds() * 1000)
            except ValueError:
                duration = None
        self.repository.finish_run(
            run_id=run_id,
            root_event_id=root_event_id,
            values={
                "user_message_id": user_message_id,
                "assistant_message_id": assistant_message_id,
                "status": status,
                "ended_at": now,
                "duration_ms": duration,
                "error": error,
                "final_response_preview": _preview(final_response),
            },
            root_values={"status": status, "ended_at": now, "duration_ms": duration},
            final_event_id=_new_id(),
            final_event={
                "parent_id": root_event_id,
                "node_type": "agent_end" if status != "error" else "error",
                "title": "Agent finished" if status != "error" else "Agent failed",
                "status": status,
                "started_at": now,
                "ended_at": now,
                "duration_ms": 0,
                "summary": _preview(error or final_response),
                "payload_json": _json_dumps(
                    {
                        "user_message_id": user_message_id,
                        "assistant_message_id": assistant_message_id,
                        "final_response": final_response,
                        "error": error,
                    }
                ),
            },
        )

    def get_session_traces(self, session_id: str, limit: int = 20) -> dict[str, Any]:
        traces = self.repository.get_session_traces(session_id=session_id, limit=limit)
        for run in traces["runs"]:
            run["events"] = [self._event_row_to_dict(event_row) for event_row in run["events"]]
        return traces

    @staticmethod
    def _coerce_time(value: float | str) -> str:
        if isinstance(value, (float, int)):
            return _iso_from_timestamp(float(value))
        return value

    @staticmethod
    def _run_row_to_dict(row: dict[str, Any]) -> dict[str, Any]:
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
    def _event_row_to_dict(row: dict[str, Any]) -> dict[str, Any]:
        node_type = row["node_type"]
        payload = _decode_json(row["payload_json"], {})
        return {
            "id": row["id"],
            "run_id": row["run_id"],
            "seq": row["seq"],
            "parent_id": row["parent_id"],
            "node_type": node_type,
            "title": row["title"],
            "status": row["status"],
            "started_at": row["started_at"],
            "ended_at": row["ended_at"],
            "duration_ms": row["duration_ms"],
            "summary": row["summary"],
            "payload": _normalize_payload_for_response(node_type, payload),
        }
