"""Agent 对话 API

提供同步聊天和 SSE 流式聊天两种接口。
Agent 实例仍按请求创建，对话历史由后端 session store 持久化。
"""

import json
import logging
import threading
import time
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.core.agent.executor import AgentCancelledError
from app.core.agent.input_service import ChatInputService
from app.core.agent.run_service import ChatRun, ChatRunCapacityError, ChatRunConflict, chat_runs
from app.core.security import CurrentUser, require_permissions
from app.core.session import ChatSessionNotFound
from app.deps import get_memory_manager_for_user, get_session_store
from app.schemas import (
    ChatRequest,
    ChatResponse,
    ChatSessionCreateRequest,
    ChatSessionDetail,
    ChatSessionListResponse,
    ChatSessionSummary,
    ChatSessionUpdateRequest,
)
from app.schemas.chat_inputs import ChatInput, ChatInputList, ChatInputRequest

router = APIRouter()
logger = logging.getLogger("stocks-assistant.agent.api")

# 后台记忆整理使用共享线程池，避免高频对话时无限创建线程。
# 队列满时直接跳过（记忆整理是尽力而为的后台任务）。
_memory_curator_pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix="memory-curator")
_memory_curator_slots = threading.BoundedSemaphore(13)  # 3 个执行中 + 10 个待执行


def _schedule_memory_curate(
    session_id: str,
    user_message: str,
    assistant_response: str,
    user_message_id: str | None = None,
    assistant_message_id: str | None = None,
    user_id: str | None = None,
) -> None:
    from app.config import get_effective_settings

    settings = get_effective_settings(user_id)
    if not settings.memory_enabled or not settings.memory_auto_curate_enabled:
        return

    # ThreadPoolExecutor 自身队列无界，配额必须覆盖执行中和待执行任务。
    if not _memory_curator_slots.acquire(blocking=False):
        logger.debug("Memory curator queue full, skipping exchange for session %s", session_id)
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
        finally:
            _memory_curator_slots.release()

    try:
        _memory_curator_pool.submit(run_curator)
    except RuntimeError:
        _memory_curator_slots.release()
        logger.warning("Memory curator pool is unavailable", exc_info=True)


def _build_agent(user_id: str | None = None):
    """兼容既有调用方；聊天和调度使用同一个无状态工厂。"""
    from app.core.agent.factory import create_agent

    return create_agent(user_id)


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
            rendered_images = (msg.get("metadata") or {}).get("rendered_images")
            if rendered_images:
                # 历史仅注入产物引用；需要再次看图时由模型显式调用 view_image。
                content += (
                    "\n\n[Rendered image artifacts: "
                    + json.dumps(rendered_images, ensure_ascii=False)
                    + "]"
                )
            agent.messages.append(_agent_message(role, content))
    return agent


def _assert_session_owner(session: dict, user: CurrentUser) -> None:
    owner = session.get("user_id")
    if owner and owner != user.id and not user.is_admin:
        raise HTTPException(status_code=404, detail="Session not found")


def _assert_input_owner(session: dict, user: CurrentUser) -> None:
    # 输入会在用户自己的凭据/工具环境执行，管理员也不能向其他用户会话注入指令。
    if session.get("user_id") != user.id:
        raise HTTPException(status_code=404, detail="Session not found")


def _input_service() -> ChatInputService:
    service = ChatInputService(get_session_store(), chat_runs)
    service.recover()
    return service


def _assert_session_idle(session_id: str) -> None:
    if chat_runs.active_for_session(session_id):
        raise HTTPException(
            status_code=409, detail="Stop the active run before changing this session"
        )


def _prepare_session(request: ChatRequest, user: CurrentUser) -> tuple[str, list[dict]]:
    store = get_session_store()
    history_messages: list[dict] = []

    if request.session_id:
        try:
            session = store.get_session(request.session_id)
            _assert_input_owner(session, user)
            _assert_session_idle(request.session_id)
            if request.clear_history:
                store.clear_messages(request.session_id)
            else:
                history_messages = store.get_messages(request.session_id)
        except ChatSessionNotFound:
            raise HTTPException(status_code=404, detail="Session not found") from None
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
                history_messages.append(
                    store.append_message(session["id"], role, content, {"source": "legacy_history"})
                )
    return session["id"], history_messages


