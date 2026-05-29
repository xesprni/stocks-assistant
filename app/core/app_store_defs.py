"""Shared constants and helpers for the application store."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


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
    "guardian_api_key",
}

ROLE_PERMISSIONS: dict[str, list[str]] = {
    "admin": ["*"],
    "user": [
        "chat:read",
        "chat:write",
        "config:read",
        "fundamentals:read",
        "knowledge:read",
        "knowledge:write",
        "market:read",
        "market:write",
        "mcp:read",
        "mcp:write",
        "memory:read",
        "memory:write",
        "portfolio:read",
        "portfolio:write",
        "scheduler:read",
        "scheduler:write",
        "scheduler:run",
        "skills:read",
        "tools:read",
        "tracing:read",
        "watchlist:read",
        "watchlist:write",
    ],
    "readonly": [
        "chat:read",
        "config:read",
        "fundamentals:read",
        "knowledge:read",
        "market:read",
        "mcp:read",
        "memory:read",
        "portfolio:read",
        "scheduler:read",
        "skills:read",
        "tracing:read",
        "watchlist:read",
    ],
}

PERMISSION_DESCRIPTIONS: dict[str, str] = {
    "*": "All permissions",
    "chat:read": "Read own chat sessions",
    "chat:write": "Create chat messages and sessions",
    "config:read": "Read masked system configuration",
    "config:write": "Update system configuration",
    "fundamentals:read": "Read fundamentals data",
    "knowledge:read": "Read own knowledge base",
    "knowledge:write": "Write own knowledge base",
    "market:read": "Read market data and dashboard config",
    "market:write": "Update own market dashboard config",
    "mcp:read": "Read MCP server status",
    "mcp:write": "Manage MCP server config and OAuth credentials",
    "memory:read": "Read/search own memory",
    "memory:write": "Write/sync/delete own memory",
    "portfolio:read": "Read own portfolio",
    "portfolio:write": "Write own portfolio",
    "scheduler:read": "Read own scheduler tasks",
    "scheduler:write": "Write own scheduler tasks",
    "scheduler:run": "Run own scheduler tasks",
    "skills:read": "Read skills",
    "skills:write": "Manage installed skills",
    "tools:read": "Read tool list",
    "tools:execute": "Execute tools directly",
    "tracing:read": "Read own traces",
    "users:manage": "Manage users",
    "roles:manage": "Manage roles",
    "watchlist:read": "Read own watchlist",
    "watchlist:write": "Write own watchlist",
}

PAGE_PERMISSION_REQUIREMENTS: dict[str, str] = {
    "overview": "config:read",
    "tracing": "tracing:read",
    "security": "config:read",
    "watchlist": "watchlist:read",
    "portfolio": "portfolio:read",
    "news": "market:read",
    "config": "config:read",
    "chart": "market:read",
    "fundamentals": "fundamentals:read",
    "skills": "skills:read",
    "subagents": "config:write",
    "mcp": "mcp:read",
    "memory": "memory:read",
    "knowledge": "knowledge:read",
    "scheduler": "scheduler:read",
    "users": "users:manage",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def app_db_path() -> Path:
    return Path(os.environ.get(APP_DB_ENV) or DEFAULT_APP_DB).expanduser()


def json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def json_loads(value: str | None, fallback: Any = None) -> Any:
    if value is None:
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


def is_encrypted_payload(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and value.get(ENCRYPTED_MARKER) == ENCRYPTED_VERSION
        and isinstance(value.get("value"), str)
    )
