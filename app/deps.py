"""FastAPI 依赖注入模块

使用 lru_cache 实现各核心组件的单例管理，
避免重复初始化并统一组件间依赖关系。
"""

from functools import lru_cache
from pathlib import Path

from app.config import get_settings


@lru_cache
def get_memory_manager():
    """获取记忆管理器单例

    初始化流程：
    1. 从全局配置创建 MemoryConfig
    2. 获取 LLM Provider（用于摘要生成和 Deep Dream）
    3. 创建 MemoryManager（含 SQLite 存储、向量搜索、分块器）
    """
    from app.core.memory.config import MemoryConfig
    from app.core.memory.manager import MemoryManager

    settings = get_settings()
    config = MemoryConfig(
        workspace_root=settings.workspace_dir,
        embedding_provider=settings.embedding_provider,
        embedding_model=settings.embedding_model,
    )
    llm_provider = get_llm_provider()
    return MemoryManager(config=config, llm_provider=llm_provider)


@lru_cache
def get_llm_provider():
    """获取 LLM 提供商单例

    基于 OpenAI 兼容 API 实现，支持 OpenAI/DeepSeek/Qwen 等。
    """
    from app.core.llm.provider import OpenAICompatibleProvider

    settings = get_settings()
    return OpenAICompatibleProvider(
        api_key=settings.llm_api_key,
        api_base=settings.llm_api_base,
        model=settings.llm_model,
    )


@lru_cache
def get_skill_manager():
    """获取技能管理器单例

    从工作空间 skills/ 目录加载 Markdown 格式的技能定义。
    """
    from app.core.skills.manager import SkillManager

    settings = get_settings()
    custom_dir = str(Path(settings.workspace_dir).expanduser() / "skills")
    return SkillManager(custom_dir=custom_dir)


@lru_cache
def get_knowledge_service():
    """获取知识库服务单例

    提供知识文件的目录树、内容读取和知识图谱功能。
    """
    from app.core.knowledge.service import KnowledgeService

    settings = get_settings()
    return KnowledgeService(workspace_root=settings.workspace_dir)


@lru_cache
def get_tool_manager():
    """获取工具管理器单例

    加载所有内置工具（bash、搜索、文件操作、记忆、调度等），
    可选注入 MemoryManager 以支持记忆相关工具。
    """
    from app.core.tools.tool_manager import ToolManager

    settings = get_settings()
    memory_mgr = get_memory_manager() if settings.memory_enabled else None
    manager = ToolManager(workspace_dir=str(Path(settings.workspace_dir).expanduser()))
    manager.load_builtin_tools(memory_manager=memory_mgr)
    return manager


@lru_cache
def get_scheduler_service():
    """获取调度服务单例

    使用 asyncio 后台循环检查并执行定时任务，
    任务持久化到 scheduler/tasks.json。
    """
    from app.core.tools.scheduler.service import SchedulerService
    from app.core.tools.scheduler.store import RunStore, TaskStore

    settings = get_settings()
    workspace = Path(settings.workspace_dir).expanduser()
    store = TaskStore(str(workspace / "scheduler" / "tasks.json"))
    run_store = RunStore(str(workspace / "scheduler" / "runs.json"))

    def execute_callback(task: dict):
        import logging
        from app.core.notifications import TelegramSender

        logger = logging.getLogger("stocks-assistant.scheduler")
        logger.info("Executing scheduled task: %s", task.get("name", task.get("id")))

        action = task.get("action") or {}
        action_type = action.get("type")
        metadata = task.get("metadata") or {}
        prompt = task.get("prompt") or action.get("content") or ""

        if action_type == "send_message":
            result = str(action.get("content") or prompt)
        elif prompt:
            result = _run_scheduled_agent(prompt)
        else:
            result = f"Scheduled task executed: {task.get('name', task.get('id'))}"

        notify_telegram = metadata.get("notify_telegram")
        if notify_telegram is None:
            notify_telegram = action_type in {"send_message", "agent_task"}

        if notify_telegram:
            telegram = TelegramSender.from_settings(get_settings())
            message = _format_scheduled_telegram_message(task, result)
            telegram.send_message(message)

        return result

    service = SchedulerService(task_store=store, run_store=run_store, execute_callback=execute_callback)
    return service


def _run_scheduled_agent(prompt: str) -> str:
    """Run a scheduled prompt through a fresh stateless Agent."""
    from app.config import DEFAULT_SYSTEM_PROMPT
    from app.core.agent.agent import Agent
    from app.core.agent.models import LLMModel

    settings = get_settings()
    llm = get_llm_provider()
    model = LLMModel(model=settings.llm_model)
    model.call = llm.call
    model.call_stream = llm.call_stream

    agent = Agent(
        system_prompt=settings.system_prompt or DEFAULT_SYSTEM_PROMPT,
        model=model,
        tools=get_tool_manager().get_all_tools(),
        max_steps=settings.agent_max_steps,
        max_context_tokens=settings.agent_max_context_tokens,
        max_context_turns=settings.agent_max_context_turns,
        memory_manager=get_memory_manager(),
        workspace_dir=settings.workspace_dir,
        skill_manager=get_skill_manager(),
    )
    return agent.run_stream(user_message=prompt, clear_history=True)


def _format_scheduled_telegram_message(task: dict, body: str) -> str:
    name = str(task.get("name") or task.get("id") or "Scheduled task")
    return f"Scheduled task: {name}\n\n{body}".strip()


@lru_cache
def get_watchlist_service():
    """获取本地自选股服务单例。"""
    from app.core.watchlist.service import WatchlistService

    settings = get_settings()
    return WatchlistService(workspace_dir=settings.workspace_dir)


@lru_cache
def get_market_service():
    """获取行情监控服务单例。"""
    from app.core.market.service import MarketService

    settings = get_settings()
    return MarketService(workspace_dir=settings.workspace_dir)


@lru_cache
def get_fundamental_service():
    """获取长桥基本面服务单例。"""
    from app.core.fundamentals.service import FundamentalService

    return FundamentalService()


@lru_cache
def get_session_store():
    """获取聊天会话存储单例。"""
    from app.core.session import ChatSessionStore

    settings = get_settings()
    return ChatSessionStore(workspace_dir=settings.workspace_dir)


@lru_cache
def get_trace_store():
    """获取 Agent 调用追踪存储单例。"""
    from app.core.tracing import TraceStore

    settings = get_settings()
    return TraceStore(workspace_dir=settings.workspace_dir)


@lru_cache
def get_mcp_manager():
    """获取 MCP 管理器单例。

    基于 config.json 中的 mcp_servers 配置初始化 MCPManager。
    实际连接在 lifespan 中异步执行。
    """
    from app.core.tools.mcp.mcp_tool import MCPManager

    settings = get_settings()
    return MCPManager(server_configs=settings.mcp_servers, workspace_dir=settings.workspace_dir)
