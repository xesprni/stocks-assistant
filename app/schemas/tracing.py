"""Agent tracing API schemas."""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class TraceEvent(BaseModel):
    id: str
    run_id: str
    seq: int
    parent_id: Optional[str] = None
    node_type: str
    title: str
    status: str
    started_at: str
    ended_at: Optional[str] = None
    duration_ms: Optional[float] = None
    summary: str = ""
    payload: Dict[str, Any] = Field(default_factory=dict)


class TraceRun(BaseModel):
    id: str
    session_id: str
    user_message_id: Optional[str] = None
    assistant_message_id: Optional[str] = None
    status: str
    started_at: str
    ended_at: Optional[str] = None
    duration_ms: Optional[float] = None
    error: Optional[str] = None
    final_response_preview: str = ""
    events: List[TraceEvent] = Field(default_factory=list)


class TraceSessionResponse(BaseModel):
    session_id: str
    runs: List[TraceRun] = Field(default_factory=list)
    total: int = 0
