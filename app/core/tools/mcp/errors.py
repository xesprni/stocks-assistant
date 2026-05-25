"""MCP error formatting and redaction helpers."""

from __future__ import annotations

import json
import re
from typing import Any, Mapping, Optional

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


class MCPErrorFormatterMixin:
    """Formats MCP tool errors for Agent-visible tool results."""

    def _format_tool_error(self, exc: BaseException) -> str:
        """格式化工具调用异常，优先展开 MCP JSON-RPC error.data 中的具体错误。"""
        mcp_error = self._find_mcp_error(exc)
        if mcp_error is not None:
            formatted = self._format_mcp_error_data(getattr(mcp_error, "error", None))
            if formatted:
                return formatted

        messages = list(dict.fromkeys(self._collect_exception_messages(exc, set())))
        message = "; ".join(messages).strip() if messages else str(exc).strip()
        if not message:
            message = exc.__class__.__name__
        return self._truncate_error_text(self._redact_sensitive_text(message))

    def _find_mcp_error(self, exc: BaseException) -> Optional[BaseException]:
        """在异常链或 ExceptionGroup 中查找 MCP SDK 的 McpError。"""
        def has_mcp_error_data(error: BaseException) -> bool:
            data = getattr(error, "error", None)
            return data is not None and hasattr(data, "code") and hasattr(data, "message")

        def walk(error: BaseException, seen: set[int]) -> Optional[BaseException]:
            if id(error) in seen:
                return None
            seen.add(id(error))
            if has_mcp_error_data(error):
                return error
            if isinstance(error, BaseExceptionGroup):
                for item in error.exceptions:
                    found = walk(item, seen)
                    if found is not None:
                        return found
            for linked in (getattr(error, "__cause__", None), getattr(error, "__context__", None)):
                if linked is not None:
                    found = walk(linked, seen)
                    if found is not None:
                        return found
            return None

        return walk(exc, set())

    def _format_mcp_error_data(self, error_data: Any) -> str:
        if error_data is None:
            return ""
        code = getattr(error_data, "code", None)
        message = self._redact_sensitive_text(str(getattr(error_data, "message", "")).strip())
        details = self._format_error_detail(getattr(error_data, "data", None))

        parts = ["MCP JSON-RPC error"]
        if code is not None:
            parts.append(f"code={code}")
        formatted = " ".join(parts)
        if message:
            formatted = f"{formatted}: {message}"
        if details:
            formatted = f"{formatted}; details: {details}"
        return self._truncate_error_text(formatted)

    def _format_call_tool_error_result(self, result: Any) -> str:
        parts: list[str] = []
        if hasattr(result, "content"):
            content_items = getattr(result, "content", []) or []
            texts = [c.text for c in content_items if hasattr(c, "text")]
            if texts:
                parts.append("\n".join(texts))
            else:
                content = [getattr(c, "model_dump", lambda: str(c))() for c in content_items]
                detail = self._format_error_detail(content)
                if detail:
                    parts.append(detail)
        structured_content = getattr(result, "structuredContent", None)
        if structured_content is not None:
            structured = self._format_error_detail(structured_content)
            if structured:
                parts.append(f"structuredContent: {structured}")
        message = "; ".join(part for part in parts if part).strip()
        return self._truncate_error_text(message or "tool result marked as error without details")

    @staticmethod
    def _collect_exception_messages(error: BaseException, seen: set[int]) -> list[str]:
        if id(error) in seen:
            return []
        seen.add(id(error))
        messages: list[str] = []
        if isinstance(error, BaseExceptionGroup):
            for item in error.exceptions:
                messages.extend(MCPErrorFormatterMixin._collect_exception_messages(item, seen))
        for linked in (getattr(error, "__cause__", None), getattr(error, "__context__", None)):
            if linked is not None:
                messages.extend(MCPErrorFormatterMixin._collect_exception_messages(linked, seen))
        message = str(error).strip()
        if message:
            messages.append(message)
        return messages

    def _format_error_detail(self, value: Any) -> str:
        if value is None:
            return ""
        sanitized = self._sanitize_error_detail(value)
        if isinstance(sanitized, str):
            text = sanitized
        else:
            try:
                text = json.dumps(sanitized, ensure_ascii=False, default=str)
            except TypeError:
                text = str(sanitized)
        return self._truncate_error_text(self._redact_sensitive_text(text).strip())

    def _sanitize_error_detail(self, value: Any) -> Any:
        if hasattr(value, "model_dump"):
            value = value.model_dump()
        if isinstance(value, Mapping):
            sanitized: dict[str, Any] = {}
            for key, item in value.items():
                key_text = str(key)
                if self._is_sensitive_error_key(key_text):
                    sanitized[key_text] = "***"
                else:
                    sanitized[key_text] = self._sanitize_error_detail(item)
            return sanitized
        if isinstance(value, list):
            return [self._sanitize_error_detail(item) for item in value]
        if isinstance(value, tuple):
            return [self._sanitize_error_detail(item) for item in value]
        if isinstance(value, str):
            return self._redact_sensitive_text(value)
        return value

    @staticmethod
    def _is_sensitive_error_key(key: str) -> bool:
        lower = key.lower()
        return any(keyword in lower for keyword in _SENSITIVE_ERROR_KEYS)

    @staticmethod
    def _redact_sensitive_text(text: str) -> str:
        redacted = text
        for pattern, replacement in _SENSITIVE_TEXT_PATTERNS:
            redacted = pattern.sub(replacement, redacted)
        return redacted

    @staticmethod
    def _truncate_error_text(text: str, limit: int = 2000) -> str:
        if len(text) <= limit:
            return text
        return text[:limit] + "..."
