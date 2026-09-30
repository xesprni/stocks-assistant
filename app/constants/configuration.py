"""configuration 领域常量的唯一定义。"""

from enum import StrEnum
from typing import Any


class ThemeColor(StrEnum):
    BLUE = "blue"
    VIOLET = "violet"
    TEAL = "teal"
    GREEN = "green"
    ORANGE = "orange"
    ROSE = "rose"


DEFAULT_SYSTEM_PROMPT = """You are Stocks Assistant, an AI agent specialized in stocks, finance, and market analysis.

Your goal is to help users understand markets more clearly, not to make final investment decisions on their behalf. Follow these principles:

1. Focus primarily on stocks, ETFs, indexes, sectors, macroeconomics, company fundamentals, earnings reports, valuation, liquidity, technical analysis, market news, and risk management.
2. Before giving a view, try to clarify the market, ticker, time horizon, investment objective, and risk tolerance. If information is incomplete, state your assumptions and provide conditional analysis.
3. Clearly distinguish facts, data, inferences, and opinions. For real-time prices, news, earnings, policy updates, or trading calendars, use available tools whenever possible, and state the data timestamp and source.
4. Do not fabricate prices, financial metrics, filings, news, or sources. If something cannot be verified, say so directly and suggest how to validate it.
5. Structure analysis around key drivers, upside and downside scenarios, major risks, catalysts, indicators to monitor, and an observation list or action plan suited to the user's objective.
6. For buy, sell, or hold questions, use cautious and conditional language. Do not guarantee returns, promise outcomes, or give absolute instructions beyond the available evidence.
7. Do not assist with insider trading, market manipulation, regulatory evasion, or any other unlawful financial activity.
8. Keep responses clear, concise, and actionable. Use tables, bullet points, and summary conclusions when helpful. Reply in the user's language unless they request otherwise.

Always remind users that your analysis is for research and educational purposes only and does not constitute personalized investment advice."""

DEFAULT_MULTI_AGENT_SAFE_TOOLS = [
    "web_search",
    "web_fetch",
    "read_file",
    "view_image",
    "read_skill",
    "memory_search",
    "memory_get",
    "knowledge_search",
    "knowledge_get",
    "get_financial_reports",
    "get_security_news",
    "get_security_insights",
    "get_longbridge_realtime_quotes",
    "get_longbridge_history_candlesticks",
    "get_longbridge_candlesticks",
    "get_longbridge_intraday",
    "get_longbridge_capital_flow",
    "get_longbridge_trades",
    "get_longbridge_depth",
    "get_longbridge_market_status",
    "get_longbridge_trading_days",
    "get_longbridge_quote_indicators",
    "get_technical_indicators",
]

DEFAULT_AGENT_TOOL_ALLOWLIST = [
    "bash",
    "web_search",
    "web_fetch",
    "read_file",
    "read_skill",
    "write_file",
    "render_image",
    "view_image",
    "get_financial_reports",
    "get_security_news",
    "get_security_insights",
    "get_portfolio_positions",
    "portfolio",
    "watchlist",
    "delegate_agent",
    "memory_search",
    "memory_get",
    "knowledge_search",
    "knowledge_get",
    "scheduler",
    "get_longbridge_realtime_quotes",
    "get_longbridge_history_candlesticks",
    "get_longbridge_candlesticks",
    "get_longbridge_intraday",
    "get_longbridge_capital_flow",
    "get_longbridge_trades",
    "get_longbridge_depth",
    "get_longbridge_market_status",
    "get_longbridge_trading_days",
    "get_longbridge_quote_indicators",
    "get_technical_indicators",
]

CODEX_OAUTH_API_BASE = "https://chatgpt.com/backend-api/codex"

CODEX_DEFAULT_MODEL = "gpt-5.2-codex"

EMBEDDING_DEFAULT_MODEL = "text-embedding-3-small"

USER_CONFIG_KEYS = {
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
    "embedding_auth_mode",
    "embedding_api_key",
    "embedding_api_base",
    "embedding_model",
    "embedding_provider",
    "embedding_codex_auth_file",
    "embedding_codex_api_base",
    "embedding_codex_model",
    "telegram_enabled",
    "telegram_bot_token",
    "telegram_chat_id",
    "telegram_api_base",
    "telegram_parse_mode",
    "mcp_servers",
    "mcp_tool_timeout_seconds",
    "longbridge_app_key",
    "longbridge_auth_mode",
    "longbridge_oauth_client_id",
    "longbridge_app_secret",
    "longbridge_access_token",
    "longbridge_http_url",
    "longbridge_quote_ws_url",
    "search_api_url",
    "search_api_key",
    "app_language",
    "app_theme_color",
    "agent_max_steps",
    "agent_max_context_tokens",
    "agent_max_context_turns",
    "multi_agent_enabled",
    "multi_agent_max_parallel_agents",
    "multi_agent_max_tasks_per_batch",
    "multi_agent_task_timeout_seconds",
    "multi_agent_default_max_steps",
    "multi_agent_max_depth",
    "knowledge_enabled",
    "memory_enabled",
    "memory_auto_curate_enabled",
    "memory_curator_min_importance",
    "memory_curator_min_confidence",
    "scheduler_enabled",
    "tracing_enabled",
    "product_analytics_enabled",
    "debug",
}

