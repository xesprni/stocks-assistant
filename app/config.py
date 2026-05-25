"""全局配置模块

配置持久化在应用级 SQLite 数据库中。环境变量不再覆盖业务配置；
唯一启动级环境变量是 STOCKS_ASSISTANT_DB_PATH，用于定位应用 SQLite。
首次加载时会把旧 config.json 作为一次性迁移来源。
"""

from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, Optional, Tuple, Type

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, PydanticBaseSettingsSource


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
    "web_fetch",
    "read_file",
    "read_skill",
    "memory_search",
    "memory_get",
    "get_financial_reports",
    "get_longbridge_realtime_quotes",
    "get_longbridge_history_candlesticks",
    "get_longbridge_candlesticks",
    "get_longbridge_intraday",
    "get_longbridge_trades",
    "get_longbridge_depth",
    "get_longbridge_market_status",
    "get_longbridge_trading_days",
    "get_longbridge_quote_indicators",
]


DEFAULT_AGENT_TOOL_ALLOWLIST = [
    "bash",
    "web_search",
    "web_fetch",
    "read_file",
    "read_skill",
    "write_file",
    "get_financial_reports",
    "get_portfolio_positions",
    "delegate_agent",
    "memory_search",
    "memory_get",
    "scheduler",
    "get_longbridge_realtime_quotes",
    "get_longbridge_history_candlesticks",
    "get_longbridge_candlesticks",
    "get_longbridge_intraday",
    "get_longbridge_trades",
    "get_longbridge_depth",
    "get_longbridge_market_status",
    "get_longbridge_trading_days",
    "get_longbridge_quote_indicators",
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
    "longbridge_app_secret",
    "longbridge_access_token",
    "longbridge_http_url",
    "longbridge_quote_ws_url",
    "app_language",
    "agent_max_steps",
    "agent_max_context_tokens",
    "agent_max_context_turns",
    "multi_agent_enabled",
    "multi_agent_max_parallel_agents",
    "multi_agent_default_max_steps",
    "multi_agent_max_depth",
    "knowledge_enabled",
    "memory_enabled",
    "memory_auto_curate_enabled",
    "memory_curator_min_importance",
    "memory_curator_min_confidence",
    "scheduler_enabled",
    "tracing_enabled",
    "debug",
}

ALWAYS_USER_CONFIG_KEYS = {
    "app_language",
    "knowledge_enabled",
    "memory_enabled",
    "scheduler_enabled",
    "tracing_enabled",
}


