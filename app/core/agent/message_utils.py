"""消息历史修复工具

修复因上下文裁剪、持久化等原因导致的 tool_use/tool_result 配对问题：
1. sanitize_claude_messages: 修复 Claude 格式消息列表（原地修改）
2. compress_turn_to_text_only: 将完整轮次压缩为纯文本（去除工具调用细节）

Anthropic API 要求：assistant 的 tool_use 后必须紧跟包含对应 tool_result 的 user 消息。
违反此规则会导致 API 报错，因此裁剪后必须修复。
"""

from __future__ import annotations

from typing import Dict, List, Set

import logging

logger = logging.getLogger("stocks-assistant.agent")

_SYNTH_TOOL_ERR = (
    "Error: Missing tool_result adjacent to tool_use (session repair). "
    "The conversation history was inconsistent; continue from here."
)


def _has_block_type(content: list, block_type: str) -> bool:
    return any(isinstance(b, dict) and b.get("type") == block_type for b in content)


def _extract_text_from_content(content) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = [b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"]
        return "\n".join(p for p in parts if p).strip()
    return ""


def _repair_tool_use_adjacency(messages: List[Dict]) -> int:
    """修复 tool_use/tool_result 的相邻关系

    Anthropic API 要求：assistant 的 tool_use 后，下一条消息必须是 user 消息
    且包含每个 tool_use id 对应的 tool_result 块。
    不满足时会插入合成的 tool_result 块来修复。
    """
    def _synth_block(tid: str) -> Dict:
        return {
            "type": "tool_result",
            "tool_use_id": tid,
            "content": _SYNTH_TOOL_ERR,
            "is_error": True,
        }

    repairs = 0
    i = 0
    while i < len(messages):
        msg = messages[i]
        if msg.get("role") != "assistant":
            i += 1
            continue

        content = msg.get("content", [])
        if not isinstance(content, list):
            i += 1
            continue

        required = [
            b.get("id")
            for b in content
            if isinstance(b, dict) and b.get("type") == "tool_use" and b.get("id")
        ]
        if not required:
            i += 1
            continue

        req_set = set(required)
        if i + 1 >= len(messages):
            messages.append({"role": "user", "content": [_synth_block(tid) for tid in required]})
            repairs += 1
            break

        nxt = messages[i + 1]
        if nxt.get("role") != "user":
            messages.insert(i + 1, {"role": "user", "content": [_synth_block(tid) for tid in required]})
            repairs += 1
            i += 2
            continue

        nc = nxt.get("content", [])
        if not isinstance(nc, list):
            messages.insert(i + 1, {"role": "user", "content": [_synth_block(tid) for tid in required]})
            repairs += 1
            i += 2
            continue

        present = {
            b.get("tool_use_id")
            for b in nc
            if isinstance(b, dict) and b.get("type") == "tool_result" and b.get("tool_use_id")
        }
        if req_set <= present:
            i += 1
            continue

        missing = [tid for tid in required if tid not in present]
        nxt["content"] = [_synth_block(tid) for tid in missing] + nc
        repairs += len(missing)
        i += 1

    return repairs


def sanitize_claude_messages(messages: List[Dict]) -> int:
    """验证并修复 Claude 格式消息列表（原地修改）

    修复项：
    1. tool_use/tool_result 相邻关系
    2. 开头的孤立 tool_result user 消息
    3. 中间不匹配的 tool_use / tool_result（反复迭代直到稳定）

    Returns:
        修复操作总数（移除 + 插入 + 补全）
    """
    if not messages:
        return 0

    removed = 0
    adj_repairs = _repair_tool_use_adjacency(messages)

    # Remove leading orphaned tool_result user messages
    while messages:
        first = messages[0]
        if first.get("role") != "user":
            break
        content = first.get("content", [])
        if isinstance(content, list) and _has_block_type(content, "tool_result") \
                and not _has_block_type(content, "text"):
            messages.pop(0)
            removed += 1
        else:
            break

    # Iteratively remove unmatched tool_use / tool_result until stable
    for _ in range(5):
        use_ids: Set[str] = set()
        result_ids: Set[str] = set()
        for msg in messages:
            for block in (msg.get("content") or []):
                if not isinstance(block, dict):
                    continue
                if block.get("type") == "tool_use" and block.get("id"):
                    use_ids.add(block["id"])
                elif block.get("type") == "tool_result" and block.get("tool_use_id"):
                    result_ids.add(block["tool_use_id"])

        bad_use = use_ids - result_ids
        bad_result = result_ids - use_ids
        if not bad_use and not bad_result:
            break

        pass_removed = 0
        i = 0
        while i < len(messages):
            msg = messages[i]
            role = msg.get("role")
            content = msg.get("content", [])
            if not isinstance(content, list):
                i += 1
                continue

            if role == "assistant" and bad_use and any(
                isinstance(b, dict) and b.get("type") == "tool_use"
                and b.get("id") in bad_use for b in content
            ):
                messages.pop(i)
                pass_removed += 1
                continue

            if role == "user" and bad_result and _has_block_type(content, "tool_result"):
                has_bad = any(
                    isinstance(b, dict) and b.get("type") == "tool_result"
                    and b.get("tool_use_id") in bad_result for b in content
                )
                if has_bad:
                    if not _has_block_type(content, "text"):
                        messages.pop(i)
                        pass_removed += 1
                        continue
                    else:
                        before = len(content)
                        msg["content"] = [
                            b for b in content
                            if not (isinstance(b, dict) and b.get("type") == "tool_result"
                                    and b.get("tool_use_id") in bad_result)
                        ]
                        pass_removed += before - len(msg["content"])
            i += 1

        removed += pass_removed
        if pass_removed == 0:
            break

    if removed:
        adj_repairs += _repair_tool_use_adjacency(messages)

    if removed:
        logger.debug(f"Message validation: removed {removed} broken message(s)")
    return removed + adj_repairs


def compress_turn_to_text_only(turn: Dict) -> Dict:
    """将完整对话轮次压缩为纯文本

    仅保留第一个用户文本和最后一个助手回复文本，
    去除所有中间的工具调用细节，大幅减少 token 消耗。
    """
    user_text = ""
    last_assistant_text = ""

    for msg in turn["messages"]:
        role = msg.get("role")
        content = msg.get("content", [])

        if role == "user":
            if isinstance(content, list) and _has_block_type(content, "tool_result"):
                continue
            if not user_text:
                user_text = _extract_text_from_content(content)
        elif role == "assistant":
            text = _extract_text_from_content(content)
            if text:
                last_assistant_text = text

    compressed_messages = []
    if user_text:
        compressed_messages.append({"role": "user", "content": [{"type": "text", "text": user_text}]})
    if last_assistant_text:
        compressed_messages.append({"role": "assistant", "content": [{"type": "text", "text": last_assistant_text}]})

    return {"messages": compressed_messages}
