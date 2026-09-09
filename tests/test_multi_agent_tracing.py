"""排队、依赖失败和迟到终止事件的持久化追踪。"""

import pytest

from app.core.session import ChatSessionStore
from app.core.tracing import TraceRecorder, TraceStore


def trace_for(tmp_path):
    session = ChatSessionStore(str(tmp_path)).create_session(title="queued agents")
    store = TraceStore(str(tmp_path))
    recorder = TraceRecorder.start(store, session["id"], "research")
    return recorder, store, session["id"]


def emit(recorder, event_type, timestamp, **data):
    recorder.handle_event({"type": event_type, "timestamp": timestamp, "data": data})


def events_for(recorder, store, session_id):
    recorder._executor.submit(lambda: None).result()
    return store.get_session_traces(session_id)["runs"][0]["events"]


def test_queued_task_becomes_running_and_reuses_the_same_trace_node(tmp_path):
    recorder, store, session_id = trace_for(tmp_path)
    emit(recorder, "subagent_batch_start", 1000, batch_id="batch", task_count=1)
    emit(
        recorder,
        "subagent_queued",
        1001,
        batch_id="batch",
        task_id="one",
        role="researcher",
        task="Gather evidence",
        depends_on=["upstream"],
    )
    nodes = events_for(recorder, store, session_id)
    queued = next(node for node in nodes if node["node_type"] == "subagent")
    assert queued["status"] == "queued"
    assert queued["payload"]["depends_on"] == ["upstream"]

    emit(recorder, "subagent_start", 1003, batch_id="batch", task_id="one", role="researcher")
    running_nodes = events_for(recorder, store, session_id)
    running = next(node for node in running_nodes if node["node_type"] == "subagent")
    assert running["id"] == queued["id"]
    assert running["status"] == "running"
    assert running["payload"]["queued_at"] == 1001
    assert running["payload"]["started_at"] == 1003
    assert running["payload"]["queue_duration_ms"] == 2000
    assert running["payload"]["task"] == "Gather evidence"

    emit(
        recorder,
        "subagent_end",
        1005,
        batch_id="batch",
        task_id="one",
        status="success",
        final_response="Evidence found",
    )
    recorder.finish("done")
    nodes = store.get_session_traces(session_id)["runs"][0]["events"]
    agents = [node for node in nodes if node["node_type"] == "subagent"]
    assert len(agents) == 1
    assert agents[0]["id"] == queued["id"]
    assert agents[0]["status"] == "done"
    assert agents[0]["duration_ms"] == 2000
    assert agents[0]["payload"]["status"] == "success"
    assert agents[0]["payload"]["depends_on"] == ["upstream"]


@pytest.mark.parametrize("status", ["skipped", "cancelled"])
@pytest.mark.parametrize("queued", [False, True])
def test_unstarted_tasks_still_have_terminal_nodes_after_batch_end(tmp_path, status, queued):
    recorder, store, session_id = trace_for(tmp_path)
    emit(recorder, "subagent_batch_start", 1000, batch_id="batch", task_count=1)
    if queued:
        emit(
            recorder,
            "subagent_queued",
            1001,
            batch_id="batch",
            task_id="blocked",
            role="reviewer",
        )
    emit(recorder, "subagent_batch_end", 1002, batch_id="batch", status=status)
    emit(
        recorder,
        "subagent_end",
        1003,
        batch_id="batch",
        task_id="blocked",
        role="reviewer",
        status=status,
        error="Dependency unavailable" if status == "skipped" else "Parent cancelled",
        duration_ms=0,
    )
    recorder.finish("done")

    nodes = store.get_session_traces(session_id)["runs"][0]["events"]
    batch = next(node for node in nodes if node["node_type"] == "subagent_batch")
    agents = [node for node in nodes if node["node_type"] == "subagent"]
    assert len(agents) == 1
    assert agents[0]["parent_id"] == batch["id"]
    assert agents[0]["status"] == status
    assert agents[0]["payload"]["status"] == status
    assert agents[0]["duration_ms"] == 0
    assert agents[0]["ended_at"] is not None


def test_late_success_start_or_queue_cannot_resurrect_cancelled_task(tmp_path):
    recorder, store, session_id = trace_for(tmp_path)
    emit(recorder, "subagent_batch_start", 1000, batch_id="batch", task_count=1)
    data = {"batch_id": "batch", "task_id": "cancelled", "role": "researcher"}
    emit(recorder, "subagent_queued", 1001, **data)
    emit(recorder, "subagent_start", 1002, **data)
    emit(recorder, "subagent_end", 1003, **data, status="cancelled", error="Parent cancelled")
    emit(recorder, "subagent_end", 1004, **data, status="success", final_response="Late result")
    emit(recorder, "subagent_start", 1005, **data)
    emit(recorder, "subagent_queued", 1006, **data)
    recorder.finish("done")

    nodes = store.get_session_traces(session_id)["runs"][0]["events"]
    agents = [node for node in nodes if node["node_type"] == "subagent"]
    assert len(agents) == 1
    assert agents[0]["status"] == "cancelled"
    assert agents[0]["payload"]["error"] == "Parent cancelled"
    assert "final_response" not in agents[0]["payload"]
