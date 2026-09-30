"""全局配置模块

配置持久化在应用级 SQLite 数据库中。环境变量不再覆盖业务配置；
唯一启动级环境变量是 STOCKS_ASSISTANT_DB_PATH，用于定位应用 SQLite。
首次加载时会把旧 config.json 作为一次性迁移来源。
"""

import threading
import time as _time
from copy import deepcopy
from pathlib import Path
from typing import Any, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, PydanticBaseSettingsSource

from app.constants.configuration import (
    _EFFECTIVE_CONFIG_TTL as _EFFECTIVE_CONFIG_TTL,
)
from app.constants.configuration import (
    ALWAYS_USER_CONFIG_KEYS as ALWAYS_USER_CONFIG_KEYS,
)
from app.constants.configuration import (
    CODEX_DEFAULT_MODEL as CODEX_DEFAULT_MODEL,
)
from app.constants.configuration import (
    CODEX_OAUTH_API_BASE as CODEX_OAUTH_API_BASE,
)
from app.constants.configuration import (
    DEFAULT_AGENT_MAX_CONTEXT_TOKENS,
    DEFAULT_AGENT_MAX_CONTEXT_TURNS,
    DEFAULT_AGENT_MAX_STEPS,
    DEFAULT_APP_LANGUAGE,
    DEFAULT_AUTH_MAX_DEVICES_PER_USER,
    DEFAULT_CLAWHUB_REGISTRY_URL,
    DEFAULT_EMBEDDING_API_BASE,
    DEFAULT_EMBEDDING_AUTH_MODE,
    DEFAULT_EMBEDDING_PROVIDER,
    DEFAULT_HOST,
    DEFAULT_LLM_API_BASE,
    DEFAULT_LLM_AUTH_MODE,
    DEFAULT_LLM_MODEL,
    DEFAULT_LLM_PROVIDER,
    DEFAULT_LLM_REASONING_EFFORT,
    DEFAULT_LLM_TOOL_CHOICE,
    DEFAULT_LONGBRIDGE_AUTH_MODE,
    DEFAULT_MCP_TOOL_TIMEOUT_SECONDS,
    DEFAULT_MEMORY_CURATOR_MIN_CONFIDENCE,
    DEFAULT_MEMORY_CURATOR_MIN_IMPORTANCE,
    DEFAULT_MULTI_AGENT_DEFAULT_MAX_STEPS,
    DEFAULT_MULTI_AGENT_MAX_PARALLEL_AGENTS,
    DEFAULT_MULTI_AGENT_MAX_TASKS_PER_BATCH,
    DEFAULT_MULTI_AGENT_TASK_TIMEOUT_SECONDS,
    DEFAULT_PORT,
    DEFAULT_SEARCH_API_URL,
    DEFAULT_TELEGRAM_API_BASE,
    DEFAULT_WORKSPACE_DIR,
    MAX_AUTH_MAX_DEVICES_PER_USER,
    MAX_LLM_TEMPERATURE,
    MAX_MULTI_AGENT_DEFAULT_MAX_STEPS,
    MAX_MULTI_AGENT_MAX_PARALLEL_AGENTS,
    MAX_MULTI_AGENT_MAX_TASKS_PER_BATCH,
    MAX_MULTI_AGENT_TASK_TIMEOUT_SECONDS,
    MIN_MULTI_AGENT_TASK_TIMEOUT_SECONDS,
)
from app.constants.configuration import (
    DEFAULT_AGENT_TOOL_ALLOWLIST as DEFAULT_AGENT_TOOL_ALLOWLIST,
)
from app.constants.configuration import (
    DEFAULT_MULTI_AGENT_ROLES as DEFAULT_MULTI_AGENT_ROLES,
)
from app.constants.configuration import (
    DEFAULT_MULTI_AGENT_SAFE_TOOLS as DEFAULT_MULTI_AGENT_SAFE_TOOLS,
)
from app.constants.configuration import (
    DEFAULT_SYSTEM_PROMPT as DEFAULT_SYSTEM_PROMPT,
)
from app.constants.configuration import (
    EMBEDDING_DEFAULT_MODEL as EMBEDDING_DEFAULT_MODEL,
)
from app.constants.configuration import (
    USER_CONFIG_KEYS as USER_CONFIG_KEYS,
)


