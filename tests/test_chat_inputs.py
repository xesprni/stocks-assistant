"""主会话输入的持久化、隔离及真实线程边界回归。"""

import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import agent as agent_api
from app.core.agent.executor import AgentCancelledError
from app.core.agent.input_service import ChatInputService
from app.core.agent.run_service import ChatRun, ChatRunManager
from app.core.security import CurrentUser, get_current_user
from app.core.session import ChatSessionStore
from app.schemas import ChatRequest
from app.schemas.chat_inputs import ChatInputRequest


def user(name="alice", admin=False, permissions=None):
    return CurrentUser(
        id=name,
        username=name,
        display_name=name,
        roles=("admin" if admin else "user",),
        permissions=frozenset(
            {"*"}
            if admin
            else ({"chat:read", "chat:write"} if permissions is None else permissions)
        ),
        is_active=True,
    )


@pytest.fixture
def inputs(monkeypatch, tmp_path):
    manager = ChatRunManager()
    store = ChatSessionStore(str(tmp_path))
    gates, started, calls = {}, {}, []
    recorder, curated = MagicMock(), MagicMock()
    failure = set()

    class FakeAgent:
        last_sources = []

        def __init__(self):
            self.messages = []

        def run_stream(self, *, user_message, cancel_event, on_event, **kwargs):
            calls.append({"message": user_message, "history": list(self.messages), **kwargs})
            started.setdefault(user_message, threading.Event()).set()
            assert gates.setdefault(user_message, threading.Event()).wait(5)
            if cancel_event.is_set():
                raise AgentCancelledError("stopped by user")
            if user_message in failure:
                raise RuntimeError("provider failed")
            self.input_channel.finish()
            self.input_channel.finish()
            return f"answer:{user_message}"

    monkeypatch.setattr(agent_api, "chat_runs", manager)
    monkeypatch.setattr(agent_api, "get_session_store", lambda: store)
    monkeypatch.setattr(agent_api, "_build_agent", lambda _user: FakeAgent())
    monkeypatch.setattr(agent_api, "_start_trace", lambda *_args: recorder)
    monkeypatch.setattr(agent_api, "_schedule_memory_curate", curated)
    app = FastAPI()
    app.include_router(agent_api.router, prefix="/agent")
    app.dependency_overrides[get_current_user] = user
    session_id = store.create_session(user_id="alice")["id"]
    base = f"/agent/sessions/{session_id}/inputs"
    with TestClient(app) as client:

        def start(message="main", sync=False):
            if sync:
                return client.post(
                    "/agent/chat",
                    json={
                        "message": message,
                        "session_id": session_id,
                    },
                )
            return agent_api._start_chat_run(
                ChatRequest(message=message, session_id=session_id), user()
            )

        def wait_started(message):
            assert started.setdefault(message, threading.Event()).wait(3)

        def release(message):
            gates.setdefault(message, threading.Event()).set()

        def submit(message, mode="queue", **kwargs):
            return client.post(
                base,
                json={
                    "request_id": message,
                    "message": message,
                    "mode": mode,
                    **kwargs,
                },
            )

        yield SimpleNamespace(**locals())
    for gate in gates.values():
        gate.set()
    manager.close()
    for run in list(manager._runs.values()):
        with run._condition:
            assert run._condition.wait_for(lambda run=run: run.completed_at is not None, timeout=5)