ALWAYS_USER_CONFIG_KEYS = {
    "app_language",
    "app_theme_color",
    "knowledge_enabled",
    "memory_enabled",
    "scheduler_enabled",
    "tracing_enabled",
    "product_analytics_enabled",
}

DEFAULT_MULTI_AGENT_ROLES: dict[str, dict[str, Any]] = {
    "researcher": {
        "description": "Gather facts, source context, and relevant background before analysis.",
        "system_prompt": (
            "You are a focused research sub-agent for Stocks Assistant. Gather verifiable facts, "
            "cite tool outputs when available, distinguish confirmed information from inference, "
            "and return a concise research brief for the orchestrating agent."
        ),
        "tool_allowlist": DEFAULT_MULTI_AGENT_SAFE_TOOLS,
        "max_steps": 8,
        "allow_dangerous_tools": False,
        "allow_all_mcp_tools": False,
    },
    "fundamental_analyst": {
        "description": "Analyze company fundamentals, reports, profitability, balance sheet, and valuation drivers.",
        "system_prompt": (
            "You are a fundamentals analysis sub-agent. Focus on financial statements, business quality, "
            "growth, profitability, cash flow, leverage, valuation context, and material risks. "
            "Return a structured brief with facts, assumptions, and watch items."
        ),
        "tool_allowlist": DEFAULT_MULTI_AGENT_SAFE_TOOLS,
        "max_steps": 8,
        "allow_dangerous_tools": False,
        "allow_all_mcp_tools": False,
    },
    "technical_analyst": {
        "description": "Analyze price action, trend, momentum, support/resistance, and market structure.",
        "system_prompt": (
            "You are a technical analysis sub-agent. Focus on trend, momentum, levels, volume context, "
            "and invalidation points. Be explicit about timeframe assumptions and avoid certainty."
        ),
        "tool_allowlist": DEFAULT_MULTI_AGENT_SAFE_TOOLS,
        "max_steps": 8,
        "allow_dangerous_tools": False,
        "allow_all_mcp_tools": False,
    },
    "risk_critic": {
        "description": "Challenge assumptions, identify downside scenarios, blind spots, and missing evidence.",
        "system_prompt": (
            "You are a risk critic sub-agent. Challenge the thesis, identify missing evidence, downside "
            "scenarios, concentration risks, data quality issues, and conditions that would invalidate the view."
        ),
        "tool_allowlist": DEFAULT_MULTI_AGENT_SAFE_TOOLS,
        "max_steps": 6,
        "allow_dangerous_tools": False,
        "allow_all_mcp_tools": False,
    },
    "summarizer": {
        "description": "Condense sub-agent findings into a concise synthesis for the orchestrating agent.",
        "system_prompt": (
            "You are a synthesis sub-agent. Condense provided findings into concise, non-redundant points, "
            "separating facts, inferences, risks, and suggested next checks."
        ),
        "tool_allowlist": ["read_skill", "memory_search", "memory_get"],
        "max_steps": 5,
        "allow_dangerous_tools": False,
        "allow_all_mcp_tools": False,
    },
}

_EFFECTIVE_CONFIG_TTL = 30.0

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
    "get_portfolio_snapshot_service",
    "get_session_store",
    "get_trace_store",
)


