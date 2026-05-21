"""MCP OAuth token persistence.

Tokens now live in the application SQLite database. The legacy JSON file is
still read by the app-level migration, but runtime reads/writes use SQLite.
"""

from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("stocks-assistant.mcp.token_store")


class MCPTokenStore:
    """基于 JSON 文件的 MCP OAuth 令牌持久化存储。

    The workspace_dir argument is kept for constructor compatibility; it no
    longer determines the runtime token store location.
    """

    def __init__(self, workspace_dir: str):
        self._dir = Path(workspace_dir).expanduser() / "mcp"
        self._path = self._dir / "oauth_tokens.json"
        self._lock = threading.RLock()
        self._cache: Optional[dict[str, Any]] = None

    def _load(self) -> dict[str, Any]:
        """Load all token entries from SQLite into a small process cache."""
        if self._cache is not None:
            return self._cache
        try:
            from app.core.app_store import get_app_store

            # There is no list API because MCPManager only asks for configured
            # server names. Keep an empty cache and lazily fill per server.
            self._cache = {}
            return self._cache
        except Exception as e:
            logger.warning(f"Failed to load MCP OAuth tokens: {e}")
        self._cache = {}
        return self._cache

    @staticmethod
    def _sanitize(obj: Any) -> Any:
        """递归将 Pydantic URL 等不可 JSON 序列化的对象转为字符串。"""
        if isinstance(obj, dict):
            return {k: MCPTokenStore._sanitize(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [MCPTokenStore._sanitize(v) for v in obj]
        if isinstance(obj, (str, int, float, bool)) or obj is None:
            return obj
        return str(obj)

    def _save(self, data: dict[str, Any]) -> None:
        """Persist cached entries to SQLite."""
        from app.core.app_store import get_app_store

        sanitized = self._sanitize(data)
        for server_name, entry in sanitized.items():
            if isinstance(entry, dict):
                get_app_store().set_mcp_oauth_entry(server_name, entry)
        self._cache = sanitized

    def _entry(self, server_name: str) -> dict[str, Any]:
        data = self._load()
        if server_name not in data:
            from app.core.app_store import get_app_store

            data[server_name] = get_app_store().get_mcp_oauth_entry(server_name)
        return data.get(server_name, {})

    def get_tokens(self, server_name: str) -> Optional[dict[str, Any]]:
        """获取指定服务器的 OAuth 令牌。"""
        with self._lock:
            entry = self._entry(server_name)
            tokens = entry.get("tokens")
            return tokens if tokens else None

    def set_tokens(self, server_name: str, tokens: dict[str, Any]) -> None:
        """保存指定服务器的 OAuth 令牌。"""
        with self._lock:
            data = self._load()
            entry = data.setdefault(server_name, {})
            entry["tokens"] = tokens
            self._save(data)

    def get_client_info(self, server_name: str) -> Optional[dict[str, Any]]:
        """获取指定服务器的 OAuth 客户端注册信息。"""
        with self._lock:
            entry = self._entry(server_name)
            info = entry.get("client_info")
            return info if info else None

    def set_client_info(self, server_name: str, client_info: dict[str, Any]) -> None:
        """保存指定服务器的 OAuth 客户端注册信息。"""
        with self._lock:
            data = self._load()
            entry = data.setdefault(server_name, {})
            entry["client_info"] = client_info
            self._save(data)

    def get_client_credentials_token(self, server_name: str) -> Optional[tuple[str, float]]:
        """获取指定服务器的 Client Credentials 令牌和过期时间。"""
        with self._lock:
            entry = self._entry(server_name)
            cc = entry.get("client_credentials_token")
            if cc and isinstance(cc.get("token"), str) and isinstance(cc.get("expires_at"), (int, float)):
                return (cc["token"], float(cc["expires_at"]))
            return None

    def set_client_credentials_token(self, server_name: str, token: str, expires_at: float) -> None:
        """保存指定服务器的 Client Credentials 令牌和过期时间。"""
        with self._lock:
            data = self._load()
            entry = data.setdefault(server_name, {})
            entry["client_credentials_token"] = {"token": token, "expires_at": expires_at}
            self._save(data)

    def clear(self, server_name: str) -> None:
        """清除指定服务器的所有令牌数据。"""
        with self._lock:
            data = self._load()
            data.pop(server_name, None)
            from app.core.app_store import get_app_store

            get_app_store().clear_mcp_oauth_entry(server_name)
            self._cache = data