class Settings(BaseSettings):
    """应用全局配置

    Settings 保留 Pydantic 校验/默认值能力；实际数据由 app_config 表加载。
    """

    # ---- LLM 大模型配置 ----
    llm_provider: str = DEFAULT_LLM_PROVIDER  # openai_compatible / openai_responses
    llm_auth_mode: str = DEFAULT_LLM_AUTH_MODE  # api_key / codex
    llm_api_key: str = ""  # API 密钥
    llm_api_base: str = DEFAULT_LLM_API_BASE  # API 地址（兼容 OpenAI 接口）
    llm_model: str = DEFAULT_LLM_MODEL  # 模型名称
    llm_codex_auth_file: str = (
        ""  # Codex OAuth 登录态文件；为空时读取 $CODEX_HOME/auth.json 或 ~/.codex/auth.json
    )
    llm_codex_api_base: str = CODEX_OAUTH_API_BASE  # Codex OAuth API 地址
    llm_codex_model: str = CODEX_DEFAULT_MODEL  # Codex OAuth 模型名称
    llm_temperature: float = Field(default=0.0, ge=0.0, le=MAX_LLM_TEMPERATURE)  # 主 Agent 生成温度
    llm_max_output_tokens: int = Field(default=0, ge=0)  # 主 Agent 单次回复上限；0 表示使用模型默认
    llm_reasoning_effort: str = (
        DEFAULT_LLM_REASONING_EFFORT  # 思考模式强度：minimal / low / medium / high
    )
    llm_tool_choice: str = DEFAULT_LLM_TOOL_CHOICE  # 工具选择策略：auto / none / required

    # ---- Embedding 向量化配置 ----
    embedding_auth_mode: str = DEFAULT_EMBEDDING_AUTH_MODE  # api_key / codex
    embedding_api_key: str = ""  # 向量化 API 密钥（为空时使用 llm_api_key）
    embedding_api_base: str = DEFAULT_EMBEDDING_API_BASE
    embedding_model: str = EMBEDDING_DEFAULT_MODEL  # 向量化模型
    embedding_codex_auth_file: str = ""  # Embedding Codex OAuth 登录态文件
    embedding_codex_api_base: str = CODEX_OAUTH_API_BASE
    embedding_codex_model: str = EMBEDDING_DEFAULT_MODEL

    # ---- 工作空间 ----
    workspace_dir: str = DEFAULT_WORKSPACE_DIR  # 工作空间根目录
    app_language: str = DEFAULT_APP_LANGUAGE  # UI 语言：zh / en

    # ---- 认证安全配置 ----
    auth_max_devices_per_user: int = Field(
        default=DEFAULT_AUTH_MAX_DEVICES_PER_USER, ge=1, le=MAX_AUTH_MAX_DEVICES_PER_USER
    )  # 单账号最多保留的活跃登录设备数

    # ---- Agent 智能体配置 ----
    agent_max_steps: int = DEFAULT_AGENT_MAX_STEPS  # 单次对话最大工具调用轮数
    agent_max_context_tokens: int = DEFAULT_AGENT_MAX_CONTEXT_TOKENS  # 上下文窗口最大 token 数
    agent_max_context_turns: int = DEFAULT_AGENT_MAX_CONTEXT_TURNS  # 上下文最大对话轮数
    agent_tool_allowlist: list[str] = Field(
        default_factory=lambda: list(DEFAULT_AGENT_TOOL_ALLOWLIST)
    )
    agent_allow_all_mcp_tools: bool = True
    multi_agent_enabled: bool = True  # 是否启用多 Agent 委派工具
    # 批次容量与并发分开限制，依赖任务排队时不占用执行名额。
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
    multi_agent_max_depth: int = Field(default=1, ge=0, le=1)  # 0 禁用，1 避免递归委派
    multi_agent_dangerous_tools: list[str] = Field(
        default_factory=lambda: [
            "bash",
            "write_file",
            "render_image",
            "scheduler",
            "watchlist",
            "portfolio",
        ],
    )
    multi_agent_roles: dict[str, dict[str, Any]] = Field(
        default_factory=lambda: deepcopy(DEFAULT_MULTI_AGENT_ROLES),
    )

    # ---- 功能开关 ----
    knowledge_enabled: bool = True  # 是否启用知识库
    memory_enabled: bool = True  # 是否启用长期记忆
    memory_auto_curate_enabled: bool = True  # 是否从对话中自动筛选长期记忆
    memory_curator_min_importance: float = (
        DEFAULT_MEMORY_CURATOR_MIN_IMPORTANCE  # 自动记忆重要性阈值
    )
    memory_curator_min_confidence: float = (
        DEFAULT_MEMORY_CURATOR_MIN_CONFIDENCE  # 自动记忆置信度阈值
    )
    scheduler_enabled: bool = True  # 是否启用定时任务
    tracing_enabled: bool = False  # 是否启用 Agent 调用追踪
    product_analytics_enabled: bool = False  # 隐私优先的本地产品事件，仅在用户明确开启后记录
    clawhub_registry_url: str = DEFAULT_CLAWHUB_REGISTRY_URL  # ClawHub HTTP API 根地址

    # ---- Telegram 通知配置 ----
    telegram_enabled: bool = False  # 是否允许定时任务发送 Telegram 消息
    telegram_bot_token: str = ""  # Telegram Bot Token
    telegram_chat_id: str = ""  # 默认发送目标 chat_id
    telegram_api_base: str = DEFAULT_TELEGRAM_API_BASE  # Telegram Bot API 地址
    telegram_parse_mode: str = ""  # 可选：留空/auto 将 Markdown 转 HTML；plain 纯文本

    # ---- MCP 服务器配置 ----
    # 格式: {"server_name": {"transport": "streamable_http", "url": "..."}}
    mcp_servers: dict[str, dict[str, Any]] = {}
    mcp_tool_timeout_seconds: float = Field(
        default=DEFAULT_MCP_TOOL_TIMEOUT_SECONDS, gt=0
    )  # 单次 MCP 工具调用超时时间

    # ---- Longbridge OpenAPI 配置 ----
    # API Key 模式为空时 SDK 会读取 LONGBRIDGE_*；OAuth ID 仅由授权服务写入。
    longbridge_auth_mode: Literal["apikey", "oauth"] = DEFAULT_LONGBRIDGE_AUTH_MODE
    longbridge_oauth_client_id: str = ""
    longbridge_app_key: str = ""
    longbridge_app_secret: str = ""
    longbridge_access_token: str = ""
    longbridge_http_url: str = ""
    longbridge_quote_ws_url: str = ""

    # ---- Web Search 配置 ----
    search_api_url: str = DEFAULT_SEARCH_API_URL
    search_api_key: str = ""  # 仅在服务端使用，不会明文返回前端

    # ---- 系统提示词 ----
    system_prompt: str = DEFAULT_SYSTEM_PROMPT

    # ---- 向量化服务商标识 ----
    embedding_provider: str = DEFAULT_EMBEDDING_PROVIDER

    # ---- 其他配置 ----
    debug: bool = False  # 调试模式
    host: str = DEFAULT_HOST  # 服务监听地址
    port: int = DEFAULT_PORT  # 服务监听端口

    # 只接收显式 init 数据；不再读取 .env、APP_* 或 config.json。
    model_config = {
        "extra": "ignore",
    }

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        return (init_settings,)

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

    @field_validator("llm_auth_mode", "embedding_auth_mode", mode="before")
    @classmethod
    def validate_llm_auth_mode(cls, value):
        normalized = str(value or "api_key").strip().lower().replace("-", "_")
        if normalized in {"codex", "chatgpt", "chatgpt_oauth", "codex_oauth", "oauth"}:
            return "codex"
        return "api_key"

    @field_validator("llm_reasoning_effort", mode="before")
    @classmethod
    def validate_llm_reasoning_effort(cls, value):
        normalized = str(value or "medium").strip().lower().replace("-", "_")
        if normalized in {"minimal", "low", "medium", "high"}:
            return normalized
        return "medium"

    @field_validator("llm_tool_choice", mode="before")
    @classmethod
    def validate_llm_tool_choice(cls, value):
        normalized = str(value or "auto").strip().lower().replace("-", "_")
        if normalized in {"auto", "none", "required"}:
            return normalized
        if normalized in {"any", "force", "forced"}:
            return "required"
        return "auto"

    @model_validator(mode="after")
    def normalize_llm_auth_pair(self):
        llm_base = (self.llm_api_base or "").rstrip("/")
        embedding_base = (self.embedding_api_base or "").rstrip("/")
        legacy_llm_codex_base = (
            self.llm_provider == "openai_responses" and llm_base == CODEX_OAUTH_API_BASE
        )
        legacy_embedding_codex_base = embedding_base == CODEX_OAUTH_API_BASE

        if legacy_llm_codex_base:
            self.llm_auth_mode = "codex"
        if self.llm_auth_mode == "codex":
            self.llm_provider = "openai_responses"
            if not self.llm_codex_api_base:
                self.llm_codex_api_base = CODEX_OAUTH_API_BASE
            if llm_base == CODEX_OAUTH_API_BASE:
                self.llm_codex_api_base = CODEX_OAUTH_API_BASE
                fallback_api_base = (
                    self.embedding_api_base
                    if embedding_base and embedding_base != CODEX_OAUTH_API_BASE
                    else "https://api.openai.com/v1"
                )
                self.llm_api_base = fallback_api_base
            if not self.llm_codex_model:
                self.llm_codex_model = (
                    self.llm_model
                    if legacy_llm_codex_base and self.llm_model
                    else CODEX_DEFAULT_MODEL
                )
            if not self.llm_model:
                self.llm_model = "gpt-4o"
        if legacy_embedding_codex_base:
            self.embedding_auth_mode = "codex"
        if self.embedding_auth_mode == "codex":
            if not self.embedding_codex_api_base:
                self.embedding_codex_api_base = CODEX_OAUTH_API_BASE
            if embedding_base == CODEX_OAUTH_API_BASE:
                self.embedding_codex_api_base = CODEX_OAUTH_API_BASE
                fallback_embedding_base = (
                    self.llm_api_base
                    if (self.llm_api_base or "").rstrip("/") != CODEX_OAUTH_API_BASE
                    else "https://api.openai.com/v1"
                )
                self.embedding_api_base = fallback_embedding_base or "https://api.openai.com/v1"
            if not self.embedding_codex_model:
                self.embedding_codex_model = (
                    self.embedding_model
                    if legacy_embedding_codex_base and self.embedding_model
                    else EMBEDDING_DEFAULT_MODEL
                )
        return self