def test_queue_fifo_steer_history_and_curator(inputs):
    h = inputs
    first = h.start()
    h.wait_started("main")
    second = h.submit("second", thinking_enabled=True).json()
    third = h.submit("third").json()
    steer = h.submit("use CNY", mode="steer", target_run_id=first.id).json()
    assert second["status"] == third["status"] == steer["status"] == "pending"
    assert h.store.get_messages(h.session_id) == []
    h.release("main")
    h.wait_started("second")
    assert first.wait_result()["final_response"] == "answer:main"
    messages = h.store.get_messages(h.session_id)
    assert [(m["role"], m["content"]) for m in messages] == [
        ("user", "main"),
        ("user", "use CNY"),
        ("assistant", "answer:main"),
    ]
    assert messages[1]["metadata"]["input_id"] == steer["id"]
    assert h.calls[1]["thinking_enabled"] is True
    assert [m["content"][0]["text"] for m in h.calls[1]["history"]] == [
        "main",
        "use CNY",
        "answer:main",
    ]
    assert h.curated.call_args.kwargs["user_message"] == "main\n\nuse CNY"
    updates = [
        call.args[0]
        for call in h.recorder.handle_event.call_args_list
        if call.args[0]["type"] == "input_updated"
    ]
    assert any(event["data"]["input"]["status"] == "applied" for event in updates)
    h.release("second")
    h.wait_started("third")
    last = h.manager.active_for_session(h.session_id)
    h.release("third")
    last.wait_result()
    detail = h.client.get(f"/agent/sessions/{h.session_id}").json()
    assert detail["active_run"] is None
    assert [item["status"] for item in detail["inputs"]] == ["completed"] * 3
    assert [call["message"] for call in h.calls] == ["main", "second", "third"]


def test_idempotent_retry_after_completion_and_conflict(inputs):
    h = inputs
    original = h.submit("one").json()
    h.wait_started("one")
    run = h.manager.active_for_session(h.session_id)
    steer = h.submit("change", mode="steer", target_run_id=run.id).json()
    h.release("one")
    run.wait_result()
    assert h.submit("one").json()["id"] == original["id"]
    retry = h.submit("change", mode="steer", target_run_id=run.id)
    assert retry.status_code == 200 and retry.json()["id"] == steer["id"]
    assert retry.json()["status"] == "completed"
    assert (
        h.client.post(
            h.base,
            json={
                "request_id": "one",
                "message": "different",
                "mode": "queue",
            },
        ).status_code
        == 409
    )
    assert len(h.calls) == 1


def test_concurrent_identical_submissions_start_exactly_one_run(inputs):
    h = inputs
    with ThreadPoolExecutor(max_workers=5) as pool:
        responses = list(pool.map(lambda _: h.submit("same input"), range(10)))
    assert all(response.status_code == 200 for response in responses)
    assert len({response.json()["id"] for response in responses}) == 1
    h.wait_started("same input")
    run = h.manager.active_for_session(h.session_id)
    assert len(h.calls) == 1
    h.release("same input")
    run.wait_result()
    assert len(h.store.get_messages(h.session_id)) == 2


@pytest.mark.parametrize("stop", [True, False])
def test_stop_or_error_pauses_without_losing_pending_and_resume_is_explicit(inputs, stop):
    h = inputs
    first_input = h.submit("one").json()
    h.wait_started("one")
    run = h.manager.active_for_session(h.session_id)
    pending = h.submit("two").json()
    steer = h.submit("late", mode="steer", target_run_id=run.id).json()
    if stop:
        assert h.client.post(f"/agent/runs/{run.id}/cancel").status_code == 200
        assert h.submit("too late", mode="steer", target_run_id=run.id).status_code == 409
    else:
        h.failure.add("one")
    h.release("one")
    run.wait_result()
    detail = h.client.get(f"/agent/sessions/{h.session_id}").json()
    statuses = {item["id"]: item["status"] for item in detail["inputs"]}
    assert statuses == {
        first_input["id"]: "failed",
        pending["id"]: "pending",
        steer["id"]: "failed",
    }
    assert detail["input_queue_paused"] is True and detail["active_run"] is None
    assert h.submit("three").json()["status"] == "pending"
    assert [call["message"] for call in h.calls] == ["one"]
    resumed = h.client.post(h.base + "/resume")
    assert resumed.status_code == 200 and resumed.json()["active_run"]["user_message"] == "two"
    h.wait_started("two")
    h.release("two")
    h.wait_started("three")
    last = h.manager.active_for_session(h.session_id)
    h.release("three")
    last.wait_result()
    assert [call["message"] for call in h.calls] == ["one", "two", "three"]