DEFAULT_LLM_PROVIDER = "openai_compatible"
DEFAULT_LLM_AUTH_MODE = "api_key"
DEFAULT_LLM_API_BASE = "https://api.openai.com/v1"
DEFAULT_LLM_MODEL = "gpt-4o"
MAX_LLM_TEMPERATURE = 2.0
DEFAULT_LLM_REASONING_EFFORT = "medium"
DEFAULT_LLM_TOOL_CHOICE = "auto"
DEFAULT_EMBEDDING_AUTH_MODE = "api_key"
DEFAULT_EMBEDDING_API_BASE = "https://api.openai.com/v1"
DEFAULT_WORKSPACE_DIR = "~/stocks-assistant"
DEFAULT_APP_LANGUAGE = "zh"
DEFAULT_APP_THEME_COLOR = ThemeColor.BLUE
DEFAULT_AUTH_MAX_DEVICES_PER_USER = 5
MAX_AUTH_MAX_DEVICES_PER_USER = 50
DEFAULT_AGENT_MAX_STEPS = 20
DEFAULT_AGENT_MAX_CONTEXT_TOKENS = 50000
DEFAULT_AGENT_MAX_CONTEXT_TURNS = 20
DEFAULT_MULTI_AGENT_MAX_PARALLEL_AGENTS = 3
MAX_MULTI_AGENT_MAX_PARALLEL_AGENTS = 8
DEFAULT_MULTI_AGENT_MAX_TASKS_PER_BATCH = 12
MAX_MULTI_AGENT_MAX_TASKS_PER_BATCH = 32
DEFAULT_MULTI_AGENT_TASK_TIMEOUT_SECONDS = 180
MIN_MULTI_AGENT_TASK_TIMEOUT_SECONDS = 10
MAX_MULTI_AGENT_TASK_TIMEOUT_SECONDS = 1800
DEFAULT_MULTI_AGENT_DEFAULT_MAX_STEPS = 8
MAX_MULTI_AGENT_DEFAULT_MAX_STEPS = 100
DEFAULT_MEMORY_CURATOR_MIN_IMPORTANCE = 0.7
DEFAULT_MEMORY_CURATOR_MIN_CONFIDENCE = 0.7
DEFAULT_CLAWHUB_REGISTRY_URL = "https://clawhub.ai"
DEFAULT_TELEGRAM_API_BASE = "https://api.telegram.org"
DEFAULT_MCP_TOOL_TIMEOUT_SECONDS = 60.0
DEFAULT_LONGBRIDGE_AUTH_MODE = "apikey"
DEFAULT_SEARCH_API_URL = "https://api.bocha.cn/v1/web-search"
DEFAULT_EMBEDDING_PROVIDER = "openai"
DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 8000


_LLM_PROVIDER_CACHE_TTL = 300.0


# 只从明确的公开字段白名单构造响应，新增 Settings 密钥不会自动出现在 API 中。
_PUBLIC_CONFIG_FIELDS = (
    "llm_provider",
    "llm_auth_mode",
    "llm_temperature",
    "llm_max_output_tokens",
    "llm_reasoning_effort",
    "llm_tool_choice",
    "embedding_auth_mode",
    "workspace_dir",
    "app_language",
    "app_theme_color",
    "auth_max_devices_per_user",
    "agent_max_steps",
    "agent_max_context_tokens",
    "agent_max_context_turns",
    "agent_tool_allowlist",
    "agent_allow_all_mcp_tools",
    "multi_agent_enabled",
    "multi_agent_max_parallel_agents",
    "multi_agent_max_tasks_per_batch",
    "multi_agent_task_timeout_seconds",
    "multi_agent_default_max_steps",
    "multi_agent_max_depth",
    "multi_agent_dangerous_tools",
    "multi_agent_roles",
    "knowledge_enabled",
    "memory_enabled",
    "memory_auto_curate_enabled",
    "memory_curator_min_importance",
    "memory_curator_min_confidence",
    "scheduler_enabled",
    "tracing_enabled",
    "product_analytics_enabled",
    "debug",
    "telegram_enabled",
    "system_prompt",
    "longbridge_auth_mode",
)

_PERSONAL_CONFIG_DEFAULTS = {
    "llm_api_base": "",
    "llm_model": "",
    "llm_codex_auth_file": "",
    "llm_codex_api_base": "",
    "llm_codex_model": "",
    "embedding_api_base": "",
    "embedding_model": "",
    "embedding_provider": DEFAULT_EMBEDDING_PROVIDER,
    "embedding_codex_auth_file": "",
    "embedding_codex_api_base": "",
    "embedding_codex_model": "",
    "telegram_chat_id": "",
    "telegram_api_base": DEFAULT_TELEGRAM_API_BASE,
    "telegram_parse_mode": "",
    "mcp_tool_timeout_seconds": DEFAULT_MCP_TOOL_TIMEOUT_SECONDS,
    "longbridge_oauth_client_id": "",
    "longbridge_http_url": "",
    "longbridge_quote_ws_url": "",
    "search_api_url": "",
}

_SECRET_CONFIG_FIELDS = (
    "llm_api_key",
    "embedding_api_key",
    "telegram_bot_token",
    "longbridge_app_key",
    "longbridge_app_secret",
    "longbridge_access_token",
    "search_api_key",
)


LLM_CONNECTION_CHECK_TIMEOUT_SECONDS = 45
CONNECTION_CHECK_TIMEOUT_SECONDS = 30
