"""Agent tracing repository."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Optional

from sqlalchemy import desc, func, select

from app.core.orm.database import create_session_factory, create_sqlite_engine, session_scope
from app.core.orm.migrations import init_session_schema
from app.core.orm.models.session import TraceEvent, TraceRun


class TraceRepository:
    """Persist Agent trace runs and events."""

    def __init__(self, db_path: str | Path):
        self.db_path = Path(db_path).expanduser()
        self.engine = create_sqlite_engine(self.db_path)
        self.session_factory = create_session_factory(self.engine)
        init_session_schema(self.engine)

    def create_run(
        self,
        *,
        run_id: str,
        root_event_id: str,
        session_id: str,
        started_at: str,
        final_response_preview: str,
        root_event: dict[str, Any],
    ) -> None:
        with session_scope(self.session_factory) as session:
            session.add(
                TraceRun(
                    id=run_id,
                    session_id=session_id,
                    status="running",
                    started_at=started_at,
                    final_response_preview=final_response_preview,
                )
            )
            session.flush()
            session.add(self._event_from_payload(root_event_id, run_id, 0, root_event))

    def add_event(self, *, event_id: str, run_id: str, event: dict[str, Any]) -> str:
        with session_scope(self.session_factory) as session:
            seq = session.scalar(
                select(func.coalesce(func.max(TraceEvent.seq), -1) + 1).where(TraceEvent.run_id == run_id)
            )
            session.add(self._event_from_payload(event_id, run_id, int(seq or 0), event))
        return event_id

    def update_event(self, event_id: str, values: dict[str, Any]) -> None:
        if not values:
            return
        with session_scope(self.session_factory) as session:
            event = session.get(TraceEvent, event_id)
            if not event:
                return
            for key, value in values.items():
                setattr(event, key, value)

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        with session_scope(self.session_factory) as session:
            row = session.get(TraceRun, run_id)
            return self._run_to_dict(row) if row else None

    def finish_run(
        self,
        *,
        run_id: str,
        root_event_id: str,
        values: dict[str, Any],
        root_values: dict[str, Any],
        final_event_id: str,
        final_event: dict[str, Any],
    ) -> None:
        with session_scope(self.session_factory) as session:
            run = session.get(TraceRun, run_id)
            if run:
                for key, value in values.items():
                    setattr(run, key, value)
            root = session.get(TraceEvent, root_event_id)
            if root:
                for key, value in root_values.items():
                    setattr(root, key, value)
            seq = session.scalar(
                select(func.coalesce(func.max(TraceEvent.seq), -1) + 1).where(TraceEvent.run_id == run_id)
            )
            session.add(self._event_from_payload(final_event_id, run_id, int(seq or 0), final_event))

    def get_session_traces(self, session_id: str, limit: int = 20) -> dict[str, Any]:
        clean_limit = max(1, min(limit, 100))
        with session_scope(self.session_factory) as session:
            runs = session.scalars(
                select(TraceRun)
                .where(TraceRun.session_id == session_id)
                .order_by(desc(TraceRun.started_at))
                .limit(clean_limit)
            ).all()
            payload = []
            for run in runs:
                run_dict = self._run_to_dict(run)
                events = session.scalars(
                    select(TraceEvent)
                    .where(TraceEvent.run_id == run.id)
                    .order_by(TraceEvent.seq.asc())
                ).all()
                run_dict["events"] = [self._event_to_dict(event) for event in events]
                payload.append(run_dict)
        return {"session_id": session_id, "runs": payload, "total": len(payload)}

    @staticmethod
    def _event_from_payload(event_id: str, run_id: str, seq: int, event: dict[str, Any]) -> TraceEvent:
        return TraceEvent(
            id=event_id,
            run_id=run_id,
            seq=seq,
            parent_id=event.get("parent_id"),
            node_type=event["node_type"],
            title=event["title"],
            status=event["status"],
            started_at=event["started_at"],
            ended_at=event.get("ended_at"),
            duration_ms=event.get("duration_ms"),
            summary=event.get("summary") or "",
            payload_json=event.get("payload_json") or "{}",
        )

    @staticmethod
    def _run_to_dict(row: TraceRun) -> dict[str, Any]:
        return {
            "id": row.id,
            "session_id": row.session_id,
            "user_message_id": row.user_message_id,
            "assistant_message_id": row.assistant_message_id,
            "status": row.status,
            "started_at": row.started_at,
            "ended_at": row.ended_at,
            "duration_ms": row.duration_ms,
            "error": row.error,
            "final_response_preview": row.final_response_preview,
        }

    @staticmethod
    def _event_to_dict(row: TraceEvent) -> dict[str, Any]:
        return {
            "id": row.id,
            "run_id": row.run_id,
            "seq": row.seq,
            "parent_id": row.parent_id,
            "node_type": row.node_type,
            "title": row.title,
            "status": row.status,
            "started_at": row.started_at,
            "ended_at": row.ended_at,
            "duration_ms": row.duration_ms,
            "summary": row.summary,
            "payload_json": row.payload_json,
        }