def test_finish_boundary_either_accepts_or_rejects_steer(inputs):
    h = inputs
    run = h.start()
    h.wait_started("main")
    channel = run.input_channel
    accepted = h.submit("first correction", mode="steer", target_run_id=run.id)
    assert accepted.status_code == 200
    assert [item["message"] for item in channel.finish()] == ["first correction"]
    assert channel.accepting is True
    entered = threading.Event()

    def late_submit():
        entered.set()
        return h.submit("after close", mode="steer", target_run_id=run.id)

    with ThreadPoolExecutor(max_workers=1) as pool:
        with h.manager.lock:
            future = pool.submit(late_submit)
            assert entered.wait(2)
            assert channel.finish() == []
            assert channel.accepting is False
        assert future.result(timeout=3).status_code == 409
    assert len(h.client.get(h.base).json()["inputs"]) == 1
    h.release("main")
    run.wait_result()


@pytest.mark.parametrize("admin", [False, True])
def test_input_api_and_tool_execution_never_cross_users(inputs, admin):
    h = inputs
    h.app.dependency_overrides[get_current_user] = lambda: user("bob", admin=admin)
    for method, path, payload in (
        ("post", h.base, {"request_id": "x", "message": "x", "mode": "queue"}),
        ("get", h.base, None),
        ("post", h.base + "/resume", None),
        ("delete", h.base + "/unknown", None),
        ("post", "/agent/chat", {"message": "probe", "session_id": h.session_id}),
        ("post", "/agent/stream", {"message": "probe", "session_id": h.session_id}),
    ):
        response = h.client.request(method, path, **({"json": payload} if payload else {}))
        assert response.status_code == 404
    assert h.calls == []


def test_input_validation_capacity_cancel_and_permission(inputs):
    h = inputs
    run = h.start()
    h.wait_started("main")
    for payload in (
        {"request_id": "a", "message": " ", "mode": "queue"},
        {"request_id": "b", "message": "x" * 20001, "mode": "queue"},
        {"request_id": "c", "message": "x", "mode": "steer"},
        {"request_id": "d", "message": "x", "mode": "queue", "target_run_id": run.id},
    ):
        assert h.client.post(h.base, json=payload).status_code == 422
    pending = [h.submit(f"item-{i}").json() for i in range(20)]
    assert h.submit("overflow").status_code == 429
    assert h.submit("item-0").status_code == 200
    first = pending[0]
    assert h.client.delete(h.base + "/" + first["id"]).json()["status"] == "cancelled"
    assert h.submit("now has room").status_code == 200
    h.app.dependency_overrides[get_current_user] = lambda: user(permissions=set())
    assert h.submit("forbidden").status_code == 403
    assert h.client.get(h.base).status_code == 403
    h.app.dependency_overrides[get_current_user] = user
    h.client.post(f"/agent/runs/{run.id}/cancel")
    h.release("main")
    run.wait_result()


def test_sync_chat_holds_the_same_slot_and_accepts_steer(inputs):
    h = inputs
    with ThreadPoolExecutor(max_workers=1) as pool:
        sync = pool.submit(h.start, "main", True)
        h.wait_started("main")
        run = h.manager.active_for_session(h.session_id)
        assert (
            h.client.post(
                "/agent/chat",
                json={
                    "message": "concurrent",
                    "session_id": h.session_id,
                },
            ).status_code
            == 409
        )
        assert h.submit("correct", mode="steer", target_run_id=run.id).status_code == 200
        h.release("main")
        assert sync.result(timeout=3).status_code == 200
    assert [m["content"] for m in h.store.get_messages(h.session_id)] == [
        "main",
        "correct",
        "answer:main",
    ]


