"""MCP 服务器配置工具函数。

提供传输类型规范化、服务器配置校验、HTTP 鉴权头构建、敏感字段脱敏等功能。
"""

from __future__ import annotations

import base64
import re
from typing import Any, Mapping
from urllib.parse import urlparse


# 标准可流式 HTTP 传输（MCP 推荐方式）
STANDARD_HTTP_TRANSPORT = "streamable_http"
# 旧式 SSE（Server-Sent Events）传输
LEGACY_SSE_TRANSPORT = "sse"
# 本地进程标准输入输出传输
STDIO_TRANSPORT = "stdio"

# 传输类型别名映射，将各种写法统一归一化
TRANSPORT_ALIASES = {
    "http": STANDARD_HTTP_TRANSPORT,
    "streamable-http": STANDARD_HTTP_TRANSPORT,
    "streamable_http": STANDARD_HTTP_TRANSPORT,
    "streamableHttp": STANDARD_HTTP_TRANSPORT,
    "sse": LEGACY_SSE_TRANSPORT,
    "stdio": STDIO_TRANSPORT,
}

# 受支持的传输类型集合
SUPPORTED_TRANSPORTS = {
    STANDARD_HTTP_TRANSPORT,
    LEGACY_SSE_TRANSPORT,
    STDIO_TRANSPORT,
}

# 服务器名称合法字符正则：仅允许字母、数字、下划线和连字符
_SERVER_NAME_RE = re.compile(r"^[A-Za-z0-9_-]+$")


def normalize_transport(value: Any, config: Mapping[str, Any] | None = None) -> str:
    """将用户配置中的传输类型字符串归一化为内部标准名称。

    - 若未指定且配置中含 command 字段，则推断为 stdio。
    - 否则默认使用 streamable_http。
    """
    if value in (None, ""):
        # 有 command 字段时自动推断为 stdio 传输
        if config and config.get("command"):
            return STDIO_TRANSPORT
        return STANDARD_HTTP_TRANSPORT

    transport = str(value)
    normalized = TRANSPORT_ALIASES.get(transport)
    if not normalized:
        raise ValueError(
            f"unsupported transport '{transport}'. Use streamable_http, sse, or stdio"
        )
    return normalized


def _normalize_string_map(value: Any, field: str) -> dict[str, str]:
    """将任意值校验并转换为字符串键值映射，用于 headers/env 等字段。"""
    if value in (None, ""):
        return {}
    if not isinstance(value, Mapping):
        raise ValueError(f"{field} must be an object")

    result: dict[str, str] = {}
    for key, item in value.items():
        if not isinstance(key, str) or not key:
            raise ValueError(f"{field} keys must be non-empty strings")
        if item is None:
            continue
        if not isinstance(item, str):
            raise ValueError(f"{field}.{key} must be a string")
        result[key] = item
    return result


def _normalize_args(value: Any) -> list[str]:
    """将 stdio 启动参数归一化为字符串列表。支持字符串（自动按空格分割）或列表形式。"""
    if value in (None, ""):
        return []
    if isinstance(value, str):
        # 字符串形式直接按空格拆分
        return value.split()
    if not isinstance(value, list):
        raise ValueError("stdio args must be an array of strings")
    if not all(isinstance(item, str) for item in value):
        raise ValueError("stdio args must be an array of strings")
    return value


def _validate_http_url(value: Any, transport: str) -> str:
    """校验 HTTP/HTTPS URL 格式，要求 scheme 为 http 或 https，且含有效主机名。"""
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{transport} transport requires a non-empty url")
    url = value.strip()
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"{transport} url must be an http(s) URL")
    return url


def normalize_mcp_server_config(name: str, config: Mapping[str, Any]) -> dict[str, Any]:
    """对单个 MCP 服务器配置进行完整校验和归一化处理。

    包括：服务器名称格式检查、传输类型识别、URL/命令/参数/环境变量校验、鉴权配置归一化。
    """
    if not isinstance(name, str) or not name:
        raise ValueError("server name must be a non-empty string")
    if not _SERVER_NAME_RE.match(name):
        raise ValueError(
            f"server name '{name}' may only contain letters, numbers, underscores, and hyphens"
        )
    if not isinstance(config, Mapping):
        raise ValueError(f"server '{name}' config must be an object")

    normalized = dict(config)
    # 归一化传输类型字段
    transport = normalize_transport(config.get("transport"), config)
    normalized["transport"] = transport

    if transport in {STANDARD_HTTP_TRANSPORT, LEGACY_SSE_TRANSPORT}:
        normalized["url"] = _validate_http_url(config.get("url"), transport)
    elif transport == STDIO_TRANSPORT:
        command = config.get("command")
        if not isinstance(command, str) or not command.strip():
            raise ValueError(f"server '{name}' stdio transport requires command")
        normalized["command"] = command.strip()
        normalized["args"] = _normalize_args(config.get("args"))
        env = _normalize_string_map(config.get("env"), "env")
        if env:
            normalized["env"] = env
        cwd = config.get("cwd")
        if cwd not in (None, "") and not isinstance(cwd, str):
            raise ValueError("stdio cwd must be a string")

    headers = _normalize_string_map(config.get("headers"), "headers")
    if headers:
        normalized["headers"] = headers
    elif "headers" in normalized:
        normalized.pop("headers")

    # 归一化鉴权配置：字符串视为 Bearer Token，对象则规范化类型名称
    auth = config.get("auth")
    if auth not in (None, ""):
        if isinstance(auth, str):
            # 简写形式：直接用字符串作为 Bearer Token
            normalized["auth"] = {"type": "bearer", "token": auth}
        elif isinstance(auth, Mapping):
            auth_type = str(auth.get("type", "bearer")).lower()
            # 将 OAuth 各种别名统一为标准名称
            if auth_type in {"oauth", "oauth2", "authorization_code", "oauth_browser"}:
                auth_type = "oauth_authorization_code"
            if auth_type == "client_credentials":
                auth_type = "oauth_client_credentials"
            if auth_type not in {"none", "bearer", "basic", "header", "oauth_client_credentials", "oauth_authorization_code"}:
                raise ValueError(
                    "auth.type must be none, bearer, basic, header, oauth_client_credentials, or oauth_authorization_code"
                )
            normalized["auth"] = dict(auth, type=auth_type)
        else:
            raise ValueError("auth must be a bearer token string or an object")

    return normalized


