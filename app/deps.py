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
    memory_mgr = get_memory_manager()
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
    from app.core.tools.scheduler.store import TaskStore

    settings = get_settings()
    workspace = Path(settings.workspace_dir).expanduser()
    store = TaskStore(str(workspace / "scheduler" / "tasks.json"))

    # 定时任务执行回调（当前仅记录日志，可扩展为调用 Agent）
    def execute_callback(task: dict):
        import logging
        logger = logging.getLogger("stocks-assistant.scheduler")
        logger.info(f"Executing scheduled task: {task.get('name', task.get('id'))}")

    service = SchedulerService(task_store=store, execute_callback=execute_callback)
    return service


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
