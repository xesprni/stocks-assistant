"""Chat session repository."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from sqlalchemy import case, delete, desc, func, select, update

from app.core.orm.database import create_session_factory, create_sqlite_engine, session_scope
from app.core.orm.migrations import init_session_schema
from app.core.orm.models.session import ChatInputRecord, ChatMessage, ChatSession


class ChatSessionRepository:
    """Persist chat sessions and visible messages."""

    def __init__(self, db_path: str | Path):
        self.db_path = Path(db_path).expanduser()
        self.engine = create_sqlite_engine(self.db_path)
        self.session_factory = create_session_factory(self.engine)
        init_session_schema(self.engine)

    def create_session(
        self, session_id: str, user_id: str | None, title: str, now: str
    ) -> dict[str, Any]:
        with session_scope(self.session_factory) as session:
            session.add(
                ChatSession(
                    id=session_id, user_id=user_id, title=title, created_at=now, updated_at=now
                )
            )
        return self.get_session(session_id)

    def count_sessions(self, user_id: str | None = None) -> int:
        with session_scope(self.session_factory) as session:
            stmt = select(func.count()).select_from(ChatSession)
            if user_id:
                stmt = stmt.where(ChatSession.user_id == user_id)
            return int(session.scalar(stmt) or 0)

    def list_sessions(
        self, user_id: str | None = None, limit: int = 50, offset: int = 0
    ) -> list[dict[str, Any]]:
        clean_limit = max(1, min(limit, 200))
        clean_offset = max(0, offset)
        with session_scope(self.session_factory) as session:
            stmt = select(ChatSession)
            if user_id:
                stmt = stmt.where(ChatSession.user_id == user_id)
            rows = session.scalars(
                stmt.order_by(desc(ChatSession.updated_at)).limit(clean_limit).offset(clean_offset)
            ).all()
            return [self._session_summary(session, row) for row in rows]

    def get_session(self, session_id: str) -> dict[str, Any] | None:
        with session_scope(self.session_factory) as session:
            row = session.get(ChatSession, session_id)
            return self._session_summary(session, row) if row else None

    def get_messages(self, session_id: str) -> list[dict[str, Any]]:
        with session_scope(self.session_factory) as session:
            rows = session.scalars(
                select(ChatMessage)
                .where(ChatMessage.session_id == session_id)
                .order_by(ChatMessage.seq.asc())
            ).all()
            return [self._message_to_dict(row) for row in rows]

    def append_message(
        self,
        session_id: str,
        message_id: str,
        role: str,
        content: str,
        metadata_json: str,
        now: str,
    ) -> dict[str, Any]:
        with session_scope(self.session_factory) as session:
            chat = session.get(ChatSession, session_id)
            if chat is None:
                raise KeyError(session_id)
            seq = session.scalar(
                select(func.coalesce(func.max(ChatMessage.seq), -1) + 1).where(
                    ChatMessage.session_id == session_id
                )
            )
            message = ChatMessage(
                id=message_id,
                session_id=session_id,
                role=role,
                content=content,
                seq=int(seq or 0),
                metadata_text=metadata_json,
                created_at=now,
            )
            chat.updated_at = now
            session.add(message)
            session.flush()
            return self._message_to_dict(message)

    def update_title(self, session_id: str, title: str, now: str) -> dict[str, Any] | None:
        with session_scope(self.session_factory) as session:
            chat = session.get(ChatSession, session_id)
            if chat is None:
                return None
            chat.title = title
            chat.updated_at = now
        return self.get_session(session_id)

    def clear_messages(self, session_id: str, now: str, reset_title: bool = True) -> int | None:
        with session_scope(self.session_factory) as session:
            chat = session.get(ChatSession, session_id)
            if chat is None:
                return None
            result = session.execute(
                delete(ChatMessage).where(ChatMessage.session_id == session_id)
            )
            session.execute(delete(ChatInputRecord).where(ChatInputRecord.session_id == session_id))
            chat.input_queue_paused = 0
            if reset_title:
                chat.title = "新对话"
            chat.updated_at = now
            return int(result.rowcount or 0)

    def delete_session(self, session_id: str) -> bool:
        with session_scope(self.session_factory) as session:
            chat = session.get(ChatSession, session_id)
            if chat is None:
                return False
            session.delete(chat)
            return True

    def delete_sessions(self, user_id: str | None = None) -> int:
        with session_scope(self.session_factory) as session:
            stmt = delete(ChatSession)
            if user_id:
                stmt = stmt.where(ChatSession.user_id == user_id)
            result = session.execute(stmt)
            return int(result.rowcount or 0)

    def _session_summary(self, session, row: ChatSession) -> dict[str, Any]:
        count = session.scalar(
            select(func.count()).select_from(ChatMessage).where(ChatMessage.session_id == row.id)
        )
        last = session.scalar(
            select(ChatMessage.content)
            .where(ChatMessage.session_id == row.id)
            .order_by(ChatMessage.seq.desc())
            .limit(1)
        )
        return {
            "id": row.id,
            "user_id": row.user_id,
            "title": row.title,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
            "message_count": int(count or 0),
            "last_message": last,
            "input_queue_paused": bool(row.input_queue_paused),
        }

    def list_inputs(
        self,
        session_id: str,
        *,
        status: str | None = None,
        mode: str | None = None,
        target_run_id: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        with session_scope(self.session_factory) as session:
            stmt = select(ChatInputRecord).where(ChatInputRecord.session_id == session_id)
            if status:
                stmt = stmt.where(ChatInputRecord.status == status)
            if mode:
                stmt = stmt.where(ChatInputRecord.mode == mode)
            if target_run_id:
                stmt = stmt.where(ChatInputRecord.target_run_id == target_run_id)
            # 返回最近记录但维持入队顺序；待执行总数由服务层限制为 20。
            priority = case((ChatInputRecord.status.in_(["pending", "running"]), 0), else_=1)
            rows = session.scalars(
                stmt.order_by(priority, ChatInputRecord.seq.desc()).limit(limit)
            ).all()
            return [self._input_to_dict(row) for row in sorted(rows, key=lambda row: row.seq)]

    def apply_steer_inputs(self, session_id: str, run_id: str, now: str) -> list[dict[str, Any]]:
        with session_scope(self.session_factory) as session:
            rows = session.scalars(
                select(ChatInputRecord)
                .where(
                    ChatInputRecord.session_id == session_id,
                    ChatInputRecord.target_run_id == run_id,
                    ChatInputRecord.mode == "steer",
                    ChatInputRecord.status == "pending",
                )
                .order_by(ChatInputRecord.seq)
            ).all()
            # 同批补充共同提交；部分数据库失败不会留下已标 applied 却未注入模型的记录。
            for row in rows:
                row.status, row.run_id, row.updated_at = "applied", run_id, now
            session.flush()
            return [self._input_to_dict(row) for row in rows]

    def unfinished_run_inputs(self, session_id: str, run_id: str) -> list[dict[str, Any]]:
        with session_scope(self.session_factory) as session:
            rows = session.scalars(
                select(ChatInputRecord)
                .where(
                    ChatInputRecord.session_id == session_id,
                    (ChatInputRecord.run_id == run_id) | (ChatInputRecord.target_run_id == run_id),
                    ChatInputRecord.status.in_(["pending", "running", "applied"]),
                )
                .order_by(ChatInputRecord.seq)
            ).all()
            return [self._input_to_dict(row) for row in rows]

    def find_input(
        self, session_id: str, *, input_id: str | None = None, request_id: str | None = None
    ) -> dict[str, Any] | None:
        with session_scope(self.session_factory) as session:
            stmt = select(ChatInputRecord).where(ChatInputRecord.session_id == session_id)
            if input_id:
                stmt = stmt.where(ChatInputRecord.id == input_id)
            if request_id:
                stmt = stmt.where(ChatInputRecord.request_id == request_id)
            row = session.scalar(stmt)
            return self._input_to_dict(row) if row else None

    def create_input(self, values: dict[str, Any]) -> dict[str, Any]:
        with session_scope(self.session_factory) as session:
            seq = session.scalar(
                select(func.coalesce(func.max(ChatInputRecord.seq), -1) + 1).where(
                    ChatInputRecord.session_id == values["session_id"]
                )
            )
            row = ChatInputRecord(**values, seq=int(seq or 0))
            session.add(row)
            session.flush()
            return self._input_to_dict(row)

    def update_input(self, input_id: str, **values: Any) -> dict[str, Any]:
        with session_scope(self.session_factory) as session:
            row = session.get(ChatInputRecord, input_id)
            if row is None:
                raise KeyError(input_id)
            for key, value in values.items():
                setattr(row, key, value)
            session.flush()
            return self._input_to_dict(row)

    def pause_inputs(self, session_id: str, paused: bool) -> None:
        with session_scope(self.session_factory) as session:
            session.execute(
                update(ChatSession)
                .where(ChatSession.id == session_id)
                .values(input_queue_paused=int(paused))
            )

    def recover_inputs(self, now: str) -> None:
        """进程不重放运行中工具；保留尚未执行的队列，等待用户显式继续。"""
        with session_scope(self.session_factory) as session:
            unfinished = select(ChatInputRecord.session_id).where(
                ChatInputRecord.status.in_(["pending", "running", "applied"])
            )
            session.execute(
                update(ChatSession)
                .where(ChatSession.id.in_(unfinished))
                .values(input_queue_paused=1)
            )
            session.execute(
                update(ChatInputRecord)
                .where(
                    (ChatInputRecord.status.in_(["running", "applied"]))
                    | ((ChatInputRecord.mode == "steer") & (ChatInputRecord.status == "pending"))
                )
                .values(
                    status="failed",
                    updated_at=now,
                    error="Run interrupted by process restart; input was not replayed",
                )
            )

    @staticmethod
    def _input_to_dict(row: ChatInputRecord) -> dict[str, Any]:
        return {
            key: getattr(row, key)
            for key in (
                "id",
                "session_id",
                "request_id",
                "message",
                "mode",
                "status",
                "target_run_id",
                "run_id",
                "thinking_enabled",
                "fingerprint",
                "seq",
                "created_at",
                "updated_at",
                "error",
            )
        }

    @staticmethod
    def _message_to_dict(row: ChatMessage) -> dict[str, Any]:
        return {
            "id": row.id,
            "session_id": row.session_id,
            "role": row.role,
            "content": row.content,
            "seq": row.seq,
            "metadata": row.metadata_text,
            "created_at": row.created_at,
        }
