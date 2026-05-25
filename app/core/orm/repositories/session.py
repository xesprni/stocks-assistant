"""Chat session repository."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Optional

from sqlalchemy import delete, desc, func, select

from app.core.orm.database import create_session_factory, create_sqlite_engine, session_scope
from app.core.orm.migrations import init_session_schema
from app.core.orm.models.session import ChatMessage, ChatSession


class ChatSessionRepository:
    """Persist chat sessions and visible messages."""

    def __init__(self, db_path: str | Path):
        self.db_path = Path(db_path).expanduser()
        self.engine = create_sqlite_engine(self.db_path)
        self.session_factory = create_session_factory(self.engine)
        init_session_schema(self.engine)

    def create_session(self, session_id: str, user_id: Optional[str], title: str, now: str) -> dict[str, Any]:
        with session_scope(self.session_factory) as session:
            session.add(ChatSession(id=session_id, user_id=user_id, title=title, created_at=now, updated_at=now))
        return self.get_session(session_id)

    def count_sessions(self, user_id: Optional[str] = None) -> int:
        with session_scope(self.session_factory) as session:
            stmt = select(func.count()).select_from(ChatSession)
            if user_id:
                stmt = stmt.where(ChatSession.user_id == user_id)
            return int(session.scalar(stmt) or 0)

    def list_sessions(self, user_id: Optional[str] = None, limit: int = 50, offset: int = 0) -> list[dict[str, Any]]:
        clean_limit = max(1, min(limit, 200))
        clean_offset = max(0, offset)
        with session_scope(self.session_factory) as session:
            stmt = select(ChatSession)
            if user_id:
                stmt = stmt.where(ChatSession.user_id == user_id)
            rows = session.scalars(stmt.order_by(desc(ChatSession.updated_at)).limit(clean_limit).offset(clean_offset)).all()
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
                select(func.coalesce(func.max(ChatMessage.seq), -1) + 1).where(ChatMessage.session_id == session_id)
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
            result = session.execute(delete(ChatMessage).where(ChatMessage.session_id == session_id))
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

    def delete_sessions(self, user_id: Optional[str] = None) -> int:
        with session_scope(self.session_factory) as session:
            stmt = delete(ChatSession)
            if user_id:
                stmt = stmt.where(ChatSession.user_id == user_id)
            result = session.execute(stmt)
            return int(result.rowcount or 0)

    def _session_summary(self, session, row: ChatSession) -> dict[str, Any]:
        count = session.scalar(select(func.count()).select_from(ChatMessage).where(ChatMessage.session_id == row.id))
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
