"""FastAPI 依赖注入模块

使用 lru_cache 实现各核心组件的单例管理，
避免重复初始化并统一组件间依赖关系。
"""

import hashlib
import json
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from threading import Lock, RLock
from typing import Any
from weakref import finalize

from app.config import Settings, get_effective_settings, get_settings
from app.core.configuration.resources import ManagedResource


def _resource_signature(settings: Settings, fields: tuple[str, ...]) -> str:
    # 签名只留摘要，不把凭据或 MCP headers 作为可观察的缓存键。
    payload = {field: getattr(settings, field, None) for field in fields}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()


def _memory_resource_signature(settings: Settings) -> str:
    return _resource_signature(
        settings,
        (
            "workspace_dir",
            "embedding_auth_mode",
            "embedding_provider",
            "embedding_model",
            "embedding_api_key",
            "embedding_api_base",
            "embedding_codex_auth_file",
            "embedding_codex_api_base",
            "embedding_codex_model",
            "llm_api_key",
            "llm_api_base",
            "llm_model",
            "llm_codex_auth_file",
        ),
    )


def _mcp_resource_signature(settings: Settings) -> str:
    return _resource_signature(
        settings, ("workspace_dir", "mcp_servers", "mcp_tool_timeout_seconds")
    )


def _settings_for_resource(user_id: str | None) -> Settings:
    return get_effective_settings(user_id) if user_id else get_settings()


def _active_embedding_model(settings: Settings) -> str:
    return (
        settings.embedding_codex_model
        if settings.embedding_auth_mode == "codex"
        else settings.embedding_model
    )


def _embedding_signature(settings: Settings) -> str:
    api_base = (
        settings.embedding_codex_api_base
        if settings.embedding_auth_mode == "codex"
        else (settings.embedding_api_base or settings.llm_api_base)
    )
    if settings.embedding_auth_mode == "codex":
        credential_state = (
            settings.embedding_codex_auth_file or settings.llm_codex_auth_file or "codex-default"
        )
    else:
        credential_state = (
            "configured" if (settings.embedding_api_key or settings.llm_api_key) else "missing"
        )
    return ":".join(
        [
            settings.embedding_auth_mode or "api_key",
            settings.embedding_provider or "openai",
            _active_embedding_model(settings) or "",
            (api_base or "").rstrip("/"),
            credential_state,
        ]
    )


@lru_cache
def get_memory_manager():
    """获取记忆管理器单例

    初始化流程：
    1. 从全局配置创建 MemoryConfig
    2. 获取 LLM Provider（用于摘要生成和 Deep Dream）
    3. 创建 MemoryManager（含 SQLite 存储、向量搜索、分块器）
    """
    return _create_user_memory_manager(None, settings=get_settings())


_user_memory_managers: dict[str, Any] = {}
_user_memory_lock = RLock()
_memory_manager_signatures: dict[int, str] = {}


def _own_memory_manager(manager, settings: Settings):
    # 最后一个请求引用消失时再关闭 SQLite，缓存失效不打断正在进行的索引。
    key, storage = id(manager), manager.storage
    with _user_memory_lock:
        _memory_manager_signatures[key] = _memory_resource_signature(settings)

    def close() -> None:
        try:
            storage.close()
        finally:
            with _user_memory_lock:
                _memory_manager_signatures.pop(key, None)

    finalize(manager, close)
    return manager


def get_memory_manager_for_user(user_id: str | None):
    if not user_id:
        return get_memory_manager()
    with _user_memory_lock:
        if user_id not in _user_memory_managers:
            _user_memory_managers[user_id] = _create_user_memory_manager(user_id)
        return _user_memory_managers[user_id]


def clear_user_memory_managers(user_id: str | None = None) -> None:
    with _user_memory_lock:
        if user_id is None:
            _user_memory_managers.clear()
        else:
            _user_memory_managers.pop(user_id, None)


get_memory_manager_for_user.cache_clear = clear_user_memory_managers


