"""Accumulate provider chunks without performing I/O or mutating chat history."""

from __future__ import annotations

import json
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4


@dataclass
class StreamState:
    content: str = ""
    reasoning: str = ""
    stop_reason: str | None = None
    tool_calls: dict[int, dict[str, str]] = field(default_factory=dict)

    def consume(self, chunk: dict[str, Any]) -> Iterator[tuple[str, dict[str, str]]]:
        """Merge one chunk and return public/internal deltas in their original order."""
        choices = chunk.get("choices")
        if not choices:
            return
        choice = choices[0]
        delta = choice.get("delta", {})
        if choice.get("finish_reason"):
            self.stop_reason = choice["finish_reason"]
        reasoning = delta.get("reasoning_content") or ""
        if reasoning:
            self.reasoning += reasoning
            yield "reasoning_update", {"delta": reasoning}
        content = delta.get("content") or ""
        if content:
            self.content += content
            yield "message_update", {"delta": content}
        # 工具参数可能跨 chunk 且交错到达，必须按 index 累积，再按原调用顺序输出。
        for item in delta.get("tool_calls") or []:
            buffer = self.tool_calls.setdefault(
                item.get("index", 0), {"id": "", "name": "", "arguments": ""}
            )
            if item.get("id"):
                buffer["id"] = item["id"]
            if "function" in item:
                function = item["function"]
                if function.get("name"):
                    buffer["name"] = function["name"]
                if function.get("arguments"):
                    buffer["arguments"] += function["arguments"]

    def parsed_tool_calls(self) -> list[dict[str, Any]]:
        result = []
        for index in sorted(self.tool_calls):
            call = self.tool_calls[index]
            tool_id = call.get("id") or f"call_{uuid4().hex[:24]}"
            arguments_text = call.get("arguments") or ""
            try:
                arguments = json.loads(arguments_text) if arguments_text else {}
            except json.JSONDecodeError:
                result.append(
                    {
                        "id": tool_id,
                        "name": call["name"],
                        "arguments": {},
                        "_parse_error": f"Invalid JSON in tool arguments: {arguments_text[:200]}...",
                    }
                )
            else:
                result.append({"id": tool_id, "name": call["name"], "arguments": arguments})
        return result
