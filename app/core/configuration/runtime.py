"""配置变更后的依赖失效规则，供 API 和 OAuth 服务共同使用。"""

import logging
from collections.abc import Mapping
from typing import Any

from app.config import clear_effective_settings_cache

logger = logging.getLogger("stocks-assistant.configuration")

LLM_KEYS = frozenset(
    {
        "llm_provider",
        "llm_auth_mode",
        "llm_api_key",
        "llm_api_base",
        "llm_model",
        "llm_codex_auth_file",
        "llm_codex_api_base",
        "llm_codex_model",
        "llm_temperature",
        "llm_max_output_tokens",
        "llm_reasoning_effort",
        "llm_tool_choice",
    }
)
MEMORY_KEYS = LLM_KEYS | {
    "embedding_auth_mode",
    "embedding_api_key",
    "embedding_api_base",
    "embedding_model",
    "embedding_provider",
    "embedding_codex_auth_file",
    "embedding_codex_api_base",
    "embedding_codex_model",
    "memory_enabled",
    "workspace_dir",
}
LONGBRIDGE_KEYS = frozenset(
    {
        "longbridge_auth_mode",
        "longbridge_oauth_client_id",
        "longbridge_app_key",
        "longbridge_app_secret",
        "longbridge_access_token",
        "longbridge_http_url",
        "longbridge_quote_ws_url",
    }
)
MCP_KEYS = frozenset({"mcp_servers", "mcp_tool_timeout_seconds", "workspace_dir"})
WORKSPACE_DEPENDENCIES = (
    "get_tool_manager",
    "get_skill_manager",
    "get_knowledge_service",
    "get_watchlist_service",
    "get_market_service",
    "get_portfolio_service",
    "get_research_service",
    "get_research_quick_prompts_service",
    "get_investment_lab_service",
    "get_session_store",
    "get_trace_store",
)


def invalidate_runtime(patch: Mapping[str, Any], *, user_id: str | None = None) -> None:
    """只刷新受变更影响的依赖；个人 MCP 更新保持其他用户连接。"""
    from app import deps

    changed = patch.keys()
    clear_effective_settings_cache()
    dependencies: set[str] = set()
    if changed & LLM_KEYS:
        dependencies.update({"get_llm_provider", "get_memory_llm_provider"})
        deps.clear_llm_provider_cache()
    if changed & MEMORY_KEYS:
        dependencies.add("get_memory_manager_for_user")
        if user_id is None:
            dependencies.update(
                {"get_memory_manager", "get_embedding_provider", "get_tool_manager"}
            )
    if "workspace_dir" in changed:
        dependencies.update(WORKSPACE_DEPENDENCIES)
    if changed & LONGBRIDGE_KEYS:
        from app.core.dashboard.service import clear_dashboard_cache
        from app.core.market.longbridge_context import clear_context_cache

        # 已创建的服务可能仍由一次在途请求引用，清数据缓存但不创建新服务。
        if deps.get_fundamental_service.cache_info().currsize:
            deps.get_fundamental_service().clear_cache()
        dependencies.update({"get_fundamental_service", "get_investment_lab_service"})
        for clear in (clear_context_cache, clear_dashboard_cache):
            try:
                clear()
            except Exception:
                logger.warning("External service cache cleanup failed", exc_info=True)
    for name in sorted(dependencies):
        getattr(deps, name).cache_clear()
    if changed & MCP_KEYS:
        deps.close_mcp_managers(user_id, all_users=user_id is None)
