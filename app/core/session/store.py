"""Chat session store facade."""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from app.core.orm.repositories.session import ChatSessionRepository


VALID_MESSAGE_ROLES = {"user", "assistant"}


class ChatSessionNotFound(KeyError):
    """Raised when a chat session does not exist."""


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _new_id() -> str:
    return str(uuid.uuid4())


def _decode_metadata(value: str | None) -> dict[str, Any]:
    if not value:
        return {}
    try:
        data = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


class ChatSessionStore:
    """Persist chat sessions and visible user/assistant messages."""

    def __init__(self, workspace_dir: str, repository: ChatSessionRepository | None = None):
        root = Path(workspace_dir).expanduser()
        self.db_path = root / "sessions" / "sessions.db"
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.repository = repository or ChatSessionRepository(self.db_path)

    def create_session(
        self,
        user_id: Optional[str] = None,
        title: str = "新对话",
        session_id: Optional[str] = None,
    ) -> dict[str, Any]:
        sid = session_id or _new_id()
        clean_title = title.strip() or "新对话"
        created = self.repository.create_session(sid, user_id, clean_title, _now())
        return self._session_row_to_dict(created)

    def count_sessions(self, user_id: Optional[str] = None) -> int:
        return self.repository.count_sessions(user_id=user_id)

    def list_sessions(self, user_id: Optional[str] = None, limit: int = 50, offset: int = 0) -> list[dict[str, Any]]:
        return [self._session_row_to_dict(row) for row in self.repository.list_sessions(user_id=user_id, limit=limit, offset=offset)]

    def get_session(self, session_id: str) -> dict[str, Any]:
        row = self.repository.get_session(session_id)
        if row is None:
            raise ChatSessionNotFound(session_id)
        return self._session_row_to_dict(row)

    def get_detail(self, session_id: str) -> dict[str, Any]:
        session = self.get_session(session_id)
        session["messages"] = self.get_messages(session_id)
        return session

    def get_messages(self, session_id: str) -> list[dict[str, Any]]:
        self.get_session(session_id)
        return [self._message_row_to_dict(row) for row in self.repository.get_messages(session_id)]

    def append_message(
        self,
        session_id: str,
        role: str,
        content: str,
        metadata: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        if role not in VALID_MESSAGE_ROLES:
            raise ValueError(f"Invalid chat message role: {role}")
        try:
            row = self.repository.append_message(
                session_id=session_id,
                message_id=_new_id(),
                role=role,
                content=content or "",
                metadata_json=json.dumps(metadata or {}, ensure_ascii=False),
                now=_now(),
            )
        except KeyError as exc:
            raise ChatSessionNotFound(session_id) from exc
        return self._message_row_to_dict(row)

    def update_title(self, session_id: str, title: str) -> dict[str, Any]:
        clean_title = title.strip() or "新对话"
        row = self.repository.update_title(session_id, clean_title, _now())
        if row is None:
            raise ChatSessionNotFound(session_id)
        return self._session_row_to_dict(row)

    def clear_messages(self, session_id: str, reset_title: bool = True) -> int:
        deleted = self.repository.clear_messages(session_id, _now(), reset_title=reset_title)
        if deleted is None:
            raise ChatSessionNotFound(session_id)
        return deleted

    def delete_session(self, session_id: str) -> None:
        if not self.repository.delete_session(session_id):
            raise ChatSessionNotFound(session_id)

    def delete_sessions(self, user_id: Optional[str] = None) -> int:
        return self.repository.delete_sessions(user_id=user_id)

    @staticmethod
    def _session_row_to_dict(row: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": row["id"],
            "user_id": row["user_id"],
            "title": row["title"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "message_count": row["message_count"],
            "last_message": row["last_message"],
        }

    @staticmethod
    def _message_row_to_dict(row: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": row["id"],
            "session_id": row["session_id"],
            "role": row["role"],
            "content": row["content"],
            "seq": row["seq"],
            "metadata": _decode_metadata(row["metadata"]),
            "created_at": row["created_at"],
        }

