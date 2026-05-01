"""MCP OAuth 令牌持久化存储。

将 OAuth 授权令牌和客户端注册信息保存到 JSON 文件，
避免每次重启应用都需要重新登录。
"""

from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("stocks-assistant.mcp.token_store")


class MCPTokenStore:
    """基于 JSON 文件的 MCP OAuth 令牌持久化存储。

    文件路径: {workspace_dir}/mcp/oauth_tokens.json
    线程安全，通过可重入锁保护读写操作。
    """

    def __init__(self, workspace_dir: str):
        self._dir = Path(workspace_dir).expanduser() / "mcp"
        self._path = self._dir / "oauth_tokens.json"
        self._lock = threading.RLock()
        self._cache: Optional[dict[str, Any]] = None

    def _load(self) -> dict[str, Any]:
        """从磁盘加载令牌数据，带内存缓存。"""
        if self._cache is not None:
            return self._cache
        try:
            if self._path.exists():
                with open(self._path, "r", encoding="utf-8") as f:
                    self._cache = json.load(f)
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
        """将令牌数据写入磁盘。"""
        self._dir.mkdir(parents=True, exist_ok=True)
        sanitized = self._sanitize(data)
        with open(self._path, "w", encoding="utf-8") as f:
            json.dump(sanitized, f, indent=2, ensure_ascii=False)
        self._cache = data

    def get_tokens(self, server_name: str) -> Optional[dict[str, Any]]:
        """获取指定服务器的 OAuth 令牌。"""
        with self._lock:
            data = self._load()
            entry = data.get(server_name, {})
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
            data = self._load()
            entry = data.get(server_name, {})
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
            data = self._load()
            entry = data.get(server_name, {})
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
            self._save(data)
