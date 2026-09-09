"""配置变更后的依赖失效规则，供 API 和 OAuth 服务共同使用。"""

import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass
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


@dataclass(frozen=True)
class RuntimeBinding:
    name: str
    keys: frozenset[str]
    invalidate: Callable[[str | None], None]


def runtime_bindings() -> tuple[RuntimeBinding, ...]:
    """显式组合根：扩展依赖时注册受影响配置及失效动作。"""
    from app import deps

    def system_only(factory: Any) -> Callable[[str | None], None]:
        return lambda user_id: factory.cache_clear() if user_id is None else None

    workspace_factories = (
        deps.get_tool_manager,
        deps.get_skill_manager,
        deps.get_knowledge_service,
        deps.get_watchlist_service,
        deps.get_market_service,
        deps.get_portfolio_service,
        deps.get_research_service,
        deps.get_research_quick_prompts_service,
        deps.get_investment_lab_service,
        deps.get_session_store,
        deps.get_trace_store,
    )
    bindings = [
        RuntimeBinding("llm", LLM_KEYS, system_only(deps.get_llm_provider)),
        RuntimeBinding("memory_llm", LLM_KEYS, system_only(deps.get_memory_llm_provider)),
        RuntimeBinding("provider_cache", LLM_KEYS, deps.invalidate_llm_providers),
        RuntimeBinding("memory", frozenset(MEMORY_KEYS), system_only(deps.get_memory_manager)),
        RuntimeBinding(
            "embedding", frozenset(MEMORY_KEYS), system_only(deps.get_embedding_provider)
        ),
        RuntimeBinding("memory_tools", frozenset(MEMORY_KEYS), system_only(deps.get_tool_manager)),
        RuntimeBinding(
            "user_memory",
            frozenset(MEMORY_KEYS),
            lambda user_id: (
                deps.get_memory_manager_for_user.cache_clear(user_id)
                if user_id is not None
                else deps.get_memory_manager_for_user.cache_clear()
            ),
        ),
        RuntimeBinding(
            "mcp",
            MCP_KEYS,
            lambda user_id: deps.close_mcp_managers(user_id, all_users=user_id is None),
        ),
        RuntimeBinding("longbridge", LONGBRIDGE_KEYS, _invalidate_longbridge),
    ]
    # 已由 MEMORY_KEYS 覆盖的 tool_manager 只失效一次。
    bindings.extend(
        RuntimeBinding(name, frozenset({"workspace_dir"}), system_only(factory))
        for name, factory in zip(WORKSPACE_DEPENDENCIES[1:], workspace_factories[1:], strict=True)
    )
    return tuple(bindings)


def _invalidate_longbridge(user_id: str | None) -> None:
    from app import deps
    from app.core.dashboard.service import clear_dashboard_cache
    from app.core.market.longbridge_context import clear_context_cache

    # 用户凭据已经参与数据源签名，个人更新不关闭其他用户的连接。
    if user_id is not None:
        clear_dashboard_cache()
        return
    if deps.get_fundamental_service.cache_info().currsize:
        deps.get_fundamental_service().clear_cache()
    deps.get_fundamental_service.cache_clear()
    deps.get_investment_lab_service.cache_clear()
    for clear in (clear_context_cache, clear_dashboard_cache):
        try:
            clear()
        except Exception:
            logger.warning("External service cache cleanup failed", exc_info=True)


def invalidate_runtime(patch: Mapping[str, Any], *, user_id: str | None = None) -> None:
    """退休受影响实例；持有租约的旧资源在最后一次使用后释放。"""
    clear_effective_settings_cache(user_id)
    for binding in runtime_bindings():
        if patch.keys() & binding.keys:
            binding.invalidate(user_id)