def _persist_exchange(
    session_id: str,
    user_message: str,
    assistant_response: str,
    was_empty: bool,
    *,
    sources: list[dict] | None = None,
    rendered_images: list[dict] | None = None,
    applied_inputs: list[dict] | None = None,
) -> tuple[str, str]:
    store = get_session_store()
    user_msg = store.append_message(session_id, "user", user_message)
    for item in applied_inputs or []:
        store.append_message(
            session_id,
            "user",
            item["message"],
            {
                "input_id": item["id"],
                "input_mode": "steer",
                "run_id": item.get("run_id"),
            },
        )
    assistant_msg = store.append_message(
        session_id,
        "assistant",
        assistant_response,
        {"sources": sources or [], "rendered_images": rendered_images or []},
    )
    if was_empty:
        store.update_title(session_id, _title_from_text(user_message))
    return user_msg["id"], assistant_msg["id"]


def _session_or_404(session_id: str) -> dict:
    try:
        return get_session_store().get_detail(session_id)
    except ChatSessionNotFound:
        raise HTTPException(status_code=404, detail="Session not found") from None


def _start_trace(session_id: str, user_message: str, user_id: str | None = None):
    from app.config import get_effective_settings

    if not get_effective_settings(user_id).tracing_enabled:
        return None
    try:
        from app.core.tracing import TraceRecorder
        from app.deps import get_trace_store

        return TraceRecorder.start(
            get_trace_store(), session_id=session_id, user_message=user_message
        )
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
    user_message_id: str | None = None,
    assistant_message_id: str | None = None,
    final_response: str = "",
    error: str | None = None,
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


def _complete_exchange(
    request: ChatRequest,
    session_id: str,
    response: str,
    sources: list[dict],
    history_messages: list[dict],
    recorder,
    rendered_images: list[dict] | None = None,
    applied_inputs: list[dict] | None = None,
    on_persisted: Callable[[], None] | None = None,
) -> str:
    """落库成功后完成追踪和记忆整理，终止事件由传输层随后发送。"""
    user_message_id, message_id = _persist_exchange(
        session_id,
        request.message,
        response,
        was_empty=not history_messages,
        sources=sources,
        rendered_images=rendered_images,
        **({"applied_inputs": applied_inputs} if applied_inputs else {}),
    )
    if on_persisted:
        on_persisted()
    _finish_trace(
        recorder,
        status="done",
        user_message_id=user_message_id,
        assistant_message_id=message_id,
        final_response=response,
    )
    _schedule_memory_curate(
        session_id=session_id,
        user_message="\n\n".join(
            [request.message, *[item["message"] for item in applied_inputs or []]]
        ),
        assistant_response=response,
        user_message_id=user_message_id,
        assistant_message_id=message_id,
        user_id=request.user_id,
    )
    return message_id


@router.post("/chat", response_model=ChatResponse)
def chat(
    request: ChatRequest, current_user: CurrentUser = Depends(require_permissions("chat:write"))
):
    # 同步与 SSE 共用运行槽位；请求线程等待结果，其他请求仍可排队、补充或停止。
    run = _start_chat_run(request, current_user)
    result = run.wait_result()
    if run.status != "done":
        raise HTTPException(status_code=500, detail=result.get("error", "Agent run cancelled"))
    return ChatResponse(
        response=result.get("final_response", ""),
        session_id=run.session_id,
        message_id=result.get("message_id"),
        sources=result.get("sources", []),
        rendered_images=result.get("rendered_images", []),
    )


