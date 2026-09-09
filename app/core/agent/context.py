"""Context transformation helpers; no model calls or runtime dependencies."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger("stocks-assistant.agent")


def identify_complete_turns(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """识别完整对话轮次

    一个完整轮次包含：用户消息 -> AI 回复 -> 工具结果（如有）-> 后续 AI 回复。
    以用户文本消息作为轮次分界点。
    """
    turns = []
    current_turn: dict[str, Any] = {"messages": []}

    for msg in messages:
        role = msg.get("role")
        content = msg.get("content", [])

        if role == "user":
            is_user_query = False
            if isinstance(content, list):
                has_text = any(isinstance(b, dict) and b.get("type") == "text" for b in content)
                has_tool_result = any(
                    isinstance(b, dict) and b.get("type") == "tool_result" for b in content
                )
                is_user_query = has_text and not has_tool_result
            elif isinstance(content, str):
                is_user_query = True

            if is_user_query:
                if current_turn["messages"]:
                    turns.append(current_turn)
                current_turn = {"messages": [msg]}
            else:
                current_turn["messages"].append(msg)
        else:
            current_turn["messages"].append(msg)

    if current_turn["messages"]:
        turns.append(current_turn)
    return turns


def truncate_historical_tool_results(messages: list[dict[str, Any]]) -> None:
    """截断历史工具结果，减小上下文体积

    当前轮次的工具结果保留完整（最大 50K 字符），
    历史轮次的工具结果截断到 20K 字符。
    """
    MAX_HISTORY_RESULT_CHARS = 20000
    if len(messages) < 2:
        return

    current_turn_start = len(messages)
    for i in range(len(messages) - 1, -1, -1):
        msg = messages[i]
        if msg.get("role") == "user":
            content = msg.get("content", [])
            if (
                isinstance(content, list)
                and any(isinstance(b, dict) and b.get("type") == "text" for b in content)
                or isinstance(content, str)
            ):
                current_turn_start = i
                break

    truncated_count = 0
    for i in range(current_turn_start):
        msg = messages[i]
        if msg.get("role") != "user":
            continue
        content = msg.get("content", [])
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict) or block.get("type") != "tool_result":
                continue
            result_str = block.get("content", "")
            if isinstance(result_str, str) and len(result_str) > MAX_HISTORY_RESULT_CHARS:
                original_len = len(result_str)
                block["content"] = (
                    result_str[:MAX_HISTORY_RESULT_CHARS]
                    + f"\n\n[Historical output truncated: {original_len} -> {MAX_HISTORY_RESULT_CHARS} chars]"
                )
                truncated_count += 1

    if truncated_count > 0:
        logger.info("Truncated %s historical tool result(s)", truncated_count)


def aggressive_trim_for_overflow(messages: list[dict[str, Any]]) -> bool:
    """上下文溢出时的激进裁剪策略

    三步裁剪：
    1. 将所有工具结果截断到 10K 字符
    2. 将过长的用户消息截断到 10K 字符
    3. 仅保留最近 5 个完整对话轮次

    Returns:
        True 表示有内容被裁剪（值得重试），False 表示无内容可裁剪
    """
    if not messages:
        return False

    original_count = len(messages)
    AGGRESSIVE_LIMIT = 10000
    truncated = 0

    for msg in messages:
        content = msg.get("content", [])
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_result":
                result_str = block.get("content", "")
                if isinstance(result_str, str) and len(result_str) > AGGRESSIVE_LIMIT:
                    block["content"] = (
                        result_str[:AGGRESSIVE_LIMIT]
                        + f"\n\n[Truncated for context recovery: {len(result_str)} -> {AGGRESSIVE_LIMIT} chars]"
                    )
                    truncated += 1
            if block.get("type") == "tool_use" and isinstance(block.get("input"), dict):
                for key, val in block["input"].items():
                    if isinstance(val, str) and len(val) > 1000:
                        block["input"][key] = val[:1000] + f"... [truncated {len(val)} chars]"
                        truncated += 1

    USER_MSG_LIMIT = 10000
    for msg in messages:
        if msg.get("role") != "user":
            continue
        content = msg.get("content", [])
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    text = block.get("text", "")
                    if len(text) > USER_MSG_LIMIT:
                        block["text"] = (
                            text[:USER_MSG_LIMIT]
                            + f"\n\n[Message truncated: {len(text)} -> {USER_MSG_LIMIT} chars]"
                        )
                        truncated += 1
        elif isinstance(content, str) and len(content) > USER_MSG_LIMIT:
            msg["content"] = (
                content[:USER_MSG_LIMIT]
                + f"\n\n[Message truncated: {len(content)} -> {USER_MSG_LIMIT} chars]"
            )
            truncated += 1

    turns = identify_complete_turns(messages)
    if len(turns) > 5:
        kept_turns = turns[-5:]
        new_messages = []
        for turn in kept_turns:
            new_messages.extend(turn["messages"])
        messages[:] = new_messages
        logger.info("Aggressive trim: %s -> %s messages", original_count, len(messages))
        return True

    return truncated > 0


def format_turns_text(turns: list[dict[str, Any]]) -> str:
    """将对话轮次格式化为文本用于 LLM 摘要"""
    lines = []
    for turn in turns:
        for msg in turn.get("messages", []):
            role = msg.get("role", "")
            content = msg.get("content", "")
            if isinstance(content, str):
                text = content.strip()
            elif isinstance(content, list):
                parts = []
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "text":
                        parts.append(block.get("text", ""))
                text = "\n".join(p for p in parts if p).strip()
            else:
                continue
            if not text:
                continue
            label = "用户" if role == "user" else "助手"
            lines.append(f"{label}: {text[:300]}")
    return "\n".join(lines)[:12000]


def build_summary_messages(summary: str) -> list[dict[str, Any]]:
    """将摘要文本构建为紧凑的消息对插入对话历史"""
    return [
        {
            "role": "user",
            "content": [{"type": "text", "text": f"[之前的对话摘要]\n{summary}"}],
        },
        {
            "role": "assistant",
            "content": [{"type": "text", "text": "好的，我已了解之前的对话内容，让我们继续。"}],
        },
    ]
