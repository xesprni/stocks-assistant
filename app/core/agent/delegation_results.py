"""为父 Agent 保留整批子任务状态，并限制摘要与证据的上下文开销。"""

from __future__ import annotations

import json
from copy import deepcopy
from typing import Any

from app.core.tools.result_metadata import unique_metadata_items

MAX_RESPONSE_CHARS = 18_000
MAX_TASK_RESPONSE_CHARS = 6_000
MAX_METADATA_JSON_CHARS = 16_000
# 给工具结果外层协议和统计字段留余量，避免执行器从尾部截掉整条子任务。
MAX_BATCH_JSON_CHARS = 46_000
MAX_REFERENCE_JSON_CHARS = 6_000
MAX_ERROR_JSON_CHARS = 4_000
MAX_ERROR_CHARS = 500
_GROUPS = ("evidence", "sources", "rendered_images")
_REFERENCE_KEYS = ("evidence_ids", "source_ids", "rendered_image_ids")
_TRUNCATION_MARKER = "\n[Response truncated]"


def _json_size(value: Any) -> int:
    return len(json.dumps(value, ensure_ascii=False))


def _identifier(item: dict[str, Any], group: str) -> str:
    return str(item.get("artifact_id" if group == "rendered_images" else "id") or "")


def _unique_items(results: list[dict[str, Any]], group: str) -> list[dict[str, Any]]:
    return unique_metadata_items(results, group)


def _compact_metadata(
    results: list[dict[str, Any]], budget: int = MAX_METADATA_JSON_CHARS
) -> dict[str, Any]:
    groups = {group: _unique_items(results, group) for group in _GROUPS}
    counts = {group: {"total": len(items), "included": 0} for group, items in groups.items()}
    metadata: dict[str, Any] = {
        **{group: [] for group in _GROUPS},
        "metadata_truncated": False,
        "counts": counts,
    }
    # 三类资料轮流分配预算，单个超大证据不能挡住后续的小来源或产物引用。
    for index in range(max((len(items) for items in groups.values()), default=0)):
        for group, items in groups.items():
            if index >= len(items):
                continue
            item = items[index]
            metadata[group].append(item)
            counts[group]["included"] += 1
            if _json_size(metadata) > budget:
                metadata[group].pop()
                counts[group]["included"] -= 1
                metadata["metadata_truncated"] = True
    return deepcopy(metadata)


def _compact_references(
    result: dict[str, Any], metadata: dict[str, Any], budget: int
) -> dict[str, Any]:
    references: dict[str, Any] = {key: [] for key in _REFERENCE_KEYS}
    eligible: dict[str, list[str]] = {}
    totals: dict[str, int] = {}
    for group, reference_key in zip(_GROUPS, _REFERENCE_KEYS, strict=True):
        available = {_identifier(item, group) for item in metadata[group]}
        ids = list(
            dict.fromkeys(
                _identifier(item, group)
                for item in result.get(group) or []
                if isinstance(item, dict) and _identifier(item, group)
            )
        )
        totals[reference_key] = len(ids)
        eligible[reference_key] = [item_id for item_id in ids if item_id in available]
    for index in range(max((len(ids) for ids in eligible.values()), default=0)):
        for key, ids in eligible.items():
            if index >= len(ids):
                continue
            references[key].append(ids[index])
            if _json_size(references) > budget:
                references[key].pop()
    if any(totals[key] != len(references[key]) for key in _REFERENCE_KEYS):
        # 只返回仍有元数据的 ID；引用本身也限额，并明确告知省略数量。
        references["references_truncated"] = True
        references["reference_counts"] = {
            key: {"total": totals[key], "included": len(references[key])} for key in _REFERENCE_KEYS
        }
    return references


def _shorten_response(response: str, limit: int) -> str:
    if len(response) <= limit:
        return response
    if limit < len(_TRUNCATION_MARKER):
        return response[:limit]
    return response[: limit - len(_TRUNCATION_MARKER)] + _TRUNCATION_MARKER


def _shorten_error(error: str, budget: int) -> str:
    low, high = 0, min(MAX_ERROR_CHARS, len(error))
    while low < high:
        limit = (low + high + 1) // 2
        if _json_size(error[:limit]) - 2 <= budget:
            low = limit
        else:
            high = limit - 1
    return error[:low]


def compact_batch_results(
    results: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """压缩已校验的子任务结果，按输入顺序保留状态及可用证据引用。

    调用方负责限制批次大小及任务 ID；这里不删除任何任务或更改原始结果。
    摘要共享 18000 字符且每项至多 6000，未用完的短任务配额留给长任务。
    """
    metadata = _compact_metadata(results)
    summaries: list[dict[str, Any]] = []
    responses: list[str] = []
    reference_budget = MAX_REFERENCE_JSON_CHARS // max(1, len(results))
    error_budget = MAX_ERROR_JSON_CHARS // max(
        1, sum(result.get("error") is not None for result in results)
    )
    for result in results:
        response = str(result.get("final_response") or "")
        responses.append(response)
        summary: dict[str, Any] = {
            key: result[key]
            for key in ("task_id", "role", "status", "duration_ms")
            if key in result
        }
        summary.update(
            final_response="",
            response_truncated=bool(response),
            original_response_chars=len(response),
        )
        if result.get("error") is not None:
            error = str(result["error"])
            summary["error"] = _shorten_error(error, error_budget)
            if len(error) > len(summary["error"]):
                summary["error_truncated"] = True
                summary["original_error_chars"] = len(error)
        summary.update(_compact_references(result, metadata, reference_budget))
        summaries.append(summary)

    def apply_limit(limit: int) -> bool:
        total_response_chars = 0
        for summary, response in zip(summaries, responses, strict=True):
            text = _shorten_response(response, limit)
            summary["final_response"] = text
            summary["response_truncated"] = len(response) > limit
            total_response_chars += len(text)
        return (
            total_response_chars <= MAX_RESPONSE_CHARS
            and _json_size({"results": summaries, "metadata": metadata}) <= MAX_BATCH_JSON_CHARS
        )

    if not apply_limit(0):
        # 极端长 ID 或大量失败也要保住每条状态；先让可选引用和错误预览让出空间。
        for summary, result in zip(summaries, results, strict=True):
            summary.update(_compact_references(result, metadata, 0))
            summary.pop("reference_counts", None)
            if result.get("error") is not None:
                error = str(result["error"])
                summary["error"] = _shorten_error(error, 40)
                summary["error_truncated"] = len(error) > len(summary["error"])
        for budget in (8_000, 4_000, 2_000, 512):
            if apply_limit(0):
                break
            metadata = _compact_metadata(results, budget)

    # 同时计入 JSON 转义后的大小，换行、引号等不能绕过执行器的字符上限。
    low, high = 0, MAX_TASK_RESPONSE_CHARS
    while low < high:
        limit = (low + high + 1) // 2
        if apply_limit(limit):
            low = limit
        else:
            high = limit - 1
    apply_limit(low)
    return summaries, metadata
