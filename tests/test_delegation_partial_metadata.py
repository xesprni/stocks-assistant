"""运行中的子任务停止后，保留停止前已完成工具的公开引用。"""

import json
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from test_multi_agent import FakeAgent, FakeParentAgent, NamedTool, fake_settings

from app.core.agent import subagent
from app.core.agent.subagent import SubAgentCancelledError
from app.core.tools.delegate_agent import DelegateAgentTool


def parent(timeout=0.08):
    settings = fake_settings(
        multi_agent_max_parallel_agents=1,
        multi_agent_task_timeout_seconds=timeout,
    )
    settings.multi_agent_roles["researcher"]["tool_allowlist"] = ["web_fetch", "render_image"]
    return FakeParentAgent(
        tools=[NamedTool("web_fetch"), NamedTool("render_image")],
        settings=settings,
    )


def request():
    return {"tasks": [{"id": "facts", "role": "researcher", "task": "Collect and chart"}]}


def artifact(artifact_id="a" * 32):
    return {
        "artifact_id": artifact_id,
        "width": 2400,
        "height": 3000,
        "files": {"image": f"artifacts/renderings/{artifact_id}/image.png"},
    }


def completed(callback, tool_name, *, status="success", **data):
    callback(
        {
            "type": "tool_execution_end",
            "data": {"tool_name": tool_name, "status": status, **data},
        }
    )


def tool_for(outer, events=None):
    tool = DelegateAgentTool()
    tool.context = outer
    if events is not None:
        tool.event_emitter = lambda name, data: events.append((name, data))
    return tool


def test_timeout_keeps_completed_references_and_rejects_late_tool_events(monkeypatch):
    release = threading.Event()
    exited = threading.Event()
    events = []
    image = artifact()

    class Child(FakeAgent):
        def run_stream(self, **kwargs):
            callback = kwargs["on_event"]
            source = {"id": "source", "url": "https://example.test/report"}
            completed(
                callback,
                "web_fetch",
                sources=[source],
                evidence=[{"id": "evidence", "claim": "verified"}],
            )
            completed(
                callback,
                "render_image",
                result={**image, "html": "PRIVATE HTML", "image_blocks": ["PRIVATE BYTES"]},
            )
            source["url"] = "https://example.test/changed-after-event"
            try:
                assert release.wait(2)
                completed(
                    callback,
                    "render_image",
                    result=artifact("b" * 32),
                    sources=[{"id": "late-source"}],
                )
                return "Late final response"
            finally:
                exited.set()

    monkeypatch.setattr(subagent, "Agent", Child)
    try:
        result = tool_for(parent(), events).execute(request())
        assert result.status == "error"
        assert result.result["results"][0]["status"] == "timeout"
        assert result.ext_data["sources"] == [
            {"id": "source", "url": "https://example.test/report"}
        ]
        assert result.ext_data["evidence"] == [{"id": "evidence", "claim": "verified"}]
        assert result.ext_data["rendered_images"] == [image]
        assert result.result["results"][0]["rendered_image_ids"] == [image["artifact_id"]]
        assert "PRIVATE" not in json.dumps(result.ext_data)
        end = next(data for name, data in events if name == "subagent_end")
        assert end["status"] == "timeout"
        assert end["rendered_images"] == [image]
        event_count = len(events)
        release.set()
        assert exited.wait(1)
        assert len(events) == event_count
        assert "late-source" not in json.dumps(result.ext_data)
    finally:
        release.set()
        exited.wait(2)


def test_parent_cancellation_carries_snapshot_without_waiting_for_blocked_child(monkeypatch):
    ready = threading.Event()
    release = threading.Event()
    exited = threading.Event()
    cancel = threading.Event()
    events = []
    image = artifact()

    class Child(FakeAgent):
        def run_stream(self, **kwargs):
            completed(
                kwargs["on_event"],
                "web_fetch",
                sources=[{"id": "source"}],
                rendered_images=[image],
            )
            ready.set()
            try:
                assert release.wait(2)
                return "Late result"
            finally:
                exited.set()

    monkeypatch.setattr(subagent, "Agent", Child)
    tool = tool_for(parent(timeout=1), events)
    tool.cancel_event = cancel
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(tool.execute, request())
            assert ready.wait(1)
            cancel.set()
            with pytest.raises(SubAgentCancelledError) as caught:
                future.result(timeout=1)
            assert caught.value.batch_result["results"][0]["status"] == "cancelled"
            assert caught.value.metadata["sources"] == [{"id": "source"}]
            assert caught.value.metadata["rendered_images"] == [image]
            assert not exited.is_set()
            end = next(data for name, data in events if name == "subagent_end")
            assert end["status"] == "cancelled"
            assert end["rendered_images"] == [image]
    finally:
        release.set()
        exited.wait(2)


def test_success_merges_snapshot_without_duplicates_and_ignores_invalid_events(monkeypatch):
    image = artifact()

    class Child(FakeAgent):
        def run_stream(self, **kwargs):
            callback = kwargs["on_event"]
            completed(callback, "unauthorized", sources=[{"id": "forbidden-source"}])
            completed(callback, "web_fetch", status="error", sources=[{"id": "failed-source"}])
            completed(callback, "web_fetch", sources=[None, {"url": "missing ID"}])
            callback({"type": "message_update", "data": {"sources": [{"id": "message-source"}]}})
            for _ in range(2):
                completed(
                    callback,
                    "web_fetch",
                    sources=[{"id": "source"}],
                    evidence=[{"id": "evidence"}],
                    rendered_images=[image],
                )
            completed(callback, "render_image", result=image)
            self.last_sources = [{"id": "source"}]
            self.last_evidence = [{"id": "evidence"}]
            self.last_rendered_images = [image]
            return "Done"

    monkeypatch.setattr(subagent, "Agent", Child)
    result = tool_for(parent(timeout=1)).execute(request())
    assert result.status == "success"
    assert result.ext_data["sources"] == [{"id": "source"}]
    assert result.ext_data["evidence"] == [{"id": "evidence"}]
    assert result.ext_data["rendered_images"] == [image]
    assert result.result["metadata_counts"] == {
        "sources": {"total": 1, "included": 1},
        "evidence": {"total": 1, "included": 1},
        "rendered_images": {"total": 1, "included": 1},
    }


def test_snapshot_uses_final_budget_once_and_reports_all_original_source_counts(monkeypatch):
    release = threading.Event()
    exited = threading.Event()

    class Child(FakeAgent):
        def run_stream(self, **kwargs):
            for start in (0, 50):
                completed(
                    kwargs["on_event"],
                    "web_fetch",
                    sources=[
                        {"id": f"source-{index}", "title": "x" * 500}
                        for index in range(start, start + 50)
                    ],
                )
            try:
                assert release.wait(2)
                return "Late result"
            finally:
                exited.set()

    monkeypatch.setattr(subagent, "Agent", Child)
    try:
        result = tool_for(parent()).execute(request())
        assert result.result["results"][0]["status"] == "timeout"
        assert result.result["metadata_truncated"] is True
        counts = result.result["metadata_counts"]["sources"]
        assert counts["total"] == 100
        assert 0 < counts["included"] < 100
        assert len(result.ext_data["sources"]) == counts["included"]
        assert len(json.dumps(result.ext_data, ensure_ascii=False)) <= 16_000
    finally:
        release.set()
        exited.wait(2)
