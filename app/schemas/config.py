"""配置管理 API Schema。"""

from typing import Any, Dict, Optional

from pydantic import BaseModel, Field, field_validator


class AppConfig(BaseModel):
    """前端可读取的应用配置。

    API 密钥只返回掩码状态，避免浏览器初始化时泄露完整密钥。
    """

    llm_api_base: str
    llm_model: str
    llm_api_key_masked: str = ""
    has_llm_api_key: bool = False

    embedding_api_base: str
    embedding_model: str
    embedding_provider: str = "openai"
    embedding_api_key_masked: str = ""
    has_embedding_api_key: bool = False

    workspace_dir: str
    app_language: str = "zh"
    agent_max_steps: int
    agent_max_context_tokens: int
    agent_max_context_turns: int
    multi_agent_enabled: bool = True
    multi_agent_max_parallel_agents: int = 3
    multi_agent_default_max_steps: int = 8
    multi_agent_max_depth: int = 1
    multi_agent_dangerous_tools: list[str] = Field(default_factory=list)
    multi_agent_roles: Dict[str, Dict[str, Any]] = Field(default_factory=dict)

    knowledge_enabled: bool
    memory_enabled: bool
    memory_auto_curate_enabled: bool = True
    memory_curator_min_importance: float = 0.7
    memory_curator_min_confidence: float = 0.7
    scheduler_enabled: bool
    tracing_enabled: bool = False
    debug: bool

    telegram_enabled: bool = False
    telegram_bot_token_masked: str = ""
    has_telegram_bot_token: bool = False
    telegram_chat_id: str = ""
    telegram_api_base: str = "https://api.telegram.org"
    telegram_parse_mode: str = ""

    system_prompt: str
    mcp_servers: Dict[str, Dict[str, Any]] = Field(default_factory=dict)
    mcp_tool_timeout_seconds: float = 60.0

    longbridge_app_key_masked: str = ""
    has_longbridge_app_key: bool = False
    longbridge_app_secret_masked: str = ""
    has_longbridge_app_secret: bool = False
    longbridge_access_token_masked: str = ""
    has_longbridge_access_token: bool = False
    longbridge_http_url: str = ""
    longbridge_quote_ws_url: str = ""


class ConfigUpdate(BaseModel):
    """应用配置更新请求。

    字段均为可选；只持久化请求中显式传入的字段。
    """

    llm_api_key: Optional[str] = None
    llm_api_base: Optional[str] = None
    llm_model: Optional[str] = None

    embedding_api_key: Optional[str] = None
    embedding_api_base: Optional[str] = None
    embedding_model: Optional[str] = None
    embedding_provider: Optional[str] = None

    workspace_dir: Optional[str] = None
    app_language: Optional[str] = None
    agent_max_steps: Optional[int] = None
    agent_max_context_tokens: Optional[int] = None
    agent_max_context_turns: Optional[int] = None
    multi_agent_enabled: Optional[bool] = None
    multi_agent_max_parallel_agents: Optional[int] = None
    multi_agent_default_max_steps: Optional[int] = None
    multi_agent_max_depth: Optional[int] = None
    multi_agent_dangerous_tools: Optional[list[str]] = None
    multi_agent_roles: Optional[Dict[str, Dict[str, Any]]] = None

    knowledge_enabled: Optional[bool] = None
    memory_enabled: Optional[bool] = None
    memory_auto_curate_enabled: Optional[bool] = None
    memory_curator_min_importance: Optional[float] = None
    memory_curator_min_confidence: Optional[float] = None
    scheduler_enabled: Optional[bool] = None
    tracing_enabled: Optional[bool] = None
    debug: Optional[bool] = None

    telegram_enabled: Optional[bool] = None
    telegram_bot_token: Optional[str] = None
    telegram_chat_id: Optional[str] = None
    telegram_api_base: Optional[str] = None
    telegram_parse_mode: Optional[str] = None

    system_prompt: Optional[str] = None
    mcp_servers: Optional[Dict[str, Dict[str, Any]]] = None
    mcp_tool_timeout_seconds: Optional[float] = None

    longbridge_app_key: Optional[str] = None
    longbridge_app_secret: Optional[str] = None
    longbridge_access_token: Optional[str] = None
    longbridge_http_url: Optional[str] = None
    longbridge_quote_ws_url: Optional[str] = None

    @field_validator("mcp_servers", mode="before")
    @classmethod
    def validate_mcp_servers(cls, value):
        from app.core.tools.mcp.config import normalize_mcp_servers

        return normalize_mcp_servers(value)


class TelegramTestRequest(BaseModel):
    """Telegram 测试消息请求。"""

    message: str = Field(default="Stocks Assistant Telegram test message.", max_length=4096)


class TelegramTestResponse(BaseModel):
    """Telegram 测试消息响应。"""

    ok: bool
    chunks: int = 0
    detail: str = ""