@contextmanager
def lease_memory_manager_for_user(
    user_id: str | None, settings: Settings | None = None
) -> Iterator[Any]:
    # 持有强引用跨越异步等待；退休实例由 finalizer 在最后一次使用后关闭。
    if settings is None:
        manager = get_memory_manager_for_user(user_id)
    else:
        requested = _memory_resource_signature(settings)
        with _user_memory_lock:
            current = _memory_resource_signature(_settings_for_resource(user_id))
            cached = (
                _user_memory_managers.get(user_id)
                if user_id
                else get_memory_manager()
                if requested == current
                else None
            )
            if cached is not None and _memory_manager_signatures.get(id(cached)) == requested:
                manager = cached
            else:
                manager = _create_user_memory_manager(user_id, settings=settings)
                # 旧快照仍可完成当前请求，但不能覆盖新配置的共享实例。
                if user_id and requested == current:
                    _user_memory_managers[user_id] = manager
    yield manager


def _create_user_memory_manager(user_id: str | None, settings: Settings | None = None):
    """Get a MemoryManager using a user's effective embedding config."""
    from app.core.memory.config import MemoryConfig
    from app.core.memory.manager import MemoryManager

    settings = settings if settings is not None else _settings_for_resource(user_id)
    user_index = (
        Path(settings.workspace_dir).expanduser()
        / "memory"
        / "users"
        / (user_id or "")
        / "long-term"
        / "index.db"
    )
    config = MemoryConfig(
        workspace_root=settings.workspace_dir,
        index_db_path=str(user_index) if user_id else None,
        owner_user_id=user_id,
        embedding_provider=settings.embedding_provider,
        embedding_model=_active_embedding_model(settings),
        embedding_signature=_embedding_signature(settings),
    )
    return _own_memory_manager(
        MemoryManager(
            config=config,
            embedding_provider=create_embedding_provider_from_settings(settings),
            llm_provider=create_memory_llm_provider(settings),
        ),
        settings,
    )


def create_embedding_provider_from_settings(settings: Settings):
    """Create an embedding provider from a concrete Settings object.

    Embedding 使用自己的 invocation mode，不跟随主对话模型。
    """
    from app.core.memory.embedding import create_embedding_provider

    if settings.embedding_auth_mode == "codex":
        try:
            from app.config import CODEX_OAUTH_API_BASE, EMBEDDING_DEFAULT_MODEL
            from app.core.llm.codex_auth import resolve_codex_oauth

            credentials = resolve_codex_oauth(
                settings.embedding_codex_auth_file or settings.llm_codex_auth_file or None
            )
            api_base = settings.embedding_codex_api_base.rstrip("/") or CODEX_OAUTH_API_BASE
            model = settings.embedding_codex_model or EMBEDDING_DEFAULT_MODEL
            return create_embedding_provider(
                provider=settings.embedding_provider,
                model=model,
                api_key=credentials.access_token,
                api_base=api_base,
                extra_headers={
                    "ChatGPT-Account-Id": credentials.account_id,
                    "OpenAI-Beta": "responses=experimental",
                    "Origin": "https://chatgpt.com",
                    "Referer": "https://chatgpt.com/",
                },
            )
        except Exception:
            return None

    api_key = settings.embedding_api_key or settings.llm_api_key
    if not api_key:
        return None
    api_base = settings.embedding_api_base or settings.llm_api_base
    try:
        return create_embedding_provider(
            provider=settings.embedding_provider,
            model=settings.embedding_model,
            api_key=api_key,
            api_base=api_base,
        )
    except Exception:
        return None


@lru_cache
def get_embedding_provider():
    """获取全局向量化 provider。"""
    return create_embedding_provider_from_settings(get_settings())


@lru_cache
def get_memory_llm_provider():
    """获取记忆整理用的兼容 LLM provider。

    Memory curator / flush 不使用主对话 Codex OAuth，避免后台任务打到 Codex
    ChatGPT backend。为空时记忆摘要会降级或跳过。
    """
    settings = get_settings()
    return create_memory_llm_provider(settings)


def create_memory_llm_provider(settings: Settings):
    """Create the LLM provider used for memory curation."""
    from app.core.llm.provider import OpenAICompatibleProvider

    if not settings.llm_api_key:
        return None
    return OpenAICompatibleProvider(
        api_key=settings.llm_api_key,
        api_base=settings.llm_api_base,
        model=settings.llm_model,
    )


