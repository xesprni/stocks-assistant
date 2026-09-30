"""security 领域常量的唯一定义。"""

from enum import StrEnum


class Permission(StrEnum):
    CHAT_READ = "chat:read"
    CHAT_WRITE = "chat:write"
    CONFIG_READ = "config:read"
    CONFIG_WRITE = "config:write"
    FUNDAMENTALS_READ = "fundamentals:read"
    KNOWLEDGE_READ = "knowledge:read"
    KNOWLEDGE_WRITE = "knowledge:write"
    MARKET_READ = "market:read"
    MARKET_WRITE = "market:write"
    MCP_READ = "mcp:read"
    MCP_WRITE = "mcp:write"
    MEMORY_READ = "memory:read"
    MEMORY_WRITE = "memory:write"
    PORTFOLIO_READ = "portfolio:read"
    PORTFOLIO_WRITE = "portfolio:write"
    ROLES_MANAGE = "roles:manage"
    SCHEDULER_RUN = "scheduler:run"
    SCHEDULER_READ = "scheduler:read"
    SCHEDULER_WRITE = "scheduler:write"
    SKILLS_READ = "skills:read"
    SKILLS_WRITE = "skills:write"
    TOOLS_EXECUTE = "tools:execute"
    TOOLS_READ = "tools:read"
    TRACING_READ = "tracing:read"
    USERS_MANAGE = "users:manage"
    WATCHLIST_READ = "watchlist:read"
    WATCHLIST_WRITE = "watchlist:write"


APP_DB_ENV = "STOCKS_ASSISTANT_DB_PATH"

DEFAULT_APP_DB = "~/stocks-assistant/stocks-assistant.db"

JWT_SECRET_KEY = "jwt_secret"

CONFIG_ENCRYPTION_KEY = "config_encryption_key"

ENCRYPTED_MARKER = "__stocks_assistant_encrypted__"

ENCRYPTED_VERSION = "fernet-v1"

LOGIN_DEVICE_ONLINE_SECONDS = 120

SENSITIVE_CONFIG_KEYS = {
    "llm_api_key",
    "embedding_api_key",
    "telegram_bot_token",
    "longbridge_app_key",
    "longbridge_app_secret",
    "longbridge_access_token",
}

ROLE_PERMISSIONS: dict[str, list[str]] = {
    "admin": ["*"],
    "user": [
        Permission.CHAT_READ,
        Permission.CHAT_WRITE,
        Permission.CONFIG_READ,
        Permission.FUNDAMENTALS_READ,
        Permission.KNOWLEDGE_READ,
        Permission.KNOWLEDGE_WRITE,
        Permission.MARKET_READ,
        Permission.MARKET_WRITE,
        Permission.MCP_READ,
        Permission.MCP_WRITE,
        Permission.MEMORY_READ,
        Permission.MEMORY_WRITE,
        Permission.PORTFOLIO_READ,
        Permission.PORTFOLIO_WRITE,
        Permission.SCHEDULER_READ,
        Permission.SCHEDULER_WRITE,
        Permission.SCHEDULER_RUN,
        Permission.SKILLS_READ,
        Permission.TOOLS_READ,
        Permission.TRACING_READ,
        Permission.WATCHLIST_READ,
        Permission.WATCHLIST_WRITE,
    ],
    "readonly": [
        Permission.CHAT_READ,
        Permission.CONFIG_READ,
        Permission.FUNDAMENTALS_READ,
        Permission.KNOWLEDGE_READ,
        Permission.MARKET_READ,
        Permission.MCP_READ,
        Permission.MEMORY_READ,
        Permission.PORTFOLIO_READ,
        Permission.SCHEDULER_READ,
        Permission.SKILLS_READ,
        Permission.TRACING_READ,
        Permission.WATCHLIST_READ,
    ],
}