def _run_stream_chat(request: ChatRequest, run: ChatRun, history_messages: list[dict]) -> None:
    recorder = None
    reasoning_notice_sent = False
    service = run.input_channel.service if run.input_channel else _input_service()

    def on_event(event: dict):
        nonlocal reasoning_notice_sent
        _record_trace_event(recorder, event)
        event_type = event.get("type")
        # 私有推理和原始模型调用只进入追踪，重放日志与实时流共用同一过滤边界。
        if event_type == "reasoning_update":
            if not reasoning_notice_sent:
                reasoning_notice_sent = True
                run.publish(
                    {
                        "type": "status_update",
                        "timestamp": time.time(),
                        "data": {"message": "Model is analyzing the request."},
                    }
                )
            return
        private_events = {"reasoning_update", "llm_call_start", "llm_call_end", "llm_call_error"}
        if event_type == "subagent_event" and (
            (event.get("data") or {}).get("child_event_type") in private_events
        ):
            return
        # 终止事件必须在落库之后发送；断线后的重放不能重复触发持久化或记忆整理。
        if event_type in {"agent_end", "error"} or event_type in private_events:
            return
        run.publish(event)

    try:
        recorder = _start_trace(run.session_id, request.message, request.user_id)
        with chat_runs.lock:
            if run.input_channel:
                run.input_channel.on_event = on_event
                for item in service.repository.unfinished_run_inputs(run.session_id, run.id):
                    run.input_channel.emit(item)
        agent = _init_agent(request, history_messages)
        agent.input_channel = run.input_channel
        if run.cancel_event.is_set():
            raise AgentCancelledError("Agent run cancelled")
        response = agent.run_stream(
            user_message=request.message,
            on_event=on_event,
            clear_history=False,
            skill_filter=request.skill_filter,
            cancel_event=run.cancel_event,
            thinking_enabled=request.thinking_enabled,
        )
        # 会话快照与完成状态原子切换，刷新不会漏掉刚落库的最终回复。
        with chat_runs.lock:
            if run.cancel_event.is_set():
                raise AgentCancelledError("Agent run cancelled")
            message_id = _complete_exchange(
                request,
                run.session_id,
                response,
                agent.last_sources,
                history_messages,
                recorder,
                getattr(agent, "last_rendered_images", []),
                run.input_channel.applied if run.input_channel else [],
                lambda: service.finish_run(run, success=True),
            )
            run.publish(
                {
                    "type": "agent_end",
                    "timestamp": time.time(),
                    "data": {
                        "final_response": response,
                        "session_id": run.session_id,
                        "message_id": message_id,
                        "sources": agent.last_sources,
                        "rendered_images": getattr(agent, "last_rendered_images", []),
                    },
                }
            )
            try:
                service.start_next(
                    run.session_id, lambda item: _start_queued_input(item, run.user_id, service)
                )
            except Exception:
                logger.exception("Failed to start queued input for session %s", run.session_id)
    except Exception as exc:
        cancelled = _is_agent_cancelled(exc)
        with chat_runs.lock:
            service.finish_run(run, success=False, error=str(exc))
            _finish_trace(recorder, status="cancelled" if cancelled else "error", error=str(exc))
            run.publish(
                {
                    "type": "agent_stopped" if cancelled else "error",
                    "timestamp": time.time(),
                    "data": {
                        "session_id": run.session_id,
                        **({} if cancelled else {"error": str(exc)}),
                    },
                }
            )


def _start_queued_input(item: dict, user_id: str, service: ChatInputService) -> ChatRun:
    request = ChatRequest(
        message=item["message"],
        session_id=item["session_id"],
        user_id=user_id,
        thinking_enabled=bool(item["thinking_enabled"]),
        request_id=f"input:{item['id']}",
    )

    def prepare():
        # 队列直到轮到自己才读取历史，因此下一轮一定包含上一轮最终回复和补充输入。
        session = service.store.get_session(item["session_id"])
        if session["user_id"] != user_id:
            raise ChatRunConflict("Session ownership changed")
        history = service.store.get_messages(item["session_id"])
        return item["session_id"], lambda run: _run_stream_chat(request, run, history)

    return chat_runs.start(
        user_id=user_id,
        request_id=request.request_id,
        fingerprint=request.model_dump_json(),
        session_id=item["session_id"],
        user_message=request.message,
        prepare=prepare,
        initialize=lambda run: service.install(run, item["id"]),
    )


