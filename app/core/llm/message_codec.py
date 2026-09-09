"""Small shared decoders for the two provider protocols."""

from __future__ import annotations

import json
from collections.abc import Iterable, Iterator
from typing import Any


def iter_sse_objects(lines: Iterable[str]) -> Iterator[dict[str, Any]]:
    """Decode data events, ignoring keepalives and malformed upstream lines."""
    for line in lines:
        if not line.startswith("data: "):
            continue
        data = line[6:]
        if data.strip() == "[DONE]":
            break
        try:
            event = json.loads(data)
        except json.JSONDecodeError:
            continue
        if isinstance(event, dict):
            yield event


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