@lru_cache
def get_llm_provider():
    """获取 LLM 提供商单例

    支持 OpenAI 兼容 Chat Completions、Responses API，以及 Codex ChatGPT OAuth 登录态。
    """
    return create_llm_provider(get_settings())


def create_llm_provider(settings: Settings):
    """Create an LLM provider from a concrete Settings object.

    带签名 + TTL 缓存。每次 chat 请求都会调用此函数，缓存可避免重复创建
    Provider 实例。Codex OAuth token 会定期刷新，TTL 300s 确保过期后重建。
    """
    sig = _llm_provider_signature(settings)
    now = datetime.now(UTC).timestamp()
    with _llm_provider_cache_lock:
        entry = _llm_provider_cache.get(sig)
        if entry is not None and entry[0] > now:
            return entry[1]
        generation = _llm_provider_cache_generation

    provider = _create_llm_provider_impl(settings)
    with _llm_provider_cache_lock:
        # 构造可能跨越配置更新；旧请求可使用其快照，但不能回填已失效的缓存。
        if generation != _llm_provider_cache_generation:
            return provider
        completed_at = datetime.now(UTC).timestamp()
        entry = _llm_provider_cache.get(sig)
        if entry is not None and entry[0] > completed_at:
            return entry[1]
        _llm_provider_cache[sig] = (completed_at + _LLM_PROVIDER_CACHE_TTL, provider)
    return provider


# --- LLM Provider 签名缓存 ---
_llm_provider_cache: dict[str, tuple[float, Any]] = {}
_llm_provider_cache_lock = Lock()
_llm_provider_cache_generation = 0
_LLM_PROVIDER_CACHE_TTL = 300.0  # 5 分钟


def _llm_provider_signature(settings: Settings) -> str:
    """根据影响 Provider 的配置字段生成缓存签名。"""
    fields = (
        "llm_provider",
        "llm_auth_mode",
        "llm_api_key",
        "llm_api_base",
        "llm_model",
        "llm_codex_auth_file",
        "llm_codex_api_base",
        "llm_codex_model",
    )
    return "\0".join(str(getattr(settings, f, "") or "") for f in fields)


def clear_llm_provider_cache() -> None:
    """清除 LLM Provider 缓存。配置变更后调用。"""
    global _llm_provider_cache_generation
    with _llm_provider_cache_lock:
        _llm_provider_cache_generation += 1
        _llm_provider_cache.clear()


def invalidate_llm_providers(user_id: str | None) -> None:
    global _llm_provider_cache_generation
    if user_id is None:
        clear_llm_provider_cache()
    else:
        signature = _llm_provider_signature(get_effective_settings(user_id))
        with _llm_provider_cache_lock:
            _llm_provider_cache_generation += 1
            _llm_provider_cache.pop(signature, None)