DEFAULT_MULTI_AGENT_ROLES: Dict[str, Dict[str, Any]] = {
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


class Settings(BaseSettings):
    """应用全局配置

    Settings 保留 Pydantic 校验/默认值能力；实际数据由 app_config 表加载。
    """

    # ---- LLM 大模型配置 ----
    llm_provider: str = "openai_compatible"  # openai_compatible / openai_responses
    llm_auth_mode: str = "api_key"  # api_key / codex
    llm_api_key: str = ""  # API 密钥
    llm_api_base: str = "https://api.openai.com/v1"  # API 地址（兼容 OpenAI 接口）
    llm_model: str = "gpt-4o"  # 模型名称
    llm_codex_auth_file: str = ""  # Codex OAuth 登录态文件；为空时读取 $CODEX_HOME/auth.json 或 ~/.codex/auth.json
    llm_codex_api_base: str = CODEX_OAUTH_API_BASE  # Codex OAuth API 地址
    llm_codex_model: str = CODEX_DEFAULT_MODEL  # Codex OAuth 模型名称

    # ---- Embedding 向量化配置 ----
    embedding_auth_mode: str = "api_key"  # api_key / codex
    embedding_api_key: str = ""  # 向量化 API 密钥（为空时使用 llm_api_key）
    embedding_api_base: str = "https://api.openai.com/v1"
    embedding_model: str = EMBEDDING_DEFAULT_MODEL  # 向量化模型
    embedding_codex_auth_file: str = ""  # Embedding Codex OAuth 登录态文件
    embedding_codex_api_base: str = CODEX_OAUTH_API_BASE
    embedding_codex_model: str = EMBEDDING_DEFAULT_MODEL

    # ---- 工作空间 ----
    workspace_dir: str = "~/stocks-assistant"  # 工作空间根目录
    app_language: str = "zh"  # UI 语言：zh / en

    # ---- 认证安全配置 ----
    auth_max_devices_per_user: int = Field(default=5, ge=1, le=50)  # 单账号最多保留的活跃登录设备数

    # ---- Agent 智能体配置 ----
    agent_max_steps: int = 20  # 单次对话最大工具调用轮数
    agent_max_context_tokens: int = 50000  # 上下文窗口最大 token 数
    agent_max_context_turns: int = 20  # 上下文最大对话轮数
    agent_tool_allowlist: list[str] = Field(default_factory=lambda: list(DEFAULT_AGENT_TOOL_ALLOWLIST))
    agent_allow_all_mcp_tools: bool = True
    multi_agent_enabled: bool = True  # 是否启用多 Agent 委派工具
    multi_agent_max_parallel_agents: int = 3  # 单次委派最多并行智能体数
    multi_agent_default_max_steps: int = 8  # 智能体默认最大执行步数
    multi_agent_max_depth: int = 1  # V1 固定为 1，避免递归委派
    multi_agent_dangerous_tools: list[str] = Field(
        default_factory=lambda: ["bash", "write_file", "scheduler"],
    )
    multi_agent_roles: Dict[str, Dict[str, Any]] = Field(
        default_factory=lambda: deepcopy(DEFAULT_MULTI_AGENT_ROLES),
    )

    # ---- 功能开关 ----
    knowledge_enabled: bool = True  # 是否启用知识库
    memory_enabled: bool = True  # 是否启用长期记忆
    memory_auto_curate_enabled: bool = True  # 是否从对话中自动筛选长期记忆
    memory_curator_min_importance: float = 0.7  # 自动记忆重要性阈值
    memory_curator_min_confidence: float = 0.7  # 自动记忆置信度阈值
    scheduler_enabled: bool = True  # 是否启用定时任务
    tracing_enabled: bool = False  # 是否启用 Agent 调用追踪
    clawhub_registry_url: str = "https://clawhub.ai"  # ClawHub HTTP API 根地址

    # ---- Telegram 通知配置 ----
    telegram_enabled: bool = False  # 是否允许定时任务发送 Telegram 消息
    telegram_bot_token: str = ""  # Telegram Bot Token
    telegram_chat_id: str = ""  # 默认发送目标 chat_id
    telegram_api_base: str = "https://api.telegram.org"  # Telegram Bot API 地址
    telegram_parse_mode: str = ""  # 可选：留空/auto 将 Markdown 转 HTML；plain 纯文本

    # ---- MCP 服务器配置 ----
    # 格式: {"server_name": {"transport": "streamable_http", "url": "..."}}
    mcp_servers: Dict[str, Dict[str, Any]] = {}
    mcp_tool_timeout_seconds: float = Field(default=60.0, gt=0)  # 单次 MCP 工具调用超时时间

    # ---- Longbridge OpenAPI 配置 ----
    # 为空时 Longbridge SDK 会读取 LONGBRIDGE_* 环境变量。
    longbridge_app_key: str = ""
    longbridge_app_secret: str = ""
    longbridge_access_token: str = ""
    longbridge_http_url: str = ""
    longbridge_quote_ws_url: str = ""

    # ---- 系统提示词 ----
    system_prompt: str = DEFAULT_SYSTEM_PROMPT

    # ---- 向量化服务商标识 ----
    embedding_provider: str = "openai"

    # ---- 其他配置 ----
    debug: bool = False  # 调试模式
    host: str = "0.0.0.0"  # 服务监听地址
    port: int = 8000  # 服务监听端口

    # 只接收显式 init 数据；不再读取 .env、APP_* 或 config.json。
    model_config = {
        "extra": "ignore",
    }

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: Type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> Tuple[PydanticBaseSettingsSource, ...]:
        return (
            init_settings,
        )

    def get_workspace_path(self) -> Path:
        """获取工作空间路径（自动创建目录）"""
        p = Path(self.workspace_dir).expanduser()
        p.mkdir(parents=True, exist_ok=True)
        return p

    @field_validator("mcp_servers", mode="before")
    @classmethod
    def validate_mcp_servers(cls, value):
        from app.core.tools.mcp.config import normalize_mcp_servers

        return normalize_mcp_servers(value)

    @field_validator("app_language", mode="before")
    @classmethod
    def validate_app_language(cls, value):
        normalized = str(value or "zh").strip().lower()
        if normalized in {"zh", "zh-cn", "cn", "chinese"}:
            return "zh"
        if normalized in {"en", "en-us", "english"}:
            return "en"
        return "zh"

    @field_validator("llm_provider", mode="before")
    @classmethod
    def validate_llm_provider(cls, value):
        normalized = str(value or "openai_compatible").strip().lower().replace("-", "_")
        if normalized in {"openai", "chat", "chat_completions", "openai_chat", "openai_compatible"}:
            return "openai_compatible"
        if normalized in {"responses", "openai_responses", "codex", "openai_codex"}:
            return "openai_responses"
        return "openai_compatible"

    @field_validator("llm_auth_mode", mode="before")
    @classmethod
    def validate_llm_auth_mode(cls, value):
        normalized = str(value or "api_key").strip().lower().replace("-", "_")
        if normalized in {"codex", "chatgpt", "chatgpt_oauth", "codex_oauth", "oauth"}:
            return "codex"
        return "api_key"

    @field_validator("embedding_auth_mode", mode="before")
    @classmethod
    def validate_embedding_auth_mode(cls, value):
        normalized = str(value or "api_key").strip().lower().replace("-", "_")
        if normalized in {"codex", "chatgpt", "chatgpt_oauth", "codex_oauth", "oauth"}:
            return "codex"
        return "api_key"

    @model_validator(mode="after")
    def normalize_llm_auth_pair(self):
        llm_base = (self.llm_api_base or "").rstrip("/")
        embedding_base = (self.embedding_api_base or "").rstrip("/")
        legacy_llm_codex_base = self.llm_provider == "openai_responses" and llm_base == CODEX_OAUTH_API_BASE
        legacy_embedding_codex_base = embedding_base == CODEX_OAUTH_API_BASE

        if legacy_llm_codex_base:
            self.llm_auth_mode = "codex"
        if self.llm_auth_mode == "codex":
            self.llm_provider = "openai_responses"
            if not self.llm_codex_api_base:
                self.llm_codex_api_base = CODEX_OAUTH_API_BASE
            if llm_base == CODEX_OAUTH_API_BASE:
                self.llm_codex_api_base = CODEX_OAUTH_API_BASE
                fallback_api_base = self.embedding_api_base if embedding_base and embedding_base != CODEX_OAUTH_API_BASE else "https://api.openai.com/v1"
                self.llm_api_base = fallback_api_base
            if not self.llm_codex_model:
                self.llm_codex_model = self.llm_model if legacy_llm_codex_base and self.llm_model else CODEX_DEFAULT_MODEL
            if not self.llm_model:
                self.llm_model = "gpt-4o"
        if legacy_embedding_codex_base:
            self.embedding_auth_mode = "codex"
        if self.embedding_auth_mode == "codex":
            if not self.embedding_codex_api_base:
                self.embedding_codex_api_base = CODEX_OAUTH_API_BASE
            if embedding_base == CODEX_OAUTH_API_BASE:
                self.embedding_codex_api_base = CODEX_OAUTH_API_BASE
                fallback_embedding_base = self.llm_api_base if (self.llm_api_base or "").rstrip("/") != CODEX_OAUTH_API_BASE else "https://api.openai.com/v1"
                self.embedding_api_base = fallback_embedding_base or "https://api.openai.com/v1"
            if not self.embedding_codex_model:
                self.embedding_codex_model = self.embedding_model if legacy_embedding_codex_base and self.embedding_model else EMBEDDING_DEFAULT_MODEL
        return self


# 全局配置单例
_config_instance: Optional[Settings] = None


def get_settings() -> Settings:
    """获取全局配置单例（懒加载）"""
    global _config_instance
    if _config_instance is None:
        _config_instance = _load_settings()
    return _config_instance


def get_effective_config(user_id: Optional[str] = None) -> dict[str, Any]:
    """Return system config overlaid with the user's personal config."""
    from app.core.app_store import get_app_store

    store = get_app_store()
    store.migrate_config_json_once()
    system_config = store.get_config()
    if not user_id:
        return system_config
    user_config = {
        key: value
        for key, value in store.get_user_config(user_id).items()
        if key in USER_CONFIG_KEYS
    }
    return {**system_config, **user_config}


def get_effective_settings(user_id: Optional[str] = None) -> Settings:
    """Build settings for a request/user without mutating the global singleton."""
    return Settings(**get_effective_config(user_id))


def _load_settings() -> Settings:
    """Load settings from the application SQLite config table."""
    from app.core.app_store import get_app_store

    store = get_app_store()
    store.migrate_config_json_once()
    return Settings(**store.get_config())
