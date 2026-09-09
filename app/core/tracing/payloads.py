"""Trace payload redaction, serialization and compact presentation helpers."""

from __future__ import annotations

import json
import uuid
from copy import deepcopy
from datetime import datetime
from typing import Any

# 追踪会保存完整请求/响应片段，入库前统一截断大字段并脱敏常见凭据字段。
MAX_TRACE_STRING_CHARS = 50_000
MAX_RESPONSE_PREVIEW_CHARS = 1_000
_TRUNCATION_MARKER = "\n\n[Trace payload truncated: {original} chars total]"
_SECRET_KEYS = ("api_key", "authorization", "password", "secret", "token")
_TOOL_CALL_NODE_TYPES = {"tool_call", "subagent_tool_call"}
_TOOL_RESULT_NODE_TYPES = {"tool_result", "subagent_tool_result"}


def _new_id() -> str:
    return str(uuid.uuid4())


def _now() -> str:
    return datetime.now().isoformat(timespec="milliseconds")


def _iso_from_timestamp(value: float | None) -> str:
    if value is None:
        return _now()
    return datetime.fromtimestamp(value).isoformat(timespec="milliseconds")


def _duration_ms(started_at: float | None, ended_at: float | None) -> float | None:
    if started_at is None or ended_at is None:
        return None
    return max(0.0, (ended_at - started_at) * 1000)


def _decode_json(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


def _drop_payload_keys(value: dict[str, Any], keys: set[str]) -> dict[str, Any]:
    normalized = deepcopy(value)
    for key in keys:
        normalized.pop(key, None)
    child_data = normalized.get("child_data")
    if isinstance(child_data, dict):
        for key in keys:
            child_data.pop(key, None)
    return normalized


def _normalize_payload_for_response(node_type: str, payload: Any) -> Any:
    if not isinstance(payload, dict):
        return payload
    if node_type in _TOOL_CALL_NODE_TYPES:
        return _drop_payload_keys(payload, {"result"})
    if node_type in _TOOL_RESULT_NODE_TYPES:
        return _drop_payload_keys(payload, {"arguments"})
    return payload


def _clean_text(value: str) -> str:
    if len(value) <= MAX_TRACE_STRING_CHARS:
        return value
    return value[:MAX_TRACE_STRING_CHARS] + _TRUNCATION_MARKER.format(original=len(value))


def _sanitize_payload(value: Any, key: str = "") -> Any:
    key_lower = key.lower()
    if key_lower and any(secret in key_lower for secret in _SECRET_KEYS):
        return "[redacted]"

    if isinstance(value, str):
        return _clean_text(value)
    if isinstance(value, list):
        return [_sanitize_payload(item) for item in value]
    if isinstance(value, dict):
        # reasoning/thinking 内容可能很长且不适合持久化，只保留节点存在性的标记。
        if value.get("type") == "thinking":
            return {"type": "thinking", "omitted": True}
        return {str(k): _sanitize_payload(v, str(k)) for k, v in value.items()}
    return value


def _json_dumps(value: Any) -> str:
    return json.dumps(_sanitize_payload(value), ensure_ascii=False, separators=(",", ":"))


def _preview(text: str | None) -> str:
    if not text:
        return ""
    compact = " ".join(text.strip().split())
    if len(compact) <= MAX_RESPONSE_PREVIEW_CHARS:
        return compact
    return compact[:MAX_RESPONSE_PREVIEW_CHARS] + f"... [{len(compact)} chars total]"
