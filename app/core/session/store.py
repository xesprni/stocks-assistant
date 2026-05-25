"""SQLite-backed chat session store."""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Optional


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

    def __init__(self, workspace_dir: str):
        root = Path(workspace_dir).expanduser()
        self.db_path = root / "sessions" / "sessions.db"
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def create_session(
        self,
        user_id: Optional[str] = None,
        title: str = "新对话",
        session_id: Optional[str] = None,
    ) -> dict[str, Any]:
        now = _now()
        sid = session_id or _new_id()
        clean_title = title.strip() or "新对话"
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO sessions (id, user_id, title, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (sid, user_id, clean_title, now, now),
            )
            conn.commit()
        return self.get_session(sid)

    def count_sessions(self, user_id: Optional[str] = None) -> int:
        query = "SELECT COUNT(*) FROM sessions"
        params: list[Any] = []
        if user_id:
            query += " WHERE user_id = ?"
            params.append(user_id)
        with self._connect() as conn:
            return int(conn.execute(query, params).fetchone()[0])

    def list_sessions(self, user_id: Optional[str] = None, limit: int = 50, offset: int = 0) -> list[dict[str, Any]]:
        query = """
            SELECT
                s.id,
                s.user_id,
                s.title,
                s.created_at,
                s.updated_at,
                COUNT(m.id) AS message_count,
                (
                    SELECT content
                    FROM messages lm
                    WHERE lm.session_id = s.id
                    ORDER BY lm.seq DESC
                    LIMIT 1
                ) AS last_message
            FROM sessions s
            LEFT JOIN messages m ON m.session_id = s.id
        """
        params: list[Any] = []
        if user_id:
            query += " WHERE s.user_id = ?"
            params.append(user_id)
        query += " GROUP BY s.id ORDER BY s.updated_at DESC LIMIT ? OFFSET ?"
        params.append(max(1, min(limit, 200)))
        params.append(max(0, offset))
        with self._connect() as conn:
            return [self._session_row_to_dict(row) for row in conn.execute(query, params).fetchall()]

    def get_session(self, session_id: str) -> dict[str, Any]:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT
                    s.id,
                    s.user_id,
                    s.title,
                    s.created_at,
                    s.updated_at,
                    COUNT(m.id) AS message_count,
                    (
                        SELECT content
                        FROM messages lm
                        WHERE lm.session_id = s.id
                        ORDER BY lm.seq DESC
                        LIMIT 1
                    ) AS last_message
                FROM sessions s
                LEFT JOIN messages m ON m.session_id = s.id
                WHERE s.id = ?
                GROUP BY s.id
                """,
                (session_id,),
            ).fetchone()
        if row is None:
            raise ChatSessionNotFound(session_id)
        return self._session_row_to_dict(row)

    def get_detail(self, session_id: str) -> dict[str, Any]:
        session = self.get_session(session_id)
        session["messages"] = self.get_messages(session_id)
        return session

    def get_messages(self, session_id: str) -> list[dict[str, Any]]:
        self.get_session(session_id)
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, session_id, role, content, seq, metadata, created_at
                FROM messages
                WHERE session_id = ?
                ORDER BY seq ASC
                """,
                (session_id,),
            ).fetchall()
        return [self._message_row_to_dict(row) for row in rows]

    def append_message(
        self,
        session_id: str,
        role: str,
        content: str,
        metadata: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        if role not in VALID_MESSAGE_ROLES:
            raise ValueError(f"Invalid chat message role: {role}")
        now = _now()
        message_id = _new_id()
        clean_content = content or ""
        metadata_json = json.dumps(metadata or {}, ensure_ascii=False)
        with self._connect() as conn:
            session = conn.execute("SELECT id FROM sessions WHERE id = ?", (session_id,)).fetchone()
            if session is None:
                raise ChatSessionNotFound(session_id)
            seq = conn.execute(
                "SELECT COALESCE(MAX(seq), -1) + 1 FROM messages WHERE session_id = ?",
                (session_id,),
            ).fetchone()[0]
            conn.execute(
                """
                INSERT INTO messages (id, session_id, role, content, seq, metadata, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (message_id, session_id, role, clean_content, seq, metadata_json, now),
            )
            conn.execute("UPDATE sessions SET updated_at = ? WHERE id = ?", (now, session_id))
            conn.commit()
            row = conn.execute(
                """
                SELECT id, session_id, role, content, seq, metadata, created_at
                FROM messages
                WHERE id = ?
                """,
                (message_id,),
            ).fetchone()
        return self._message_row_to_dict(row)

    def update_title(self, session_id: str, title: str) -> dict[str, Any]:
        clean_title = title.strip() or "新对话"
        now = _now()
        with self._connect() as conn:
            cursor = conn.execute(
                "UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?",
                (clean_title, now, session_id),
            )
            conn.commit()
        if cursor.rowcount == 0:
            raise ChatSessionNotFound(session_id)
        return self.get_session(session_id)

    def clear_messages(self, session_id: str, reset_title: bool = True) -> int:
        now = _now()
        with self._connect() as conn:
            session = conn.execute("SELECT id FROM sessions WHERE id = ?", (session_id,)).fetchone()
            if session is None:
                raise ChatSessionNotFound(session_id)
            cursor = conn.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
            if reset_title:
                conn.execute(
                    "UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?",
                    ("新对话", now, session_id),
                )
            else:
                conn.execute("UPDATE sessions SET updated_at = ? WHERE id = ?", (now, session_id))
            conn.commit()
        return cursor.rowcount

    def delete_session(self, session_id: str) -> None:
        with self._connect() as conn:
            cursor = conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
            conn.commit()
        if cursor.rowcount == 0:
            raise ChatSessionNotFound(session_id)

    def delete_sessions(self, user_id: Optional[str] = None) -> int:
        query = "DELETE FROM sessions"
        params: list[Any] = []
        if user_id:
            query += " WHERE user_id = ?"
            params.append(user_id)
        with self._connect() as conn:
            cursor = conn.execute(query, params)
            conn.commit()
        return cursor.rowcount

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    user_id TEXT,
                    title TEXT NOT NULL DEFAULT '新对话',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            session_cols = {row[1] for row in conn.execute("PRAGMA table_info(sessions)").fetchall()}
            if "user_id" not in session_cols:
                conn.execute("ALTER TABLE sessions ADD COLUMN user_id TEXT")
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
                    content TEXT NOT NULL,
                    seq INTEGER NOT NULL,
                    metadata TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
                    UNIQUE(session_id, seq)
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user_updated ON sessions(user_id, updated_at)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_session_seq ON messages(session_id, seq)")
            conn.commit()

    @staticmethod
    def _session_row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
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
    def _message_row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "session_id": row["session_id"],
            "role": row["role"],
            "content": row["content"],
            "seq": row["seq"],
            "metadata": _decode_metadata(row["metadata"]),
            "created_at": row["created_at"],
        }
