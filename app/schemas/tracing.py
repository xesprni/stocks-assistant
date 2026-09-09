"""Agent tracing API schemas."""

from typing import Any

from pydantic import BaseModel, Field


class TraceEvent(BaseModel):
    id: str
    run_id: str
    seq: int
    parent_id: str | None = None
    node_type: str
    title: str
    status: str
    started_at: str
    ended_at: str | None = None
    duration_ms: float | None = None
    summary: str = ""
    payload: dict[str, Any] = Field(default_factory=dict)


class TraceRun(BaseModel):
    id: str
    session_id: str
    user_message_id: str | None = None
    assistant_message_id: str | None = None
    status: str
    started_at: str
    ended_at: str | None = None
    duration_ms: float | None = None
    error: str | None = None
    final_response_preview: str = ""
    events: list[TraceEvent] = Field(default_factory=list)


class TraceSessionResponse(BaseModel):
    session_id: str
    runs: list[TraceRun] = Field(default_factory=list)
    total: int = 0
