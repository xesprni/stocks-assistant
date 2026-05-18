"""全局配置模块

基于 pydantic-settings 实现配置管理，支持以下配置来源（优先级从高到低）：
1. 环境变量（前缀 APP_，如 APP_LLM_API_KEY）
2. .env 文件
3. config.json 文件
4. 默认值
"""

from pathlib import Path
from typing import Any, Dict, Optional, Tuple, Type

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, JsonConfigSettingsSource, PydanticBaseSettingsSource


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


class Settings(BaseSettings):
    """应用全局配置

    所有配置项均可通过环境变量覆盖，环境变量前缀为 APP_。
    例如 llm_api_key 对应环境变量 APP_LLM_API_KEY。
    """

    # ---- LLM 大模型配置 ----
    llm_api_key: str = ""  # API 密钥
    llm_api_base: str = "https://api.openai.com/v1"  # API 地址（兼容 OpenAI 接口）
    llm_model: str = "gpt-4o"  # 模型名称

    # ---- Embedding 向量化配置 ----
    embedding_api_key: str = ""  # 向量化 API 密钥（为空时使用 llm_api_key）
    embedding_api_base: str = "https://api.openai.com/v1"
    embedding_model: str = "text-embedding-3-small"  # 向量化模型

    # ---- 工作空间 ----
    workspace_dir: str = "~/stocks-assistant"  # 工作空间根目录

    # ---- Agent 智能体配置 ----
    agent_max_steps: int = 20  # 单次对话最大工具调用轮数
    agent_max_context_tokens: int = 50000  # 上下文窗口最大 token 数
    agent_max_context_turns: int = 20  # 上下文最大对话轮数

    # ---- 功能开关 ----
    knowledge_enabled: bool = True  # 是否启用知识库
    memory_enabled: bool = True  # 是否启用长期记忆
    scheduler_enabled: bool = True  # 是否启用定时任务
    tracing_enabled: bool = False  # 是否启用 Agent 调用追踪

    # ---- MCP 服务器配置 ----
    # 格式: {"server_name": {"transport": "streamable_http", "url": "..."}}
    mcp_servers: Dict[str, Dict[str, Any]] = {}

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

    # pydantic-settings 配置：环境变量前缀 + .env + config.json 文件支持
    model_config = {
        "env_prefix": "APP_",
        "env_file": ".env",
        "json_file": "config.json",
        "json_file_encoding": "utf-8",
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
            env_settings,
            dotenv_settings,
            JsonConfigSettingsSource(settings_cls),
            file_secret_settings,
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


# 全局配置单例
_config_instance: Optional[Settings] = None


def get_settings() -> Settings:
    """获取全局配置单例（懒加载）"""
    global _config_instance
    if _config_instance is None:
        _config_instance = _load_settings()
    return _config_instance


def _load_settings() -> Settings:
    """从 config.json 加载配置，环境变量和 .env 优先级更高"""
    return Settings()
