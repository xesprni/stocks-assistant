"""Chat session and trace ORM models."""

from __future__ import annotations

from sqlalchemy import CheckConstraint, Float, ForeignKey, Index, Integer, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.orm.base import SessionBase


class ChatSession(SessionBase):
    __tablename__ = "sessions"
    __table_args__ = (Index("idx_sessions_user_updated", "user_id", "updated_at"),)

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    user_id: Mapped[str | None] = mapped_column(Text)
    title: Mapped[str] = mapped_column(Text, nullable=False, default="新对话")
    created_at: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False)


class ChatMessage(SessionBase):
    __tablename__ = "messages"
    __table_args__ = (
        CheckConstraint("role IN ('user', 'assistant')"),
        UniqueConstraint("session_id", "seq"),
        Index("idx_messages_session_seq", "session_id", "seq"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    session_id: Mapped[str] = mapped_column(Text, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    role: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    metadata_text: Mapped[str] = mapped_column("metadata", Text, nullable=False, default="{}")
    created_at: Mapped[str] = mapped_column(Text, nullable=False)


class TraceRun(SessionBase):
    __tablename__ = "trace_runs"
    __table_args__ = (Index("idx_trace_runs_session_started", "session_id", "started_at"),)

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    session_id: Mapped[str] = mapped_column(Text, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    user_message_id: Mapped[str | None] = mapped_column(Text, ForeignKey("messages.id", ondelete="SET NULL"))
    assistant_message_id: Mapped[str | None] = mapped_column(Text, ForeignKey("messages.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(Text, nullable=False)
    started_at: Mapped[str] = mapped_column(Text, nullable=False)
    ended_at: Mapped[str | None] = mapped_column(Text)
    duration_ms: Mapped[float | None] = mapped_column(Float)
    error: Mapped[str | None] = mapped_column(Text)
    final_response_preview: Mapped[str] = mapped_column(Text, nullable=False, default="")


class TraceEvent(SessionBase):
    __tablename__ = "trace_events"
    __table_args__ = (
        UniqueConstraint("run_id", "seq"),
        Index("idx_trace_events_run_seq", "run_id", "seq"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    run_id: Mapped[str] = mapped_column(Text, ForeignKey("trace_runs.id", ondelete="CASCADE"), nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    parent_id: Mapped[str | None] = mapped_column(Text, ForeignKey("trace_events.id", ondelete="SET NULL"))
    node_type: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    started_at: Mapped[str] = mapped_column(Text, nullable=False)
    ended_at: Mapped[str | None] = mapped_column(Text)
    duration_ms: Mapped[float | None] = mapped_column(Float)
    summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    payload_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