def normalize_mcp_servers(value: Any) -> dict[str, dict[str, Any]]:
    """对整个 mcp_servers 配置字典进行批量归一化，返回服务器名到标准配置的映射。"""
    if value in (None, ""):
        return {}
    if not isinstance(value, Mapping):
        raise ValueError("mcp_servers must be an object")

    return {
        name: normalize_mcp_server_config(name, config)
        for name, config in value.items()
    }


def _has_header(headers: Mapping[str, str], name: str) -> bool:
    """大小写不敏感地检查 headers 中是否已存在指定名称的请求头。"""
    target = name.lower()
    return any(key.lower() == target for key in headers)


def build_http_headers(config: Mapping[str, Any]) -> dict[str, str]:
    """根据服务器配置构建 HTTP 请求头字典。

    支持以下鉴权方式：
    - bearer：在 Authorization 头中附加 Bearer Token
    - basic：使用 Base64 编码的用户名:密码
    - header：将指定名称和值直接写入请求头
    """
    # 先加载用户自定义请求头
    headers = _normalize_string_map(config.get("headers"), "headers")

    # 兼容多种 Token 字段名
    token = config.get("bearer_token") or config.get("access_token") or config.get("token")
    auth = config.get("auth")
    if isinstance(auth, str):
        token = auth
    elif isinstance(auth, Mapping):
        auth_type = str(auth.get("type", "bearer")).lower()
        if auth_type == "bearer":
            token = auth.get("token") or auth.get("access_token") or token
        elif auth_type == "basic":
            # Basic 鉴权：Base64(username:password)
            username = auth.get("username")
            password = auth.get("password")
            if isinstance(username, str) and isinstance(password, str):
                raw = f"{username}:{password}".encode("utf-8")
                headers.setdefault("Authorization", f"Basic {base64.b64encode(raw).decode('ascii')}")
        elif auth_type == "header":
            # 自定义请求头鉴权
            name = auth.get("name")
            value = auth.get("value")
            if isinstance(name, str) and isinstance(value, str):
                headers.setdefault(name, value)

    # 若已有 Token 且尚未设置 Authorization 头，则附加 Bearer Token
    if isinstance(token, str) and token and not _has_header(headers, "Authorization"):
        headers["Authorization"] = f"Bearer {token}"

    return headers


def _mask_value(value: str) -> str:
    """对敏感字符串进行脱敏：短值全部替换为星号，长值保留首尾各 4 位。"""
    if not value:
        return ""
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}{'*' * 8}{value[-4:]}"


def _looks_secret(key: str) -> bool:
    """判断字段名是否可能包含敏感信息（如 token、password、key 等）。"""
    lower = key.lower()
    return any(part in lower for part in ("authorization", "token", "secret", "password", "api-key", "apikey", "key"))


def mask_mcp_server_config(config: Mapping[str, Any]) -> dict[str, Any]:
    """对 MCP 服务器配置中的敏感字段（headers、env、auth）进行脱敏，用于日志和接口响应。"""
    masked = dict(config)
    # 脱敏自定义请求头中的敏感值
    if isinstance(masked.get("headers"), Mapping):
        masked["headers"] = {
            key: _mask_value(value) if _looks_secret(str(key)) else value
            for key, value in masked["headers"].items()
        }
    # 脱敏环境变量中的敏感值
    if isinstance(masked.get("env"), Mapping):
        masked["env"] = {
            key: _mask_value(value) if _looks_secret(str(key)) else value
            for key, value in masked["env"].items()
        }
    # 脱敏鉴权配置中的敏感值
    if isinstance(masked.get("auth"), Mapping):
        masked["auth"] = {
            key: _mask_value(value) if _looks_secret(str(key)) else value
            for key, value in masked["auth"].items()
        }
    return masked
