"""MCP server configuration helpers."""

from __future__ import annotations

import base64
import re
from typing import Any, Mapping
from urllib.parse import urlparse


STANDARD_HTTP_TRANSPORT = "streamable_http"
LEGACY_SSE_TRANSPORT = "sse"
STDIO_TRANSPORT = "stdio"

TRANSPORT_ALIASES = {
    "http": STANDARD_HTTP_TRANSPORT,
    "streamable-http": STANDARD_HTTP_TRANSPORT,
    "streamable_http": STANDARD_HTTP_TRANSPORT,
    "streamableHttp": STANDARD_HTTP_TRANSPORT,
    "sse": LEGACY_SSE_TRANSPORT,
    "stdio": STDIO_TRANSPORT,
}

SUPPORTED_TRANSPORTS = {
    STANDARD_HTTP_TRANSPORT,
    LEGACY_SSE_TRANSPORT,
    STDIO_TRANSPORT,
}

_SERVER_NAME_RE = re.compile(r"^[A-Za-z0-9_-]+$")


def normalize_transport(value: Any, config: Mapping[str, Any] | None = None) -> str:
    if value in (None, ""):
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
    if value in (None, ""):
        return []
    if isinstance(value, str):
        return value.split()
    if not isinstance(value, list):
        raise ValueError("stdio args must be an array of strings")
    if not all(isinstance(item, str) for item in value):
        raise ValueError("stdio args must be an array of strings")
    return value


def _validate_http_url(value: Any, transport: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{transport} transport requires a non-empty url")
    url = value.strip()
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"{transport} url must be an http(s) URL")
    return url


def normalize_mcp_server_config(name: str, config: Mapping[str, Any]) -> dict[str, Any]:
    if not isinstance(name, str) or not name:
        raise ValueError("server name must be a non-empty string")
    if not _SERVER_NAME_RE.match(name):
        raise ValueError(
            f"server name '{name}' may only contain letters, numbers, underscores, and hyphens"
        )
    if not isinstance(config, Mapping):
        raise ValueError(f"server '{name}' config must be an object")

    normalized = dict(config)
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

    auth = config.get("auth")
    if auth not in (None, ""):
        if isinstance(auth, str):
            normalized["auth"] = {"type": "bearer", "token": auth}
        elif isinstance(auth, Mapping):
            auth_type = str(auth.get("type", "bearer")).lower()
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
    if value in (None, ""):
        return {}
    if not isinstance(value, Mapping):
        raise ValueError("mcp_servers must be an object")

    return {
        name: normalize_mcp_server_config(name, config)
        for name, config in value.items()
    }


def _has_header(headers: Mapping[str, str], name: str) -> bool:
    target = name.lower()
    return any(key.lower() == target for key in headers)


def build_http_headers(config: Mapping[str, Any]) -> dict[str, str]:
    headers = _normalize_string_map(config.get("headers"), "headers")

    token = config.get("bearer_token") or config.get("access_token") or config.get("token")
    auth = config.get("auth")
    if isinstance(auth, str):
        token = auth
    elif isinstance(auth, Mapping):
        auth_type = str(auth.get("type", "bearer")).lower()
        if auth_type == "bearer":
            token = auth.get("token") or auth.get("access_token") or token
        elif auth_type == "basic":
            username = auth.get("username")
            password = auth.get("password")
            if isinstance(username, str) and isinstance(password, str):
                raw = f"{username}:{password}".encode("utf-8")
                headers.setdefault("Authorization", f"Basic {base64.b64encode(raw).decode('ascii')}")
        elif auth_type == "header":
            name = auth.get("name")
            value = auth.get("value")
            if isinstance(name, str) and isinstance(value, str):
                headers.setdefault(name, value)

    if isinstance(token, str) and token and not _has_header(headers, "Authorization"):
        headers["Authorization"] = f"Bearer {token}"

    return headers


def _mask_value(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}{'*' * 8}{value[-4:]}"


def _looks_secret(key: str) -> bool:
    lower = key.lower()
    return any(part in lower for part in ("authorization", "token", "secret", "password", "api-key", "apikey", "key"))


def mask_mcp_server_config(config: Mapping[str, Any]) -> dict[str, Any]:
    masked = dict(config)
    if isinstance(masked.get("headers"), Mapping):
        masked["headers"] = {
            key: _mask_value(value) if _looks_secret(str(key)) else value
            for key, value in masked["headers"].items()
        }
    if isinstance(masked.get("env"), Mapping):
        masked["env"] = {
            key: _mask_value(value) if _looks_secret(str(key)) else value
            for key, value in masked["env"].items()
        }
    if isinstance(masked.get("auth"), Mapping):
        masked["auth"] = {
            key: _mask_value(value) if _looks_secret(str(key)) else value
            for key, value in masked["auth"].items()
        }
    return masked
