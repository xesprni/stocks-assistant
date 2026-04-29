"""Agent 对话 API

提供同步聊天和 SSE 流式聊天两种接口。
每次请求创建新的 Agent 实例（无状态 API）。
"""

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.schemas import ChatRequest, ChatResponse
from app.deps import get_llm_provider, get_skill_manager, get_memory_manager

router = APIRouter()


def _build_agent(user_id: Optional[str] = None):
    from app.core.agent.agent import Agent
    from app.core.agent.models import LLMModel
    from app.config import get_settings

    settings = get_settings()
    llm = get_llm_provider()
    skill_mgr = get_skill_manager()
    memory_mgr = get_memory_manager()

    from app.core.tools.tool_manager import ToolManager
    from pathlib import Path

    tool_manager = ToolManager(workspace_dir=str(Path(settings.workspace_dir).expanduser()))
    tool_manager.load_builtin_tools(memory_manager=memory_mgr)

    model = LLMModel(model=settings.llm_model)
    model.call = llm.call
    model.call_stream = llm.call_stream

    system_prompt = settings.system_prompt or "You are a helpful AI assistant."

    return Agent(
        system_prompt=system_prompt,
        model=model,
        tools=tool_manager.get_all_tools(),
        max_steps=settings.agent_max_steps,
        max_context_tokens=settings.agent_max_context_tokens,
        max_context_turns=settings.agent_max_context_turns,
        memory_manager=memory_mgr,
        workspace_dir=settings.workspace_dir,
        skill_manager=skill_mgr,
    )


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    agent = _build_agent(request.user_id)
    try:
        response = agent.run_stream(
            user_message=request.message,
            clear_history=request.clear_history,
            skill_filter=request.skill_filter,
        )
        return ChatResponse(response=response)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/stream")
async def stream_chat(request: ChatRequest):
    agent = _build_agent(request.user_id)

    def event_generator():
        events = []

        def on_event(event: dict):
            events.append(event)

        try:
            response = agent.run_stream(
                user_message=request.message,
                on_event=on_event,
                clear_history=request.clear_history,
                skill_filter=request.skill_filter,
            )
            yield f"data: {json.dumps({'type': 'agent_end', 'data': {'final_response': response}})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'data': {'error': str(e)}})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.delete("/history")
async def clear_history():
    return {"status": "ok", "message": "History cleared (stateless API - each request starts fresh)"}
