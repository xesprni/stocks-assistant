"""配置管理 API Schema。"""

from typing import Any, Literal

from pydantic import Field, field_validator

from app.constants.configuration import (
    DEFAULT_APP_THEME_COLOR,
    DEFAULT_AUTH_MAX_DEVICES_PER_USER,
    DEFAULT_MCP_TOOL_TIMEOUT_SECONDS,
    DEFAULT_MEMORY_CURATOR_MIN_CONFIDENCE,
    DEFAULT_MEMORY_CURATOR_MIN_IMPORTANCE,
    DEFAULT_MULTI_AGENT_DEFAULT_MAX_STEPS,
    DEFAULT_MULTI_AGENT_MAX_PARALLEL_AGENTS,
    DEFAULT_MULTI_AGENT_MAX_TASKS_PER_BATCH,
    DEFAULT_MULTI_AGENT_TASK_TIMEOUT_SECONDS,
    DEFAULT_SEARCH_API_URL,
    DEFAULT_TELEGRAM_API_BASE,
    MAX_AUTH_MAX_DEVICES_PER_USER,
    MAX_LLM_TEMPERATURE,
    MAX_MULTI_AGENT_DEFAULT_MAX_STEPS,
    MAX_MULTI_AGENT_MAX_PARALLEL_AGENTS,
    MAX_MULTI_AGENT_MAX_TASKS_PER_BATCH,
    MAX_MULTI_AGENT_TASK_TIMEOUT_SECONDS,
    MIN_MULTI_AGENT_TASK_TIMEOUT_SECONDS,
    ThemeColor,
)
from app.constants.notifications import TELEGRAM_MESSAGE_LIMIT
from app.schemas.base import AppModel as BaseModel
from app.schemas.notifications import TelegramPhotos