# 全局配置单例
_config_instance: Settings | None = None


def get_settings() -> Settings:
    """获取全局配置单例（懒加载）"""
    global _config_instance
    while True:
        with _effective_config_cache_lock:
            if _config_instance is not None:
                return _config_instance
            generation = _effective_config_generation
        loaded = _load_settings()
        with _effective_config_cache_lock:
            if generation == _effective_config_generation:
                _config_instance = loaded
                return loaded


def get_effective_config(user_id: str | None = None) -> dict[str, Any]:
    """Return system config overlaid with the user's personal config.

    结果带短 TTL 缓存，避免同一请求内多次调用（chat 流程会调用 3+ 次）
    每次都查 SQLite。配置写入时通过 ``clear_effective_settings_cache`` 失效。
    """
    cache_key = (user_id,)
    while True:
        now = _time.monotonic()
        with _effective_config_cache_lock:
            generation = (_effective_config_generation, _user_config_generations.get(user_id, 0))
            cached = _effective_config_cache.get(cache_key)
            if cached is not None and cached[0] > now:
                return deepcopy(cached[1])
        result = _load_effective_config(user_id)
        with _effective_config_cache_lock:
            current = (_effective_config_generation, _user_config_generations.get(user_id, 0))
            # 数据库读取不占缓存锁；失效前开始的读取不得重新发布到新代次。
            if generation != current:
                continue
            _effective_config_cache[cache_key] = (now + _EFFECTIVE_CONFIG_TTL, deepcopy(result))
            return deepcopy(result)


