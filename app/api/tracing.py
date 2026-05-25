"""Agent tracing API."""

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.session import ChatSessionNotFound
from app.core.security import CurrentUser, require_permissions
from app.deps import get_session_store, get_trace_store
from app.schemas.tracing import TraceSessionResponse

router = APIRouter()


@router.get("/sessions/{session_id}", response_model=TraceSessionResponse)
async def get_session_traces(
    session_id: str,
    limit: int = Query(default=20, ge=1, le=100),
    current_user: CurrentUser = Depends(require_permissions("tracing:read")),
):
    """读取指定会话的 Agent 调用链。"""
    try:
        session = get_session_store().get_session(session_id)
    except ChatSessionNotFound as exc:
        raise HTTPException(status_code=404, detail="Session not found") from exc
    if session.get("user_id") != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=404, detail="Session not found")
    return get_trace_store().get_session_traces(session_id=session_id, limit=limit)