class AppConfig(BaseModel):
    """前端可读取的应用配置。

    API 密钥只返回掩码状态，避免浏览器初始化时泄露完整密钥。
    """

    llm_provider: str = "openai_compatible"
    llm_auth_mode: str = "api_key"
    llm_api_base: str
    llm_model: str
    llm_codex_auth_file: str = ""
    llm_codex_api_base: str = ""
    llm_codex_model: str = ""
    llm_temperature: float = 0.0
    llm_max_output_tokens: int = 0
    llm_reasoning_effort: str = "medium"
    llm_tool_choice: str = "auto"
    has_codex_oauth: bool = False
    codex_oauth_account_id_masked: str = ""
    codex_oauth_error: str = ""
    llm_api_key_masked: str = ""
    has_llm_api_key: bool = False

    embedding_auth_mode: str = "api_key"
    embedding_api_base: str
    embedding_model: str
    embedding_provider: str = "openai"
    embedding_codex_auth_file: str = ""
    embedding_codex_api_base: str = ""
    embedding_codex_model: str = ""
    has_embedding_codex_oauth: bool = False
    embedding_codex_oauth_account_id_masked: str = ""
    embedding_codex_oauth_error: str = ""
    embedding_api_key_masked: str = ""
    has_embedding_api_key: bool = False

    workspace_dir: str
    app_language: str = "zh"
    app_theme_color: ThemeColor = DEFAULT_APP_THEME_COLOR
    auth_max_devices_per_user: int = DEFAULT_AUTH_MAX_DEVICES_PER_USER
    agent_max_steps: int
    agent_max_context_tokens: int
    agent_max_context_turns: int
    agent_tool_allowlist: list[str] = Field(default_factory=list)
    agent_allow_all_mcp_tools: bool = True
    multi_agent_enabled: bool = True
    multi_agent_max_parallel_agents: int = Field(
        default=DEFAULT_MULTI_AGENT_MAX_PARALLEL_AGENTS,
        ge=1,
        le=MAX_MULTI_AGENT_MAX_PARALLEL_AGENTS,
    )
    multi_agent_max_tasks_per_batch: int = Field(
        default=DEFAULT_MULTI_AGENT_MAX_TASKS_PER_BATCH,
        ge=1,
        le=MAX_MULTI_AGENT_MAX_TASKS_PER_BATCH,
    )
    multi_agent_task_timeout_seconds: int = Field(
        default=DEFAULT_MULTI_AGENT_TASK_TIMEOUT_SECONDS,
        ge=MIN_MULTI_AGENT_TASK_TIMEOUT_SECONDS,
        le=MAX_MULTI_AGENT_TASK_TIMEOUT_SECONDS,
    )
    multi_agent_default_max_steps: int = Field(
        default=DEFAULT_MULTI_AGENT_DEFAULT_MAX_STEPS, ge=1, le=MAX_MULTI_AGENT_DEFAULT_MAX_STEPS
    )
    multi_agent_max_depth: int = Field(default=1, ge=0, le=1)
    multi_agent_dangerous_tools: list[str] = Field(default_factory=list)
    multi_agent_roles: dict[str, dict[str, Any]] = Field(default_factory=dict)

    knowledge_enabled: bool
    memory_enabled: bool
    memory_auto_curate_enabled: bool = True
    memory_curator_min_importance: float = DEFAULT_MEMORY_CURATOR_MIN_IMPORTANCE
    memory_curator_min_confidence: float = DEFAULT_MEMORY_CURATOR_MIN_CONFIDENCE
    scheduler_enabled: bool
    tracing_enabled: bool = False
    product_analytics_enabled: bool = False
    debug: bool

    telegram_enabled: bool = False
    telegram_bot_token_masked: str = ""
    has_telegram_bot_token: bool = False
    telegram_chat_id: str = ""
    telegram_api_base: str = DEFAULT_TELEGRAM_API_BASE
    telegram_parse_mode: str = ""

    system_prompt: str
    mcp_servers: dict[str, dict[str, Any]] = Field(default_factory=dict)
    mcp_tool_timeout_seconds: float = DEFAULT_MCP_TOOL_TIMEOUT_SECONDS

    longbridge_auth_mode: Literal["apikey", "oauth"] = "apikey"
    longbridge_oauth_client_id: str = ""
    longbridge_oauth_connected: bool = False
    longbridge_app_key_masked: str = ""
    has_longbridge_app_key: bool = False
    longbridge_app_secret_masked: str = ""
    has_longbridge_app_secret: bool = False
    longbridge_access_token_masked: str = ""
    has_longbridge_access_token: bool = False
    longbridge_http_url: str = ""
    longbridge_quote_ws_url: str = ""
    search_api_url: str = DEFAULT_SEARCH_API_URL
    search_api_key_masked: str = ""
    has_search_api_key: bool = False
    personal_config_keys: list[str] = Field(default_factory=list)