def _load_effective_config(user_id: str | None) -> dict[str, Any]:
    from app.core.app_store import get_app_store

    store = get_app_store()
    store.migrate_config_json_once()
    system_config = store.get_config()
    if not user_id:
        result = system_config
    else:
        user_config = {
            key: value
            for key, value in store.get_user_config(user_id).items()
            if key in USER_CONFIG_KEYS
        }
        result = {**system_config, **user_config}
        # 个人认证方式显式覆盖时，不把系统 OAuth 账号混入个人连接；旧版个人
        # API Key 配置也继续使用原认证方式，避免管理员启用 OAuth 后悄然换账户。
        if (
            "longbridge_auth_mode" in user_config
            and "longbridge_oauth_client_id" not in user_config
        ):
            result["longbridge_oauth_client_id"] = ""
        elif "longbridge_auth_mode" not in user_config and any(
            key in user_config
            for key in ("longbridge_app_key", "longbridge_app_secret", "longbridge_access_token")
        ):
            result["longbridge_auth_mode"] = "apikey"
            result["longbridge_oauth_client_id"] = ""

    return result


def get_effective_settings(user_id: str | None = None) -> Settings:
    """Build settings for a request/user without mutating the global singleton."""
    return Settings(**get_effective_config(user_id))


# --- 有效配置 TTL 缓存 ---
# 每次 chat 请求会调用 3+ 次 get_effective_settings，每次都查 SQLite 很浪费。
# 缓存按 user_id 隔离，TTL 30s，配置写入时通过 clear_effective_settings_cache 失效。
_effective_config_cache: dict[tuple[str | None], tuple[float, dict[str, Any]]] = {}
_effective_config_generation = 0
_user_config_generations: dict[str | None, int] = {}
_effective_config_cache_lock = threading.Lock()


def clear_effective_settings_cache(user_id: str | None = None) -> None:
    """按作用域推进缓存代次；系统配置变更影响所有用户。"""
    global _effective_config_generation
    with _effective_config_cache_lock:
        if user_id is None:
            _effective_config_generation += 1
            _effective_config_cache.clear()
            _user_config_generations.clear()
        else:
            _user_config_generations[user_id] = _user_config_generations.get(user_id, 0) + 1
            _effective_config_cache.pop((user_id,), None)


def reset_settings_cache(user_id: str | None = None) -> None:
    """配置提交后刷新公共入口，个人配置不会淘汰其他用户或系统实例。"""
    global _config_instance, _effective_config_generation
    with _effective_config_cache_lock:
        if user_id is None:
            _config_instance = None
            _effective_config_generation += 1
            _effective_config_cache.clear()
            _user_config_generations.clear()
        else:
            _user_config_generations[user_id] = _user_config_generations.get(user_id, 0) + 1
            _effective_config_cache.pop((user_id,), None)


def _load_settings() -> Settings:
    """Load settings from the application SQLite config table."""
    from app.core.app_store import get_app_store

    store = get_app_store()
    store.migrate_config_json_once()
    return Settings(**store.get_config())
