"""聊天和调度共用的 Agent 装配入口。"""

import logging
from contextlib import ExitStack
from pathlib import Path

from app.config import DEFAULT_SYSTEM_PROMPT, Settings, get_effective_settings
from app.core.agent.agent import Agent
from app.core.agent.models import LLMModel
from app.core.security import user_workspace_dir
from app.core.tools.base_tool import BaseTool

logger = logging.getLogger("stocks-assistant.agent.factory")


def create_agent_tools(
    settings: Settings,
    user_id: str | None = None,
    *,
    resources: ExitStack | None = None,
    memory=None,
) -> list[BaseTool]:
    from app import deps
    from app.core.tools.permissions import filter_agent_tools
    from app.core.tools.tool_manager import ToolManager

    workspace = (
        user_workspace_dir(settings.workspace_dir, user_id) if user_id else settings.workspace_dir
    )
    if memory is None and settings.memory_enabled:
        memory = (
            resources.enter_context(deps.lease_memory_manager_for_user(user_id, settings=settings))
            if resources is not None
            else deps.get_memory_manager_for_user(user_id)
        )
    # 工具可能持有单次执行状态；每个 Agent 独立装配，用户身份仅来自调用方。
    manager = ToolManager(workspace_dir=str(Path(workspace).expanduser()), user_id=user_id)
    manager.load_builtin_tools(memory_manager=memory, user_id=user_id, settings=settings)
    tools = manager.get_all_tools()
    if settings.mcp_servers:
        try:
            mcp = (
                resources.enter_context(deps.lease_mcp_manager_for_user(user_id, settings=settings))
                if resources is not None
                else deps.get_mcp_manager_for_user(user_id)
            )
            tools.extend(mcp.get_tools())
        except Exception:
            logger.warning("MCP tools unavailable during Agent initialization", exc_info=True)
    return filter_agent_tools(tools, settings)


def create_agent(user_id: str | None = None, settings: Settings | None = None) -> Agent:
    """创建无会话历史的 Agent；调用方决定历史、执行参数和结果持久化。"""
    from app import deps

    settings = settings if settings is not None else get_effective_settings(user_id)
    workspace = (
        user_workspace_dir(settings.workspace_dir, user_id) if user_id else settings.workspace_dir
    )
    provider = deps.create_llm_provider(settings)
    model = LLMModel(model=settings.llm_model)
    model.call = provider.call
    model.call_stream = provider.call_stream
    resources = ExitStack()
    try:
        memory = (
            resources.enter_context(deps.lease_memory_manager_for_user(user_id, settings=settings))
            if settings.memory_enabled
            else None
        )
        return Agent(
            system_prompt=settings.system_prompt or DEFAULT_SYSTEM_PROMPT,
            model=model,
            tools=create_agent_tools(settings, user_id, resources=resources, memory=memory),
            max_steps=settings.agent_max_steps,
            max_context_tokens=settings.agent_max_context_tokens,
            max_context_turns=settings.agent_max_context_turns,
            memory_manager=memory,
            workspace_dir=workspace,
            skill_manager=deps.get_skill_manager(),
            settings=settings,
            user_id=user_id,
            runtime_resources=resources,
        )
    except BaseException:
        # 装配失败也归还已获取的连接，未运行的 Agent 由自身 finalizer 兜底。
        resources.close()
        raise
