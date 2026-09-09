"""委派结果预算与证据回传协议，不依赖模型或外部服务。"""

import json
from copy import deepcopy

from app.core.agent.delegation_results import (
    MAX_BATCH_JSON_CHARS,
    MAX_METADATA_JSON_CHARS,
    MAX_RESPONSE_CHARS,
    MAX_TASK_RESPONSE_CHARS,
    compact_batch_results,
)


def child_result(task_id, response="done", **extra):
    return {
        "task_id": task_id,
        "role": "researcher",
        "status": "success",
        "duration_ms": 10,
        "final_response": response,
        **extra,
    }


def json_size(value):
    return len(json.dumps(value, ensure_ascii=False))


def test_large_batch_keeps_every_task_status_and_fair_response_budget():
    results = [
        child_result(
            f"task-{index}",
            f"任务 {index} 的完整研究内容。" * 10_000,
            status="skipped" if index == 31 else "success",
            error="Dependency failed" if index == 31 else None,
        )
        for index in range(32)
    ]

    summaries, metadata = compact_batch_results(results)

    assert len(summaries) == 32
    assert [item["task_id"] for item in summaries] == [item["task_id"] for item in results]
    assert [item["status"] for item in summaries] == [item["status"] for item in results]
    assert summaries[-1]["error"] == "Dependency failed"
    assert sum(len(item["final_response"]) for item in summaries) <= MAX_RESPONSE_CHARS
    assert all(0 < len(item["final_response"]) <= MAX_TASK_RESPONSE_CHARS for item in summaries)
    assert all(item["response_truncated"] for item in summaries)
    assert all("[Response truncated]" in item["final_response"] for item in summaries)
    assert [item["original_response_chars"] for item in summaries] == [
        len(item["final_response"]) for item in results
    ]
    assert json_size({"results": summaries, "metadata": metadata}) <= MAX_BATCH_JSON_CHARS


def test_short_responses_release_budget_and_inputs_remain_unchanged():
    results = [child_result("short", "small"), child_result("long", "长" * 10_000)]
    original = deepcopy(results)

    summaries, metadata = compact_batch_results(results)

    assert summaries[0]["final_response"] == "small"
    assert summaries[0]["response_truncated"] is False
    assert len(summaries[1]["final_response"]) == MAX_TASK_RESPONSE_CHARS
    assert metadata["metadata_truncated"] is False
    assert results == original


def test_metadata_deduplication_and_rendered_image_reference_whitelist():
    results = [
        child_result(
            "first",
            evidence=[{"id": "e1", "claim": "original"}, {"id": "e1", "claim": "duplicate"}],
            sources=[{"id": "s1", "url": "https://example.test/source"}],
            rendered_images=[
                {
                    "artifact_id": "image1",
                    "width": 2400,
                    "height": 3000,
                    "files": {"png": "renders/image1.png"},
                    "html": "private document",
                    "image_blocks": [{"data": "private bytes"}],
                    "snapshot": {"private": "data"},
                }
            ],
        ),
        child_result(
            "second",
            evidence=[{"id": "e1", "claim": "later duplicate"}],
            sources=[{"id": "s1", "url": "https://example.test/later"}],
            rendered_images=[{"artifact_id": "image1", "width": 100}],
        ),
    ]
    original = deepcopy(results)

    summaries, metadata = compact_batch_results(results)

    assert metadata["evidence"] == [{"id": "e1", "claim": "original"}]
    assert metadata["sources"] == [{"id": "s1", "url": "https://example.test/source"}]
    assert metadata["rendered_images"] == [
        {
            "artifact_id": "image1",
            "width": 2400,
            "height": 3000,
            "files": {"png": "renders/image1.png"},
        }
    ]
    assert metadata["counts"]["evidence"] == {"total": 1, "included": 1}
    for summary in summaries:
        assert summary["evidence_ids"] == ["e1"]
        assert summary["source_ids"] == ["s1"]
        assert summary["rendered_image_ids"] == ["image1"]
        assert "evidence" not in summary
        assert "sources" not in summary
        assert "rendered_images" not in summary
    assert results == original
    metadata["evidence"][0]["claim"] = "consumer change"
    assert results == original


def test_oversized_metadata_is_explicit_and_does_not_block_later_small_items():
    results = [
        child_result(
            "research",
            evidence=[{"id": "huge", "claim": "x" * 20_000}, {"id": "small", "claim": "ok"}],
            sources=[{"id": "source", "url": "https://example.test/source"}],
            rendered_images=[{"artifact_id": "image", "width": 2400}],
        )
    ]

    summaries, metadata = compact_batch_results(results)

    assert json_size(metadata) <= MAX_METADATA_JSON_CHARS
    assert metadata["metadata_truncated"] is True
    assert metadata["counts"]["evidence"] == {"total": 2, "included": 1}
    assert metadata["evidence"] == [{"id": "small", "claim": "ok"}]
    assert metadata["sources"][0]["id"] == "source"
    assert metadata["rendered_images"][0]["artifact_id"] == "image"
    assert summaries[0]["evidence_ids"] == ["small"]
    assert summaries[0]["references_truncated"] is True
    assert summaries[0]["reference_counts"]["evidence_ids"] == {"total": 2, "included": 1}


def test_json_escaping_repeated_references_and_errors_cannot_hide_tail_tasks():
    sources = [
        {"id": f"source-{index:03d}", "url": f"https://example.test/{index}", "title": "t" * 250}
        for index in range(100)
    ]
    results = [
        child_result(
            f"task-{index:02d}",
            '\x00\n\\"' * 10_000,
            sources=sources,
            error="x" * 10_000,
            status="error" if index == 31 else "success",
        )
        for index in range(32)
    ]

    summaries, metadata = compact_batch_results(results)

    assert len(summaries) == 32
    assert summaries[-1]["task_id"] == "task-31"
    assert summaries[-1]["status"] == "error"
    assert all(item["error_truncated"] for item in summaries)
    assert all(item["original_error_chars"] == 10_000 for item in summaries)
    assert all(item["references_truncated"] for item in summaries)
    assert metadata["metadata_truncated"] is True
    assert json_size(metadata) <= MAX_METADATA_JSON_CHARS
    assert json_size({"results": summaries, "metadata": metadata}) <= MAX_BATCH_JSON_CHARS
    available_ids = {item["id"] for item in metadata["sources"]}
    assert all(set(item["source_ids"]) <= available_ids for item in summaries)


def test_empty_batch_metadata_is_well_formed():
    summaries, metadata = compact_batch_results([])
    assert summaries == []
    assert metadata["evidence"] == metadata["sources"] == metadata["rendered_images"] == []
    assert metadata["metadata_truncated"] is False
    assert all(count == {"total": 0, "included": 0} for count in metadata["counts"].values())


def test_escaped_identifiers_keep_identity_when_optional_metadata_must_shrink():
    results = [
        child_result(
            "\x00" * 78 + f"{index:02d}",
            "response" * 1000,
            role="\x00" * 100,
            error="\x00" * 1000,
            sources=[{"id": "source", "content": "long" * 3000}],
        )
        for index in range(32)
    ]

    summaries, metadata = compact_batch_results(results)

    assert [(item["task_id"], item["role"], item["status"]) for item in summaries] == [
        (item["task_id"], item["role"], item["status"]) for item in results
    ]
    assert json_size({"results": summaries, "metadata": metadata}) <= MAX_BATCH_JSON_CHARS
    assert metadata["metadata_truncated"] is True
    assert metadata["counts"]["sources"] == {"total": 1, "included": 0}
    assert all(item["references_truncated"] for item in summaries)