class ConfigUpdate(BaseModel):
    """应用配置更新请求。

    字段均为可选；只持久化请求中显式传入的字段。
    """

    llm_provider: str | None = None
    llm_auth_mode: str | None = None
    llm_api_key: str | None = None
    llm_api_base: str | None = None
    llm_model: str | None = None
    llm_codex_auth_file: str | None = None
    llm_codex_api_base: str | None = None
    llm_codex_model: str | None = None
    llm_temperature: float | None = Field(default=None, ge=0.0, le=MAX_LLM_TEMPERATURE)
    llm_max_output_tokens: int | None = Field(default=None, ge=0)
    llm_reasoning_effort: str | None = None
    llm_tool_choice: str | None = None

    embedding_auth_mode: str | None = None
    embedding_api_key: str | None = None
    embedding_api_base: str | None = None
    embedding_model: str | None = None
    embedding_provider: str | None = None
    embedding_codex_auth_file: str | None = None
    embedding_codex_api_base: str | None = None
    embedding_codex_model: str | None = None

    workspace_dir: str | None = None
    app_language: str | None = None
    app_theme_color: ThemeColor | None = None
    auth_max_devices_per_user: int | None = Field(
        default=None, ge=1, le=MAX_AUTH_MAX_DEVICES_PER_USER
    )
    agent_max_steps: int | None = None
    agent_max_context_tokens: int | None = None
    agent_max_context_turns: int | None = None
    agent_tool_allowlist: list[str] | None = None
    agent_allow_all_mcp_tools: bool | None = None
    multi_agent_enabled: bool | None = None
    multi_agent_max_parallel_agents: int | None = Field(
        default=None, ge=1, le=MAX_MULTI_AGENT_MAX_PARALLEL_AGENTS
    )
    multi_agent_max_tasks_per_batch: int | None = Field(
        default=None, ge=1, le=MAX_MULTI_AGENT_MAX_TASKS_PER_BATCH
    )
    multi_agent_task_timeout_seconds: int | None = Field(
        default=None,
        ge=MIN_MULTI_AGENT_TASK_TIMEOUT_SECONDS,
        le=MAX_MULTI_AGENT_TASK_TIMEOUT_SECONDS,
    )
    multi_agent_default_max_steps: int | None = Field(
        default=None, ge=1, le=MAX_MULTI_AGENT_DEFAULT_MAX_STEPS
    )
    multi_agent_max_depth: int | None = Field(default=None, ge=0, le=1)
    multi_agent_dangerous_tools: list[str] | None = None
    multi_agent_roles: dict[str, dict[str, Any]] | None = None

    knowledge_enabled: bool | None = None
    memory_enabled: bool | None = None
    memory_auto_curate_enabled: bool | None = None
    memory_curator_min_importance: float | None = None
    memory_curator_min_confidence: float | None = None
    scheduler_enabled: bool | None = None
    tracing_enabled: bool | None = None
    product_analytics_enabled: bool | None = None
    debug: bool | None = None

    telegram_enabled: bool | None = None
    telegram_bot_token: str | None = None
    telegram_chat_id: str | None = None
    telegram_api_base: str | None = None
    telegram_parse_mode: str | None = None

    system_prompt: str | None = None
    mcp_servers: dict[str, dict[str, Any]] | None = None
    mcp_tool_timeout_seconds: float | None = None

    longbridge_auth_mode: Literal["apikey", "oauth"] | None = None
    longbridge_app_key: str | None = None
    longbridge_app_secret: str | None = None
    longbridge_access_token: str | None = None
    longbridge_http_url: str | None = None
    longbridge_quote_ws_url: str | None = None
    search_api_url: str | None = None
    search_api_key: str | None = None

    @field_validator("llm_reasoning_effort", mode="before")
    @classmethod
    def validate_llm_reasoning_effort(cls, value: Any) -> str | None:
        if value is None:
            return value
        normalized = str(value or "medium").strip().lower().replace("-", "_")
        if normalized in {"minimal", "low", "medium", "high"}:
            return normalized
        return "medium"

    @field_validator("llm_tool_choice", mode="before")
    @classmethod
    def validate_llm_tool_choice(cls, value: Any) -> str | None:
        if value is None:
            return value
        normalized = str(value or "auto").strip().lower().replace("-", "_")
        if normalized in {"auto", "none", "required"}:
            return normalized
        if normalized in {"any", "force", "forced"}:
            return "required"
        return "auto"

    @field_validator("mcp_servers", mode="before")
    @classmethod
    def validate_mcp_servers(cls, value: Any) -> dict[str, dict[str, Any]]:
        from app.core.tools.mcp.config import normalize_mcp_servers

        return normalize_mcp_servers(value)


class TelegramTestRequest(BaseModel):
    """Telegram 测试消息请求。"""

    message: str = Field(
        default="Stocks Assistant Telegram test message.", max_length=TELEGRAM_MESSAGE_LIMIT
    )
    photos: TelegramPhotos = Field(default_factory=list)


class TelegramTestResponse(BaseModel):
    """Telegram 测试消息响应。"""

    ok: bool
    chunks: int = 0
    photos: int = 0
    detail: str = ""


class ConnectionCheck(BaseModel):
    """单个外部依赖的就绪状态。"""

    component: str
    status: str
    configured: bool
    detail: str
    depends_on: list[str] = Field(default_factory=list)


class ConfigReadinessResponse(BaseModel):
    """首次使用向导所需的连接与功能就绪状态。"""

    ready: bool
    checks: list[ConnectionCheck] = Field(default_factory=list)


class ConnectionTestResponse(BaseModel):
    component: str
    ok: bool
    detail: str
    checked_at: str


class DemoDataResponse(BaseModel):
    watchlist_created: int = 0
    portfolio_created: int = 0
    detail: str = ""


class CodexOAuthStatus(BaseModel):
    available: bool
    account_id: str
    auth_path: str = ""
    error: str = ""
