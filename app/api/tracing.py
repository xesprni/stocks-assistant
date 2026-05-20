"""Agent tracing API."""

from fastapi import APIRouter, Query

from app.deps import get_trace_store
from app.schemas.tracing import TraceSessionResponse

router = APIRouter()


@router.get("/sessions/{session_id}", response_model=TraceSessionResponse)
async def get_session_traces(
    session_id: str,
    limit: int = Query(default=20, ge=1, le=100),
):
    """读取指定会话的 Agent 调用链。"""
    return get_trace_store().get_session_traces(session_id=session_id, limit=limit)