def test_recovery_keeps_pending_and_never_replays_running(tmp_path):
    store = ChatSessionStore(str(tmp_path))
    sid = store.create_session(user_id="alice")["id"]
    manager = ChatRunManager()
    service = ChatInputService(store, manager)
    service.recover()
    store.repository.pause_inputs(sid, True)
    starter = MagicMock()
    queued = service.submit(
        sid, ChatInputRequest(request_id="queue", message="queue", mode="queue"), starter
    )
    running = service.submit(
        sid, ChatInputRequest(request_id="running", message="running", mode="queue"), starter
    )
    store.repository.update_input(running["id"], status="running", run_id="lost-run")
    applied = service.submit(
        sid, ChatInputRequest(request_id="applied", message="applied", mode="queue"), starter
    )
    store.repository.update_input(
        applied["id"], mode="steer", status="applied", run_id="lost-run", target_run_id="lost-run"
    )
    late = service.submit(
        sid, ChatInputRequest(request_id="late", message="late", mode="queue"), starter
    )
    store.repository.update_input(late["id"], mode="steer", target_run_id="lost-run")
    restart = ChatInputService(ChatSessionStore(str(tmp_path)), ChatRunManager())
    restart.recover()
    statuses = {item["id"]: item for item in store.repository.list_inputs(sid)}
    assert statuses[queued["id"]]["status"] == "pending"
    for item in (running, applied, late):
        assert statuses[item["id"]]["status"] == "failed"
        assert "process restart" in statuses[item["id"]]["error"]
    assert restart.start_next(sid, starter) is None
    starter.assert_not_called()
    store.clear_messages(sid)
    assert store.repository.list_inputs(sid) == []
    assert store.get_session(sid)["input_queue_paused"] is False
    other = store.create_session(user_id="alice")["id"]
    store.repository.pause_inputs(other, True)
    restart.submit(other, ChatInputRequest(request_id="x", message="x", mode="queue"), starter)
    store.delete_session(other)
    assert store.repository.list_inputs(other) == []


def test_long_run_finalizes_all_inputs_and_retains_visible_pending(tmp_path):
    store = ChatSessionStore(str(tmp_path))
    sid = store.create_session(user_id="alice")["id"]
    manager = ChatRunManager()
    service = ChatInputService(store, manager)
    run = ChatRun("alice", "main", "main", sid, "main")
    manager._runs[run.id] = run
    service.install(run)
    try:
        pending = service.submit(
            sid, ChatInputRequest(request_id="next", message="next", mode="queue"), MagicMock()
        )
        for i in range(105):
            service.submit(
                sid,
                ChatInputRequest(
                    request_id=str(i),
                    message=str(i),
                    mode="steer",
                    target_run_id=run.id,
                ),
                MagicMock(),
            )
            run.input_channel.drain()
        visible = store.repository.list_inputs(sid)
        assert len(visible) == 100 and visible[0]["id"] == pending["id"]
        service.finish_run(run, success=True)
        assert store.repository.unfinished_run_inputs(sid, run.id) == []
        assert len(run.input_channel.applied) == 105
    finally:
        run.close()


def test_legacy_sessions_migrate_queue_state_without_changing_history(tmp_path):
    db_path = tmp_path / "sessions" / "sessions.db"
    db_path.parent.mkdir()
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            "CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT, "
            "title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
        )
        connection.execute(
            "INSERT INTO sessions VALUES ('legacy', 'alice', '旧会话', 'old', 'old')"
        )
    store = ChatSessionStore(str(tmp_path))
    legacy = store.get_detail("legacy")
    assert legacy["title"] == "旧会话" and legacy["input_queue_paused"] is False
    assert legacy["inputs"] == []
    service = ChatInputService(store, ChatRunManager())
    service.recover()
    store.repository.pause_inputs("legacy", True)
    item = service.submit(
        "legacy",
        ChatInputRequest(
            request_id="new",
            message="new",
            mode="queue",
        ),
        MagicMock(),
    )
    reopened = ChatSessionStore(str(tmp_path))
    assert reopened.get_detail("legacy")["inputs"][0]["id"] == item["id"]
