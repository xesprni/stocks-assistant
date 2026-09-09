"""配置管理 API Schema。"""

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

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
    research_quick_prompts_refresh_seconds: int = Field(default=3600, ge=60, le=604800)
    auth_max_devices_per_user: int = 5
    agent_max_steps: int
    agent_max_context_tokens: int
    agent_max_context_turns: int
    agent_tool_allowlist: list[str] = Field(default_factory=list)
    agent_allow_all_mcp_tools: bool = True
    multi_agent_enabled: bool = True
    multi_agent_max_parallel_agents: int = 3
    multi_agent_default_max_steps: int = 8
    multi_agent_max_depth: int = 1
    multi_agent_dangerous_tools: list[str] = Field(default_factory=list)
    multi_agent_roles: dict[str, dict[str, Any]] = Field(default_factory=dict)

    knowledge_enabled: bool
    memory_enabled: bool
    memory_auto_curate_enabled: bool = True
    memory_curator_min_importance: float = 0.7
    memory_curator_min_confidence: float = 0.7
    scheduler_enabled: bool
    tracing_enabled: bool = False
    product_analytics_enabled: bool = False
    debug: bool

    telegram_enabled: bool = False
    telegram_bot_token_masked: str = ""
    has_telegram_bot_token: bool = False
    telegram_chat_id: str = ""
    telegram_api_base: str = "https://api.telegram.org"
    telegram_parse_mode: str = ""

    system_prompt: str
    mcp_servers: dict[str, dict[str, Any]] = Field(default_factory=dict)
    mcp_tool_timeout_seconds: float = 60.0

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
    guardian_api_key_masked: str = ""
    has_guardian_api_key: bool = False
    search_api_url: str = "https://api.bocha.cn/v1/web-search"
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
    llm_temperature: float | None = Field(default=None, ge=0.0, le=2.0)
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
    research_quick_prompts_refresh_seconds: int | None = Field(default=None, ge=60, le=604800)
    auth_max_devices_per_user: int | None = Field(default=None, ge=1, le=50)
    agent_max_steps: int | None = None
    agent_max_context_tokens: int | None = None
    agent_max_context_turns: int | None = None
    agent_tool_allowlist: list[str] | None = None
    agent_allow_all_mcp_tools: bool | None = None
    multi_agent_enabled: bool | None = None
    multi_agent_max_parallel_agents: int | None = None
    multi_agent_default_max_steps: int | None = None
    multi_agent_max_depth: int | None = None
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
    guardian_api_key: str | None = None
    search_api_url: str | None = None
    search_api_key: str | None = None

    @field_validator("llm_reasoning_effort", mode="before")
    @classmethod
    def validate_llm_reasoning_effort(cls, value):
        if value is None:
            return value
        normalized = str(value or "medium").strip().lower().replace("-", "_")
        if normalized in {"minimal", "low", "medium", "high"}:
            return normalized
        return "medium"

    @field_validator("llm_tool_choice", mode="before")
    @classmethod
    def validate_llm_tool_choice(cls, value):
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
    def validate_mcp_servers(cls, value):
        from app.core.tools.mcp.config import normalize_mcp_servers

        return normalize_mcp_servers(value)


class TelegramTestRequest(BaseModel):
    """Telegram 测试消息请求。"""

    message: str = Field(default="Stocks Assistant Telegram test message.", max_length=4096)
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
