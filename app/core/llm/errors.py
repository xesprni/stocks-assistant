"""Provider 错误分类与恢复策略；上层不根据任意错误文本销毁历史。"""

from __future__ import annotations

from enum import StrEnum
from typing import Any

import httpx


class ProviderErrorKind(StrEnum):
    CONTEXT = "context"
    MESSAGE_FORMAT = "message_format"
    AUTH = "auth"
    CONFIGURATION = "configuration"
    RATE_LIMIT = "rate_limit"
    TRANSIENT = "transient"
    UNKNOWN = "unknown"


class ProviderError(RuntimeError):
    def __init__(self, message: str, *, kind: ProviderErrorKind, code: str = "") -> None:
        super().__init__(message)
        self.kind = kind
        self.code = code


class ProviderHTTPError(httpx.HTTPStatusError):
    """保持既有 httpx.HTTPStatusError 捕获兼容，同时保留结构化上游分类。"""

    def __init__(self, message: str, *, response: httpx.Response, code: str = "") -> None:
        super().__init__(message, request=response.request, response=response)
        self.code = code
        self.kind = classify_error_detail(message, code=code, status=response.status_code)


def classify_error_detail(
    message: str, *, code: str = "", status: int | None = None
) -> ProviderErrorKind:
    text = message.lower()
    code = code.lower()
    if status in {401, 403} or code in {
        "invalid_api_key",
        "authentication_error",
        "permission_denied",
    }:
        return ProviderErrorKind.AUTH
    if code in {"model_not_found", "unsupported_model", "invalid_model"}:
        return ProviderErrorKind.CONFIGURATION
    if code in {"context_length_exceeded", "context_window_exceeded", "max_context_length"} or any(
        phrase in text
        for phrase in (
            "context length exceeded",
            "maximum context length",
            "prompt is too long",
            "context overflow",
            "exceeds model context",
            "context window exceeded",
            "tokens exceed the context",
        )
    ):
        return ProviderErrorKind.CONTEXT
    if code in {"tool_result_missing", "invalid_tool_call_id", "invalid_message_sequence"} or (
        (status == 400 or "invalid_request" in text)
        and any(
            token in text for token in ("tool_use", "tool_result", "tool_call_id", "tool calls")
        )
        and any(
            phrase in text
            for phrase in (
                "must follow",
                "must be followed",
                "without",
                "not found",
                "corresponding",
                "immediately after",
            )
        )
    ):
        return ProviderErrorKind.MESSAGE_FORMAT
    if status == 429 or code in {"rate_limit_exceeded", "rate_limit_error"} or "rate limit" in text:
        return ProviderErrorKind.RATE_LIMIT
    if status in {408, 500, 502, 503, 504} or code in {"server_error", "overloaded_error"}:
        return ProviderErrorKind.TRANSIENT
    if status is not None and 400 <= status < 500:
        return ProviderErrorKind.CONFIGURATION
    # 非 HTTP 的旧 Provider 只接受明确网络信号，不能匹配通用的 not found/too large。
    if any(
        phrase in text
        for phrase in (
            "timed out",
            "timeout",
            "connection reset",
            "connection interrupted",
            "connection error",
            "network error",
        )
    ):
        return ProviderErrorKind.TRANSIENT
    return ProviderErrorKind.UNKNOWN


def classify_provider_error(error: Exception) -> ProviderErrorKind:
    if isinstance(error, (ProviderError, ProviderHTTPError)):
        return error.kind
    if isinstance(error, (httpx.TimeoutException, httpx.NetworkError, httpx.RemoteProtocolError)):
        return ProviderErrorKind.TRANSIENT
    if isinstance(error, httpx.HTTPStatusError):
        return classify_error_detail(str(error), status=error.response.status_code)
    return classify_error_detail(str(error))


def error_from_chunk(chunk: dict[str, Any]) -> ProviderError:
    error = chunk.get("error")
    code = str(error.get("code") or "") if isinstance(error, dict) else ""
    message = (
        str(error.get("message") or "Unknown upstream error")
        if isinstance(error, dict)
        else str(error)
    )
    raw_status = chunk.get("status_code")
    status = raw_status if isinstance(raw_status, int) else None
    return ProviderError(
        message, kind=classify_error_detail(message, code=code, status=status), code=code
    )


def retry_delay(kind: ProviderErrorKind, retry_count: int) -> float | None:
    if kind == ProviderErrorKind.RATE_LIMIT:
        return float(30 + retry_count * 15)
    if kind == ProviderErrorKind.TRANSIENT:
        return float((retry_count + 1) * 2)
    return None
