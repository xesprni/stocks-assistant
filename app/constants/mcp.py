"""mcp 领域常量的唯一定义。"""

import re

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


_SENSITIVE_ERROR_KEYS = (
    "authorization",
    "cookie",
    "set-cookie",
    "token",
    "access_token",
    "refresh_token",
    "secret",
    "password",
    "api_key",
    "apikey",
    "x-api-key",
)

_SENSITIVE_TEXT_PATTERNS = (
    (re.compile(r"(?i)(authorization\s*[:=]\s*bearer\s+)[^\s,;]+"), r"\1***"),
    (re.compile(r"(?i)((?:access|refresh)[_-]?token\s*[:=]\s*)[^\s,;]+"), r"\1***"),
    (re.compile(r"(?i)((?:api[_-]?key|x-api-key|secret|password)\s*[:=]\s*)[^\s,;]+"), r"\1***"),
)


MAX_MCP_ERROR_CHARS = 2000