PERMISSION_DESCRIPTIONS: dict[str, str] = {
    "*": "All permissions",
    Permission.CHAT_READ: "Read own chat sessions",
    Permission.CHAT_WRITE: "Create chat messages and sessions",
    Permission.CONFIG_READ: "Read masked system configuration",
    Permission.CONFIG_WRITE: "Update system configuration",
    Permission.FUNDAMENTALS_READ: "Read fundamentals data",
    Permission.KNOWLEDGE_READ: "Read own knowledge base",
    Permission.KNOWLEDGE_WRITE: "Write own knowledge base",
    Permission.MARKET_READ: "Read market data and dashboard config",
    Permission.MARKET_WRITE: "Update own market dashboard config",
    Permission.MCP_READ: "Read MCP server status",
    Permission.MCP_WRITE: "Manage MCP server config and OAuth credentials",
    Permission.MEMORY_READ: "Read/search own memory",
    Permission.MEMORY_WRITE: "Write/sync/delete own memory",
    Permission.PORTFOLIO_READ: "Read own portfolio",
    Permission.PORTFOLIO_WRITE: "Write own portfolio",
    Permission.SCHEDULER_READ: "Read own scheduler tasks",
    Permission.SCHEDULER_WRITE: "Write own scheduler tasks",
    Permission.SCHEDULER_RUN: "Run own scheduler tasks",
    Permission.SKILLS_READ: "Read skills",
    Permission.SKILLS_WRITE: "Manage installed skills",
    Permission.TOOLS_READ: "Read tool list",
    Permission.TOOLS_EXECUTE: "Execute tools directly",
    Permission.TRACING_READ: "Read own traces",
    Permission.USERS_MANAGE: "Manage users",
    Permission.ROLES_MANAGE: "Manage roles",
    Permission.WATCHLIST_READ: "Read own watchlist",
    Permission.WATCHLIST_WRITE: "Write own watchlist",
}

PAGE_PERMISSION_REQUIREMENTS: dict[str, str] = {
    "overview": Permission.CONFIG_READ,
    "tracing": Permission.TRACING_READ,
    "security": Permission.CONFIG_READ,
    "watchlist": Permission.WATCHLIST_READ,
    "portfolio": Permission.PORTFOLIO_READ,
    "news": Permission.MARKET_READ,
    "config": Permission.CONFIG_READ,
    "chart": Permission.MARKET_READ,
    "fundamentals": Permission.FUNDAMENTALS_READ,
    "skills": Permission.SKILLS_READ,
    "subagents": Permission.CONFIG_WRITE,
    "mcp": Permission.MCP_READ,
    "memory": Permission.MEMORY_READ,
    "knowledge": Permission.KNOWLEDGE_READ,
    "scheduler": Permission.SCHEDULER_READ,
    "users": Permission.USERS_MANAGE,
}

ACCESS_TOKEN_MINUTES = 15

REFRESH_TOKEN_DAYS = 7

LOGIN_SESSION_DAYS = 30

JWT_ALGORITHM = "HS256"

DEVICE_ID_HEADER = "x-device-id"

DEV_AUTH_ENV = "STOCKS_ASSISTANT_DEV_AUTH"

DEV_AUTH_USERNAME_ENV = "STOCKS_ASSISTANT_DEV_AUTH_USERNAME"

DEV_AUTH_DISPLAY_NAME_ENV = "STOCKS_ASSISTANT_DEV_AUTH_DISPLAY_NAME"

AVATAR_DATA_URL_PREFIXES = (
    "data:image/png;base64,",
    "data:image/jpeg;base64,",
    "data:image/webp;base64,",
    "data:image/gif;base64,",
)

MAX_AVATAR_BYTES = 512 * 1024


PUBLIC_API_PATHS = {
    "/api/v1/health",
    "/api/v1/auth/setup/status",
    "/api/v1/auth/setup",
    "/api/v1/auth/login",
    "/api/v1/auth/dev-login",
    "/api/v1/auth/refresh",
    "/api/v1/auth/logout",
}


MIN_USERNAME_LENGTH = 3
MAX_USERNAME_LENGTH = 64
MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_LENGTH = 256
MAX_DISPLAY_NAME_LENGTH = 120
MAX_DEVICE_ID_LENGTH = 128
MAX_AVATAR_BASE64_LENGTH = 800000
DEFAULT_EXPIRES_IN = 900
MIN_NAME_LENGTH = 2
MAX_NAME_LENGTH = 64
MAX_DESCRIPTION_LENGTH = 240
MAX_PERMISSION_LENGTH = 120
