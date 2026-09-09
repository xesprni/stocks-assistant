"""Small shared decoders for the two provider protocols."""

from __future__ import annotations

import json
from collections.abc import Iterable, Iterator
from typing import Any

import httpx


def iter_sse_objects(
    lines: Iterable[str], *, require_complete: bool = False
) -> Iterator[dict[str, Any]]:
    """Decode data events, ignoring keepalives and malformed upstream lines."""
    complete = False
    for line in lines:
        if not line.startswith("data: "):
            continue
        data = line[6:]
        if data.strip() == "[DONE]":
            return
        try:
            event = json.loads(data)
        except json.JSONDecodeError:
            continue
        if isinstance(event, dict):
            choices = event.get("choices") or []
            if (
                event.get("type")
                in {"response.completed", "response.failed", "response.incomplete", "error"}
                or event.get("error")
                or any(
                    isinstance(choice, dict) and choice.get("finish_reason") for choice in choices
                )
            ):
                complete = True
            yield event
    # HTTP 200 后仍可能正常 EOF；缺少协议结束标记时不能提交残缺文本或执行工具。
    if require_complete and not complete:
        raise httpx.RemoteProtocolError("LLM stream connection ended before completion")


def split_message_blocks(
    content: list[Any],
) -> tuple[list[str], list[dict[str, Any]], list[dict[str, Any]]]:
    """Keep text/tool blocks in order and omit provider-private thinking blocks."""
    texts: list[str] = []
    calls: list[dict[str, Any]] = []
    results: list[dict[str, Any]] = []
    for block in content:
        if not isinstance(block, dict):
            continue
        match block.get("type"):
            case "text":
                texts.append(block.get("text", ""))
            case "tool_use":
                calls.append(block)
            case "tool_result":
                results.append(block)
    return texts, calls, results


def image_data_urls(content: list[Any]) -> list[str]:
    """将内部图片块转换为原生视觉输入，禁止把无效附件静默当作已查看。"""
    urls = []
    for block in content:
        if not isinstance(block, dict) or block.get("type") != "image":
            continue
        source = block.get("source")
        if (
            not isinstance(source, dict)
            or source.get("type") != "base64"
            or source.get("media_type") not in {"image/png", "image/jpeg"}
            or not isinstance(source.get("data"), str)
            or not source["data"]
        ):
            raise ValueError("Invalid image attachment: expected base64 PNG or JPEG")
        urls.append(f"data:{source['media_type']};base64,{source['data']}")
    return urls
