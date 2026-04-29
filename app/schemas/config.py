"""配置管理 API Schema。"""

from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


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
    agent_max_steps: int
    agent_max_context_tokens: int
    agent_max_context_turns: int

    knowledge_enabled: bool
    memory_enabled: bool
    scheduler_enabled: bool
    debug: bool

    system_prompt: str
    mcp_servers: Dict[str, Dict[str, Any]] = Field(default_factory=dict)


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
    agent_max_steps: Optional[int] = None
    agent_max_context_tokens: Optional[int] = None
    agent_max_context_turns: Optional[int] = None

    knowledge_enabled: Optional[bool] = None
    memory_enabled: Optional[bool] = None
    scheduler_enabled: Optional[bool] = None
    debug: Optional[bool] = None

    system_prompt: Optional[str] = None
    mcp_servers: Optional[Dict[str, Dict[str, Any]]] = None