def _create_llm_provider_impl(settings: Settings):
    """实际创建 LLM provider 的实现。"""
    from app.config import CODEX_DEFAULT_MODEL, CODEX_OAUTH_API_BASE
    from app.core.llm.provider import OpenAICompatibleProvider, OpenAIResponsesProvider

    provider_cls = (
        OpenAIResponsesProvider
        if settings.llm_provider == "openai_responses"
        else OpenAICompatibleProvider
    )
    default_model = (
        CODEX_DEFAULT_MODEL
        if settings.llm_provider == "openai_responses" and not settings.llm_codex_model
        else settings.llm_codex_model
    )
    if settings.llm_provider == "openai_responses" and settings.llm_auth_mode == "codex":
        from app.core.llm.codex_auth import resolve_codex_oauth

        credentials = resolve_codex_oauth(settings.llm_codex_auth_file or None)
        api_base = settings.llm_codex_api_base.rstrip("/") or CODEX_OAUTH_API_BASE
        if api_base == "https://api.openai.com/v1":
            api_base = CODEX_OAUTH_API_BASE
        return OpenAIResponsesProvider(
            api_key=credentials.access_token,
            api_base=api_base,
            model=default_model,
            extra_headers={
                "ChatGPT-Account-Id": credentials.account_id,
                "OpenAI-Beta": "responses=experimental",
                "Origin": "https://chatgpt.com",
                "Referer": "https://chatgpt.com/",
            },
            store_response=False,
        )
    return provider_cls(
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
    """装配 SQLite 调度服务；执行与通知编排由独立应用服务负责。"""
    from app.core.tools.scheduler.execution import ScheduledAlertEvaluator, ScheduledTaskExecutor
    from app.core.tools.scheduler.service import SchedulerService
    from app.core.tools.scheduler.store import SQLiteRunStore, SQLiteTaskStore

    return SchedulerService(
        task_store=SQLiteTaskStore(),
        run_store=SQLiteRunStore(),
        execute_callback=ScheduledTaskExecutor(
            lambda prompt, user_id=None, **options: _run_scheduled_agent(
                prompt, user_id=user_id, **options
            ),
            get_effective_settings,
        ),
        alert_callback=ScheduledAlertEvaluator(
            {
                "research": get_research_service,
                "market": get_market_service,
                "fundamentals": get_fundamental_service,
                "news": get_news_service,
            }
        ),
    )


def _build_scheduled_agent_prompt(prompt: str, task: dict | None = None) -> str:
    from app.core.tools.scheduler.execution import build_scheduled_agent_prompt

    return build_scheduled_agent_prompt(prompt, task)


def _run_scheduled_agent(prompt: str, user_id: str | None = None, cancel_event=None) -> str:
    """通过共享工厂执行一次不携带聊天历史的调度任务。"""
    from app.core.agent.factory import create_agent

    options = {"cancel_event": cancel_event} if cancel_event is not None else {}
    return create_agent(user_id).run_stream(user_message=prompt, clear_history=True, **options)


def _get_agent_tools(settings: Settings, user_id: str | None = None):
    """兼容旧调用方，工具装配集中在 Agent 工厂。"""
    from app.core.agent.factory import create_agent_tools

    return create_agent_tools(settings, user_id)


def _format_scheduled_telegram_message(task: dict, body: str) -> str:
    from app.core.tools.scheduler.execution import format_scheduled_telegram_message

    return format_scheduled_telegram_message(task, body)


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
def get_portfolio_service():
    """获取本地持仓服务单例。"""
    from app.core.portfolio.service import PortfolioService

    settings = get_settings()
    return PortfolioService(workspace_dir=settings.workspace_dir)


@lru_cache
def get_fundamental_service():
    """获取长桥基本面服务单例。"""
    from app.core.fundamentals.service import FundamentalService

    return FundamentalService()


@lru_cache
def get_news_service():
    """获取长桥内容新闻服务单例。"""
    from app.core.news import NewsService

    return NewsService()


@lru_cache
def get_research_service():
    """获取 Thesis、材料版本和提醒收件箱的本地研究域服务。"""
    from app.core.research import ResearchService

    settings = get_settings()
    return ResearchService(
        workspace_dir=settings.workspace_dir,
        portfolio_service=get_portfolio_service(),
        watchlist_service=get_watchlist_service(),
    )


@lru_cache
def get_research_quick_prompts_service():
    """获取用户隔离的 Research AI 快速提问缓存服务。"""
    from app.core.research.quick_prompts import ResearchQuickPromptsService

    return ResearchQuickPromptsService(
        workspace_dir=get_settings().workspace_dir,
        llm_provider_factory=create_llm_provider,
        portfolio_service=get_portfolio_service(),
        watchlist_service=get_watchlist_service(),
    )


@lru_cache
def get_investment_lab_service():
    """获取组合、估值/同业及大中华市场实验室服务。"""
    from app.core.labs import InvestmentLabService

    settings = get_settings()
    return InvestmentLabService(
        workspace_dir=settings.workspace_dir,
        portfolio_service=get_portfolio_service(),
        market_service=get_market_service(),
        fundamental_service=get_fundamental_service(),
        research_service=get_research_service(),
    )


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


# MCP manager 持有线程和连接，必须显式关闭，不能只丢弃 lru_cache 引用。
_mcp_managers: dict[str | None, Any] = {}
_mcp_managers_lock = RLock()
_mcp_resources: dict[int, ManagedResource[Any]] = {}
_mcp_manager_signatures: dict[int, str] = {}


def get_mcp_manager():
    """获取应用级 MCP manager。"""
    return get_mcp_manager_for_user(None)


def get_mcp_manager_for_user(user_id: str | None):
    """获取当前用户的 MCP manager，冷启动也只创建一个实例。"""
    with _mcp_managers_lock:
        if user_id not in _mcp_managers:
            settings = _settings_for_resource(user_id)
            manager = _create_mcp_manager(user_id, settings)
            _mcp_managers[user_id] = manager
            _mcp_manager_signatures[id(manager)] = _mcp_resource_signature(settings)
        return _mcp_managers[user_id]


def _create_mcp_manager(user_id: str | None, settings: Settings):
    import logging

    from app.core.security import user_workspace_dir
    from app.core.tools.mcp.mcp_tool import MCPManager

    manager = MCPManager(
        server_configs=settings.mcp_servers,
        workspace_dir=user_workspace_dir(settings.workspace_dir, user_id)
        if user_id
        else settings.workspace_dir,
        tool_timeout_seconds=settings.mcp_tool_timeout_seconds,
        user_id=user_id,
    )
    if user_id and settings.mcp_servers:
        try:
            manager.connect_all_background()
        except Exception:
            logging.getLogger("stocks-assistant.mcp").warning(
                "MCP background initialization failed", exc_info=True
            )
    return manager


def _managed_mcp(manager: Any) -> ManagedResource[Any]:
    key = id(manager)
    if key not in _mcp_resources:

        def close() -> None:
            import logging

            try:
                manager.close_sync()
            except Exception:
                logging.getLogger("stocks-assistant.mcp").warning(
                    "MCP cleanup failed", exc_info=True
                )
            finally:
                with _mcp_managers_lock:
                    _mcp_resources.pop(key, None)
                    _mcp_manager_signatures.pop(key, None)

        _mcp_resources[key] = ManagedResource(manager, close)
    return _mcp_resources[key]


@contextmanager
def lease_mcp_manager_for_user(
    user_id: str | None, settings: Settings | None = None
) -> Iterator[Any]:
    # 获取与租借共用工厂锁，避免配置更新在两步之间关闭刚获取的实例。
    with _mcp_managers_lock:
        retire = []
        if settings is None:
            manager = get_mcp_manager_for_user(user_id)
        else:
            requested = _mcp_resource_signature(settings)
            cached = _mcp_managers.get(user_id)
            if cached is not None and _mcp_manager_signatures.get(id(cached)) == requested:
                manager = cached
            else:
                publish = requested == _mcp_resource_signature(_settings_for_resource(user_id))
                manager = _create_mcp_manager(user_id, settings)
                _mcp_manager_signatures[id(manager)] = requested
                if publish:
                    _mcp_managers[user_id] = manager
                    if cached is not None:
                        retire.append(_managed_mcp(cached))
                else:
                    # 配置已经前进时，旧快照的连接只服务本次租约，不重新发布。
                    retire.append(_managed_mcp(manager))
        lease = _managed_mcp(manager).acquire()
    try:
        for resource in retire:
            resource.retire()
        yield manager
    finally:
        lease.close()


def close_mcp_managers(user_id: str | None = None, *, all_users: bool = True) -> None:
    """移除并关闭指定范围，个人配置变更不打断其他用户的连接。"""
    with _mcp_managers_lock:
        if all_users:
            managers = list(_mcp_managers.values())
            _mcp_managers.clear()
        else:
            manager = _mcp_managers.pop(user_id, None)
            managers = [manager] if manager is not None else []
        resources = [_managed_mcp(manager) for manager in managers]
    for resource in resources:
        resource.retire()


# 兼容测试和旧集成中的缓存清理入口，同时确保连接与后台线程被释放。
get_mcp_manager.cache_clear = close_mcp_managers
get_mcp_manager_for_user.cache_clear = close_mcp_managers
