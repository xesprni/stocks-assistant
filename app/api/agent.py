"""Agent 对话 API

提供同步聊天和 SSE 流式聊天两种接口。
Agent 实例仍按请求创建，对话历史由后端 session store 持久化。
"""

import json
import logging
import queue
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.core.agent.executor import AgentCancelledError
from app.core.session import ChatSessionNotFound
from app.schemas import (
    ChatRequest,
    ChatResponse,
    ChatSessionCreateRequest,
    ChatSessionDetail,
    ChatSessionListResponse,
    ChatSessionSummary,
    ChatSessionUpdateRequest,
)
from app.deps import get_skill_manager, get_memory_manager_for_user, get_session_store
from app.core.security import CurrentUser, require_permissions, user_workspace_dir

router = APIRouter()
logger = logging.getLogger("stocks-assistant.agent.api")

# 后台记忆整理使用共享线程池，避免高频对话时无限创建线程。
# 队列满时直接跳过（记忆整理是尽力而为的后台任务）。
_memory_curator_pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix="memory-curator")
_memory_curator_queue: queue.Queue = queue.Queue(maxsize=10)


def _schedule_memory_curate(
    session_id: str,
    user_message: str,
    assistant_response: str,
    user_message_id: Optional[str] = None,
    assistant_message_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> None:
    from app.config import get_effective_settings

    settings = get_effective_settings(user_id)
    if not settings.memory_enabled or not settings.memory_auto_curate_enabled:
        return

    def run_curator():
        try:
            from app.core.memory.curator import MemoryCurator
            from app.deps import create_memory_llm_provider

            llm_provider = create_memory_llm_provider(settings)
            if not llm_provider:
                logger.info("Memory curator skipped: compatible LLM provider is not configured")
                return

            curator = MemoryCurator(
                llm_provider=llm_provider,
                memory_manager=get_memory_manager_for_user(user_id),
                model=settings.llm_model,
                min_importance=settings.memory_curator_min_importance,
                min_confidence=settings.memory_curator_min_confidence,
            )
            curator.curate_exchange(
                session_id=session_id,
                user_message=user_message,
                assistant_response=assistant_response,
                user_message_id=user_message_id,
                assistant_message_id=assistant_message_id,
                user_id=user_id,
            )
        except Exception as exc:
            logger.warning("Memory curator failed for session %s: %s", session_id, exc)

    # 入队；队列满时跳过（记忆整理是尽力而为的后台任务，不阻塞对话响应）。
    try:
        _memory_curator_queue.put_nowait(run_curator)
    except queue.Full:
        logger.debug("Memory curator queue full, skipping exchange for session %s", session_id)
        return

    def _drain():
        while True:
            try:
                task = _memory_curator_queue.get_nowait()
            except queue.Empty:
                break
            _memory_curator_pool.submit(task)

    _drain()


def _build_agent(user_id: Optional[str] = None):
    from app.core.agent.agent import Agent
    from app.core.agent.models import LLMModel
    from app.config import DEFAULT_SYSTEM_PROMPT, get_effective_settings

    settings = get_effective_settings(user_id)
    workspace_dir = user_workspace_dir(settings.workspace_dir, user_id) if user_id else settings.workspace_dir
    from app.deps import create_llm_provider

    llm = create_llm_provider(settings)
    skill_mgr = get_skill_manager()
    memory_mgr = get_memory_manager_for_user(user_id) if settings.memory_enabled else None

    from app.core.tools.tool_manager import ToolManager
    from pathlib import Path

    tool_manager = ToolManager(workspace_dir=str(Path(workspace_dir).expanduser()), user_id=user_id)
    tool_manager.load_builtin_tools(memory_manager=memory_mgr, user_id=user_id)
    tools = tool_manager.get_all_tools()
    if settings.mcp_servers:
        try:
            from app.deps import get_mcp_manager, get_mcp_manager_for_user

            tools.extend((get_mcp_manager_for_user(user_id) if user_id else get_mcp_manager()).get_tools())
        except Exception:
            pass
    from app.core.tools.permissions import filter_agent_tools

    tools = filter_agent_tools(tools, settings)

    model = LLMModel(model=settings.llm_model)
    model.call = llm.call
    model.call_stream = llm.call_stream

    system_prompt = settings.system_prompt or DEFAULT_SYSTEM_PROMPT

    return Agent(
        system_prompt=system_prompt,
        model=model,
        tools=tools,
        max_steps=settings.agent_max_steps,
        max_context_tokens=settings.agent_max_context_tokens,
        max_context_turns=settings.agent_max_context_turns,
        memory_manager=memory_mgr,
        workspace_dir=workspace_dir,
        skill_manager=skill_mgr,
        settings=settings,
    )


def _is_agent_cancelled(exc: Exception) -> bool:
    return isinstance(exc, AgentCancelledError)


def _title_from_text(text: str) -> str:
    title = " ".join(text.strip().split())
    if not title:
        return "新对话"
    return title[:30] + ("..." if len(title) > 30 else "")


def _agent_message(role: str, content: str) -> dict:
    return {"role": role, "content": [{"type": "text", "text": content}]}


def _init_agent(request: ChatRequest, history_messages: list[dict]):
    agent = _build_agent(request.user_id)
    for msg in history_messages:
        role = msg.get("role")
        content = msg.get("content", "")
        if role in ("user", "assistant") and content:
            agent.messages.append(_agent_message(role, content))
    return agent


def _assert_session_owner(session: dict, user: CurrentUser) -> None:
    owner = session.get("user_id")
    if owner and owner != user.id and not user.is_admin:
        raise HTTPException(status_code=404, detail="Session not found")


def _prepare_session(request: ChatRequest, user: CurrentUser) -> tuple[str, list[dict]]:
    store = get_session_store()
    history_messages: list[dict] = []

    if request.session_id:
        try:
            session = store.get_session(request.session_id)
            _assert_session_owner(session, user)
            if request.clear_history:
                store.clear_messages(request.session_id)
            else:
                history_messages = store.get_messages(request.session_id)
        except ChatSessionNotFound:
            raise HTTPException(status_code=404, detail="Session not found")
        return request.session_id, history_messages

    session = store.create_session(
        user_id=user.id,
        title=_title_from_text(request.message),
    )
    if request.history and not request.clear_history:
        for msg in request.history:
            role = msg.get("role")
            content = msg.get("content", "")
            if role in ("user", "assistant") and content:
                history_messages.append(store.append_message(session["id"], role, content, {"source": "legacy_history"}))
    return session["id"], history_messages


def _persist_exchange(session_id: str, user_message: str, assistant_response: str, was_empty: bool) -> tuple[str, str]:
    store = get_session_store()
    user_msg = store.append_message(session_id, "user", user_message)
    assistant_msg = store.append_message(session_id, "assistant", assistant_response)
    if was_empty:
        store.update_title(session_id, _title_from_text(user_message))
    return user_msg["id"], assistant_msg["id"]


def _session_or_404(session_id: str) -> dict:
    try:
        return get_session_store().get_detail(session_id)
    except ChatSessionNotFound:
        raise HTTPException(status_code=404, detail="Session not found")


def _start_trace(session_id: str, user_message: str, user_id: Optional[str] = None):
    from app.config import get_effective_settings

    if not get_effective_settings(user_id).tracing_enabled:
        return None
    try:
        from app.core.tracing import TraceRecorder
        from app.deps import get_trace_store

        return TraceRecorder.start(get_trace_store(), session_id=session_id, user_message=user_message)
    except Exception as exc:
        logger.warning("Failed to start trace run: %s", exc)
        return None


def _record_trace_event(recorder, event: dict) -> None:
    if not recorder:
        return
    recorder.handle_event(event)


def _finish_trace(
    recorder,
    status: str,
    user_message_id: Optional[str] = None,
    assistant_message_id: Optional[str] = None,
    final_response: str = "",
    error: Optional[str] = None,
) -> None:
    if not recorder:
        return
    recorder.finish(
        status=status,
        user_message_id=user_message_id,
        assistant_message_id=assistant_message_id,
        final_response=final_response,
        error=error,
    )


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest, current_user: CurrentUser = Depends(require_permissions("chat:write"))):
    recorder = None
    try:
        session_id, history_messages = _prepare_session(request, current_user)
        request.user_id = current_user.id
        recorder = _start_trace(session_id, request.message, current_user.id)
        agent = _init_agent(request, history_messages)
        response = agent.run_stream(
            user_message=request.message,
            on_event=recorder.handle_event if recorder else None,
            clear_history=False,
            skill_filter=request.skill_filter,
            thinking_enabled=request.thinking_enabled,
        )
        user_message_id, message_id = _persist_exchange(session_id, request.message, response, was_empty=len(history_messages) == 0)
        _finish_trace(
            recorder,
            status="done",
            user_message_id=user_message_id,
            assistant_message_id=message_id,
            final_response=response,
        )
        _schedule_memory_curate(
            session_id=session_id,
            user_message=request.message,
            assistant_response=response,
            user_message_id=user_message_id,
            assistant_message_id=message_id,
            user_id=current_user.id,
        )
        return ChatResponse(response=response, session_id=session_id, message_id=message_id)
    except HTTPException:
        raise
    except Exception as e:
        _finish_trace(recorder, status="error", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/stream")
async def stream_chat(request: ChatRequest, current_user: CurrentUser = Depends(require_permissions("chat:write"))):
    session_id, history_messages = _prepare_session(request, current_user)
    request.user_id = current_user.id
    recorder = _start_trace(session_id, request.message, current_user.id)
    agent = _init_agent(request, history_messages)
    cancel_event = threading.Event()

    def event_generator():
        event_queue: queue.Queue = queue.Queue()
        done = object()
        reasoning_notice_sent = False

        def on_event(event: dict):
            nonlocal reasoning_notice_sent
            _record_trace_event(recorder, event)
            event_type = event.get("type")

            # Do not expose model-private chain-of-thought. The UI still gets
            # useful public progress signals via status/tool/message events.
            if event_type == "reasoning_update":
                if not reasoning_notice_sent:
                    reasoning_notice_sent = True
                    event_queue.put({
                        "type": "status_update",
                        "timestamp": event.get("timestamp", time.time()),
                        "data": {"message": "Model is analyzing the request."},
                    })
                return

            if event_type == "subagent_event":
                child_type = str((event.get("data") or {}).get("child_event_type") or "")
                if child_type in {"reasoning_update", "llm_call_start", "llm_call_end", "llm_call_error"}:
                    return

            # The executor emits agent_end before the message is persisted.
            # Send the public terminal event after persistence so the client
            # receives session_id and message_id together with the final text.
            if event_type == "agent_end":
                return

            if event_type in ("llm_call_start", "llm_call_end", "llm_call_error"):
                return

            event_queue.put(event)

        def run_agent():
            try:
                response = agent.run_stream(
                    user_message=request.message,
                    on_event=on_event,
                    clear_history=False,
                    skill_filter=request.skill_filter,
                    cancel_event=cancel_event,
                    thinking_enabled=request.thinking_enabled,
                )
                user_message_id, message_id = _persist_exchange(session_id, request.message, response, was_empty=len(history_messages) == 0)
                _finish_trace(
                    recorder,
                    status="done",
                    user_message_id=user_message_id,
                    assistant_message_id=message_id,
                    final_response=response,
                )
                _schedule_memory_curate(
                    session_id=session_id,
                    user_message=request.message,
                    assistant_response=response,
                    user_message_id=user_message_id,
                    assistant_message_id=message_id,
                    user_id=current_user.id,
                )
                event_queue.put({
                    "type": "agent_end",
                    "timestamp": time.time(),
                    "data": {
                        "final_response": response,
                        "session_id": session_id,
                        "message_id": message_id,
                    },
                })
            except Exception as e:
                if _is_agent_cancelled(e):
                    _finish_trace(recorder, status="cancelled", error=str(e))
                    event_queue.put({
                        "type": "agent_stopped",
                        "timestamp": time.time(),
                        "data": {"session_id": session_id},
                    })
                    return
                _finish_trace(recorder, status="error", error=str(e))
                event_queue.put({
                    "type": "error",
                    "timestamp": time.time(),
                    "data": {"error": str(e)},
                })
            finally:
                event_queue.put(done)

        threading.Thread(target=run_agent, daemon=True).start()

        try:
            while True:
                event = event_queue.get()
                if event is done:
                    break
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        finally:
            cancel_event.set()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/sessions", response_model=ChatSessionListResponse)
async def list_sessions(
    user_id: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(require_permissions("chat:read")),
):
    store = get_session_store()
    effective_user_id = user_id if (user_id and current_user.is_admin) else current_user.id
    sessions = store.list_sessions(user_id=effective_user_id, limit=limit, offset=offset)
    return ChatSessionListResponse(sessions=sessions, total=store.count_sessions(user_id=effective_user_id))


@router.post("/sessions", response_model=ChatSessionDetail)
async def create_session(request: ChatSessionCreateRequest, current_user: CurrentUser = Depends(require_permissions("chat:write"))):
    session = get_session_store().create_session(
        user_id=current_user.id,
        title=request.title or "新对话",
    )
    return get_session_store().get_detail(session["id"])


@router.delete("/sessions")
async def delete_sessions(current_user: CurrentUser = Depends(require_permissions("chat:write"))):
    deleted = get_session_store().delete_sessions(user_id=current_user.id)
    return {"status": "ok", "deleted": deleted, "tracing": "cleared_by_session_cascade"}


@router.get("/sessions/{session_id}", response_model=ChatSessionDetail)
async def get_session(session_id: str, current_user: CurrentUser = Depends(require_permissions("chat:read"))):
    session = _session_or_404(session_id)
    _assert_session_owner(session, current_user)
    return session


@router.patch("/sessions/{session_id}", response_model=ChatSessionSummary)
async def update_session(
    session_id: str,
    request: ChatSessionUpdateRequest,
    current_user: CurrentUser = Depends(require_permissions("chat:write")),
):
    try:
        _assert_session_owner(get_session_store().get_session(session_id), current_user)
        return get_session_store().update_title(session_id, request.title)
    except ChatSessionNotFound:
        raise HTTPException(status_code=404, detail="Session not found")


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str, current_user: CurrentUser = Depends(require_permissions("chat:write"))):
    try:
        _assert_session_owner(get_session_store().get_session(session_id), current_user)
        get_session_store().delete_session(session_id)
    except ChatSessionNotFound:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": "ok"}


@router.delete("/sessions/{session_id}/messages")
async def clear_session_messages(session_id: str, current_user: CurrentUser = Depends(require_permissions("chat:write"))):
    try:
        _assert_session_owner(get_session_store().get_session(session_id), current_user)
        deleted = get_session_store().clear_messages(session_id)
    except ChatSessionNotFound:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": "ok", "deleted": deleted}


@router.delete("/history")
async def clear_history(
    session_id: Optional[str] = None,
    current_user: CurrentUser = Depends(require_permissions("chat:write")),
):
    if not session_id:
        return {
            "status": "ok",
            "message": "No session_id supplied; stateless requests have no server history to clear",
        }
    try:
        _assert_session_owner(get_session_store().get_session(session_id), current_user)
        deleted = get_session_store().clear_messages(session_id)
    except ChatSessionNotFound:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": "ok", "deleted": deleted}