def _stream_response(run: ChatRun, after_event_id: int) -> StreamingResponse:
    try:
        run.validate_cursor(after_event_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return StreamingResponse(
        run.events(after_event_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def _start_chat_run(request: ChatRequest, current_user: CurrentUser) -> ChatRun:
    request.user_id = current_user.id
    service = _input_service()
    if request.session_id:
        # 在运行冲突检查前校验归属，不能通过 409 响应探测其他用户的会话状态。
        try:
            _assert_input_owner(get_session_store().get_session(request.session_id), current_user)
        except ChatSessionNotFound:
            raise HTTPException(status_code=404, detail="Session not found") from None
    # 首包丢失也按请求 ID 接回原任务，不能因重连再次运行有副作用的工具。
    fingerprint = request.model_dump_json(exclude={"request_id", "after_event_id", "user_id"})

    def prepare():
        session_id, history_messages = _prepare_session(request, current_user)
        return session_id, lambda run: _run_stream_chat(request, run, history_messages)

    try:
        run = chat_runs.start(
            user_id=current_user.id,
            request_id=request.request_id or str(uuid.uuid4()),
            fingerprint=fingerprint,
            session_id=request.session_id,
            user_message=request.message,
            prepare=prepare,
            after_event_id=request.after_event_id,
            initialize=service.install,
        )
    except ChatRunConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ChatRunCapacityError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Run no longer available") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return run


@router.post("/stream")
def stream_chat(
    request: ChatRequest, current_user: CurrentUser = Depends(require_permissions("chat:write"))
):
    return _stream_response(_start_chat_run(request, current_user), request.after_event_id)


def _run_or_404(run_id: str, user: CurrentUser) -> ChatRun:
    try:
        return chat_runs.get(run_id, user.id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Run not found") from None


@router.get("/runs/{run_id}/stream")
def resume_stream(
    run_id: str,
    after_event_id: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(require_permissions("chat:read")),
):
    return _stream_response(_run_or_404(run_id, current_user), after_event_id)


@router.post("/runs/{run_id}/cancel")
def cancel_run(
    run_id: str,
    current_user: CurrentUser = Depends(require_permissions("chat:write")),
):
    with chat_runs.lock:
        run = _run_or_404(run_id, current_user)
        if run.completed_at is None:
            if run.input_channel:
                run.input_channel.accepting = False
            _input_service().repository.pause_inputs(run.session_id, True)
        return run.cancel()


@router.get("/sessions", response_model=ChatSessionListResponse)
def list_sessions(
    user_id: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(require_permissions("chat:read")),
):
    store = get_session_store()
    effective_user_id = user_id if (user_id and current_user.is_admin) else current_user.id
    sessions = store.list_sessions(user_id=effective_user_id, limit=limit, offset=offset)
    return ChatSessionListResponse(
        sessions=sessions, total=store.count_sessions(user_id=effective_user_id)
    )


@router.post("/sessions", response_model=ChatSessionDetail)
def create_session(
    request: ChatSessionCreateRequest,
    current_user: CurrentUser = Depends(require_permissions("chat:write")),
):
    session = get_session_store().create_session(
        user_id=current_user.id,
        title=request.title or "新对话",
    )
    return get_session_store().get_detail(session["id"])


@router.delete("/sessions")
def delete_sessions(current_user: CurrentUser = Depends(require_permissions("chat:write"))):
    with chat_runs.lock:
        if chat_runs.has_active(current_user.id):
            raise HTTPException(status_code=409, detail="Stop active runs before deleting sessions")
        deleted = get_session_store().delete_sessions(user_id=current_user.id)
    return {"status": "ok", "deleted": deleted, "tracing": "cleared_by_session_cascade"}


@router.get("/sessions/{session_id}", response_model=ChatSessionDetail)
def get_session(
    session_id: str, current_user: CurrentUser = Depends(require_permissions("chat:read"))
):
    with chat_runs.lock:
        _input_service()
        session = _session_or_404(session_id)
        _assert_session_owner(session, current_user)
        run = chat_runs.active_for_session(session_id)
        session["active_run"] = run.summary() if run and run.user_id == current_user.id else None
        return session


def _owned_input_service(session_id: str, user: CurrentUser) -> ChatInputService:
    service = _input_service()
    try:
        _assert_input_owner(service.store.get_session(session_id), user)
    except ChatSessionNotFound:
        raise HTTPException(status_code=404, detail="Session not found") from None
    return service


@router.post("/sessions/{session_id}/inputs", response_model=ChatInput)
def submit_input(
    session_id: str,
    request: ChatInputRequest,
    current_user: CurrentUser = Depends(require_permissions("chat:write")),
):
    with chat_runs.lock:
        service = _owned_input_service(session_id, current_user)
        try:
            return service.submit(
                session_id,
                request,
                lambda item: _start_queued_input(item, current_user.id, service),
            )
        except ChatRunConflict as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except ChatRunCapacityError as exc:
            raise HTTPException(status_code=429, detail=str(exc)) from exc


@router.get("/sessions/{session_id}/inputs", response_model=ChatInputList)
def list_inputs(
    session_id: str,
    current_user: CurrentUser = Depends(require_permissions("chat:read")),
):
    with chat_runs.lock:
        service = _owned_input_service(session_id, current_user)
        return {
            "inputs": service.repository.list_inputs(session_id),
            "input_queue_paused": service.store.get_session(session_id)["input_queue_paused"],
        }


@router.delete("/sessions/{session_id}/inputs/{input_id}", response_model=ChatInput)
def cancel_input(
    session_id: str,
    input_id: str,
    current_user: CurrentUser = Depends(require_permissions("chat:write")),
):
    with chat_runs.lock:
        service = _owned_input_service(session_id, current_user)
        try:
            return service.cancel(session_id, input_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="Input not found") from None
        except ChatRunConflict as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/sessions/{session_id}/inputs/resume")
def resume_inputs(
    session_id: str,
    current_user: CurrentUser = Depends(require_permissions("chat:write")),
):
    with chat_runs.lock:
        service = _owned_input_service(session_id, current_user)
        try:
            run = service.start_next(
                session_id,
                lambda item: _start_queued_input(item, current_user.id, service),
                resume=True,
            )
        except ChatRunCapacityError as exc:
            raise HTTPException(status_code=429, detail=str(exc)) from exc
        return {"active_run": run.summary() if run else None}


@router.patch("/sessions/{session_id}", response_model=ChatSessionSummary)
def update_session(
    session_id: str,
    request: ChatSessionUpdateRequest,
    current_user: CurrentUser = Depends(require_permissions("chat:write")),
):
    try:
        _assert_session_owner(get_session_store().get_session(session_id), current_user)
        return get_session_store().update_title(session_id, request.title)
    except ChatSessionNotFound:
        raise HTTPException(status_code=404, detail="Session not found") from None


@router.delete("/sessions/{session_id}")
def delete_session(
    session_id: str, current_user: CurrentUser = Depends(require_permissions("chat:write"))
):
    try:
        with chat_runs.lock:
            _assert_session_owner(get_session_store().get_session(session_id), current_user)
            _assert_session_idle(session_id)
            get_session_store().delete_session(session_id)
    except ChatSessionNotFound:
        raise HTTPException(status_code=404, detail="Session not found") from None
    return {"status": "ok"}


@router.delete("/sessions/{session_id}/messages")
def clear_session_messages(
    session_id: str, current_user: CurrentUser = Depends(require_permissions("chat:write"))
):
    try:
        with chat_runs.lock:
            _assert_session_owner(get_session_store().get_session(session_id), current_user)
            _assert_session_idle(session_id)
            deleted = get_session_store().clear_messages(session_id)
    except ChatSessionNotFound:
        raise HTTPException(status_code=404, detail="Session not found") from None
    return {"status": "ok", "deleted": deleted}


@router.delete("/history")
def clear_history(
    session_id: str | None = None,
    current_user: CurrentUser = Depends(require_permissions("chat:write")),
):
    if not session_id:
        return {
            "status": "ok",
            "message": "No session_id supplied; stateless requests have no server history to clear",
        }
    try:
        with chat_runs.lock:
            _assert_session_owner(get_session_store().get_session(session_id), current_user)
            _assert_session_idle(session_id)
            deleted = get_session_store().clear_messages(session_id)
    except ChatSessionNotFound:
        raise HTTPException(status_code=404, detail="Session not found") from None
    return {"status": "ok", "deleted": deleted}
