"""后台聊天运行、真实 ASGI 断线以及幂等重放的协议回归。"""

import asyncio
import json
import threading
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import agent as agent_api
from app.core.agent.executor import AgentCancelledError
from app.core.agent.run_service import ChatRunCapacityError, ChatRunManager
from app.core.security import CurrentUser, get_current_user
from app.core.session import ChatSessionStore

SOURCES = [{"id": "source", "url": "https://example.test/source", "title": "Source"}]


def user(user_id="alice", *, admin=False, permissions=None):
    return CurrentUser(
        id=user_id,
        username=user_id,
        display_name=user_id,
        roles=("admin" if admin else "user",),
        permissions=frozenset(
            {"*"}
            if admin
            else permissions
            if permissions is not None
            else {"chat:read", "chat:write"}
        ),
        is_active=True,
    )


def parse_events(text):
    return [json.loads(line[6:]) for line in text.splitlines() if line.startswith("data: ")]


def wait_finished(run):
    with run._condition:
        assert run._condition.wait_for(lambda: run.completed_at is not None, timeout=3)


@pytest.fixture
def chat_runs(monkeypatch, tmp_path):
    manager = ChatRunManager()
    store = ChatSessionStore(str(tmp_path))
    gate = threading.Event()
    gate.set()
    started = threading.Event()
    recorder = MagicMock()
    curated = MagicMock()
    calls = []
    controls = {"cancel_event": None}

    class FakeAgent:
        last_sources = SOURCES

        def __init__(self):
            self.messages = []

        def run_stream(self, *, on_event, cancel_event, **kwargs):
            calls.append(kwargs)
            controls["cancel_event"] = cancel_event
            on_event({"type": "reasoning_update", "data": {"text": "PRIVATE_REASONING"}})
            on_event({"type": "llm_call_start", "data": {"prompt": "PRIVATE_PROMPT"}})
            on_event({"type": "token", "data": {"text": "partial "}})
            started.set()
            assert gate.wait(3), "test did not release the fake agent"
            if cancel_event.is_set():
                raise AgentCancelledError("explicitly stopped")
            on_event({"type": "token", "data": {"text": "answer"}})
            on_event({"type": "agent_end", "data": {"final_response": "premature"}})
            return "partial answer"

    monkeypatch.setattr(agent_api, "chat_runs", manager)
    monkeypatch.setattr(agent_api, "get_session_store", lambda: store)
    monkeypatch.setattr(agent_api, "_build_agent", lambda user_id: FakeAgent())
    monkeypatch.setattr(agent_api, "_start_trace", lambda *args: recorder)
    monkeypatch.setattr(agent_api, "_schedule_memory_curate", curated)
    app = FastAPI()
    app.include_router(agent_api.router, prefix="/agent")
    app.dependency_overrides[get_current_user] = user
    with TestClient(app) as client:
        yield SimpleNamespace(
            app=app,
            client=client,
            manager=manager,
            store=store,
            gate=gate,
            started=started,
            recorder=recorder,
            curated=curated,
            calls=calls,
            controls=controls,
        )
    gate.set()
    manager.close()
    for run in manager._runs.values():
        wait_finished(run)


async def disconnect_post(app, payload, *, before_first_event=False):
    """向 ASGI 发送 http.disconnect；TestClient.stream 会缓冲，不能验证真实断线。"""
    body = json.dumps(payload).encode()
    disconnect = asyncio.Event()
    sent = []
    request_received = False

    async def receive():
        nonlocal request_received
        if not request_received:
            request_received = True
            return {"type": "http.request", "body": body, "more_body": False}
        await disconnect.wait()
        return {"type": "http.disconnect"}

    async def send(message):
        sent.append(message)
        drop = message["type"] == (
            "http.response.start" if before_first_event else "http.response.body"
        )
        if drop:
            disconnect.set()
            # 等待 ASGI 的 disconnect listener 取消发送，确保首包丢失用例不收到正文。
            await asyncio.Event().wait()

    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/agent/stream",
        "raw_path": b"/agent/stream",
        "query_string": b"",
        "root_path": "",
        "headers": [(b"content-type", b"application/json")],
        "client": ("127.0.0.1", 1234),
        "server": ("testserver", 80),
    }
    await asyncio.wait_for(app(scope, receive, send), timeout=3)
    assert sent[0]["status"] == 200
    return sent


@pytest.mark.parametrize("before_first_event", [False, True])
def test_asgi_disconnect_keeps_running_and_replay_completes_once(chat_runs, before_first_event):
    h = chat_runs
    h.gate.clear()
    payload = {"message": "hello", "request_id": "one-request", "user_id": "forged-user"}

    async def scenario():
        sent = await disconnect_post(h.app, payload, before_first_event=before_first_event)
        assert await asyncio.to_thread(h.started.wait, 2)
        sessions = h.store.list_sessions(user_id="alice")
        assert len(sessions) == 1
        run = h.manager.active_for_session(sessions[0]["id"])
        assert run is not None and run.status == "running"
        assert not run.cancel_event.is_set()
        assert h.store.get_messages(run.session_id) == []
        if before_first_event:
            assert not any(message["type"] == "http.response.body" for message in sent)
        # 原任务仍被 gate 阻塞时重发相同请求，也必须复用会话和 Agent。
        await disconnect_post(h.app, payload, before_first_event=True)
        assert len(h.calls) == h.store.count_sessions(user_id="alice") == 1
        h.gate.set()
        await asyncio.to_thread(wait_finished, run)
        return run

    run = asyncio.run(scenario())
    assert run.status == "done"
    messages = h.store.get_messages(run.session_id)
    assert [(message["role"], message["content"]) for message in messages] == [
        ("user", "hello"),
        ("assistant", "partial answer"),
    ]
    assert messages[1]["metadata"]["sources"] == SOURCES
    assert len(h.calls) == h.curated.call_count == h.recorder.finish.call_count == 1
    trace_event_count = h.recorder.handle_event.call_count
    for response in (
        h.client.post("/agent/stream", json=payload),
        h.client.get(f"/agent/runs/{run.id}/stream"),
    ):
        assert response.status_code == 200
        events = parse_events(response.text)
        assert [event["event_id"] for event in events] == list(range(1, len(events) + 1))
        assert all(event["run_id"] == run.id for event in events)
        assert events[0]["type"] == "run_started"
        assert events[-1]["type"] == "agent_end"
        assert events[-1]["data"]["message_id"] == messages[1]["id"]
        assert response.text.count('"type": "agent_end"') == 1
        assert "PRIVATE_" not in response.text and "premature" not in response.text
    assert h.store.count_sessions(user_id="alice") == 1
    assert h.store.get_messages(run.session_id) == messages
    assert len(h.calls) == h.curated.call_count == h.recorder.finish.call_count == 1
    assert h.recorder.handle_event.call_count == trace_event_count
    assert h.curated.call_args.kwargs["user_id"] == "alice"
    assert h.recorder.finish.call_args.kwargs["status"] == "done"


def test_resume_cursor_and_idempotency_conflicts(chat_runs):
    h = chat_runs
    payload = {"message": "hello", "request_id": "cursor-request"}
    response = h.client.post("/agent/stream", json=payload)
    events = parse_events(response.text)
    run_id = events[0]["run_id"]
    cursor = events[2]["event_id"]
    for response in (
        h.client.get(f"/agent/runs/{run_id}/stream", params={"after_event_id": cursor}),
        h.client.post("/agent/stream", json={**payload, "after_event_id": cursor}),
    ):
        assert response.status_code == 200
        assert parse_events(response.text) == events[3:]
    last = events[-1]["event_id"]
    assert h.client.get(f"/agent/runs/{run_id}/stream", params={"after_event_id": last}).text == ""
    assert (
        h.client.get(
            f"/agent/runs/{run_id}/stream", params={"after_event_id": last + 1}
        ).status_code
        == 400
    )
    assert (
        h.client.get(f"/agent/runs/{run_id}/stream", params={"after_event_id": -1}).status_code
        == 422
    )
    assert (
        h.client.post("/agent/stream", json={**payload, "message": "different prompt"}).status_code
        == 409
    )
    assert (
        h.client.post(
            "/agent/stream", json={"message": "hello", "request_id": "missing", "after_event_id": 1}
        ).status_code
        == 404
    )
    assert len(h.calls) == 1


@pytest.mark.parametrize("admin", [False, True])
def test_run_data_and_cancellation_are_owner_only(chat_runs, admin):
    h = chat_runs
    events = parse_events(
        h.client.post(
            "/agent/stream", json={"message": "hello", "request_id": "same-user-key"}
        ).text
    )
    run_id = events[0]["run_id"]
    h.app.dependency_overrides[get_current_user] = lambda: user("bob", admin=admin)
    assert h.client.get(f"/agent/runs/{run_id}/stream").status_code == 404
    assert h.client.post(f"/agent/runs/{run_id}/cancel").status_code == 404
    own = h.client.post("/agent/stream", json={"message": "hello", "request_id": "same-user-key"})
    assert own.status_code == 200
    assert parse_events(own.text)[0]["run_id"] != run_id
    assert h.store.count_sessions(user_id="bob") == 1


def test_run_endpoints_require_chat_permissions(chat_runs):
    h = chat_runs
    h.app.dependency_overrides[get_current_user] = lambda: user(permissions=set())
    assert h.client.post("/agent/stream", json={"message": "hello"}).status_code == 403
    assert h.client.get("/agent/runs/unknown/stream").status_code == 403
    assert h.client.post("/agent/runs/unknown/cancel").status_code == 403
    assert h.calls == []


def test_active_session_rejects_second_turn_and_cancel_is_cooperative(chat_runs):
    h = chat_runs
    session_id = h.store.create_session(user_id="alice")["id"]
    previous = h.store.append_message(session_id, "assistant", "previous answer")
    h.gate.clear()

    async def start_and_cancel():
        await disconnect_post(
            h.app,
            {
                "message": "hello",
                "request_id": "active",
                "session_id": session_id,
            },
        )
        assert await asyncio.to_thread(h.started.wait, 2)
        run = h.manager.active_for_session(session_id)
        assert run is not None
        detail = h.client.get(f"/agent/sessions/{session_id}").json()
        assert detail["active_run"]["run_id"] == run.id
        h.app.dependency_overrides[get_current_user] = lambda: user("bob")
        # 其他用户只能得到 404，不能用忙会话的 409 探测正在进行的聊天。
        unauthorized = h.client.post(
            "/agent/stream",
            json={"message": "probe", "request_id": "probe", "session_id": session_id},
        )
        assert unauthorized.status_code == 404
        assert len(h.calls) == 1 and h.store.count_sessions(user_id="bob") == 0
        h.app.dependency_overrides[get_current_user] = user
        assert (
            h.client.post(
                "/agent/stream",
                json={
                    "message": "another",
                    "request_id": "other",
                    "session_id": session_id,
                },
            ).status_code
            == 409
        )
        assert (
            h.client.post(
                "/agent/chat",
                json={
                    "message": "another",
                    "session_id": session_id,
                    "clear_history": True,
                },
            ).status_code
            == 409
        )
        for path in (
            f"/agent/sessions/{session_id}",
            f"/agent/sessions/{session_id}/messages",
            f"/agent/history?session_id={session_id}",
            "/agent/sessions",
        ):
            assert h.client.delete(path).status_code == 409
        assert h.store.get_messages(session_id) == [previous]
        stopped = h.client.post(f"/agent/runs/{run.id}/cancel")
        assert stopped.status_code == 200
        assert stopped.json()["status"] == "stopping"
        assert run.completed_at is None
        assert h.controls["cancel_event"].is_set()
        h.gate.set()
        await asyncio.to_thread(wait_finished, run)
        return run

    run = asyncio.run(start_and_cancel())
    replay = h.client.get(f"/agent/runs/{run.id}/stream")
    assert parse_events(replay.text)[-1]["type"] == "agent_stopped"
    assert run.status == "cancelled"
    assert h.store.get_messages(session_id) == [previous]
    h.curated.assert_not_called()
    assert h.recorder.finish.call_count == 1
    assert h.recorder.finish.call_args.kwargs["status"] == "cancelled"
    assert h.client.post(f"/agent/runs/{run.id}/cancel").json()["status"] == "cancelled"
    assert h.client.get(f"/agent/sessions/{session_id}").json()["active_run"] is None
    assert h.client.delete(f"/agent/sessions/{session_id}/messages").status_code == 200
    assert h.client.delete(f"/agent/sessions/{session_id}").status_code == 200


def test_manager_retention_capacity_and_shutdown(monkeypatch):
    clock = {"now": 100.0}
    monkeypatch.setattr("app.core.agent.run_service.time.monotonic", lambda: clock["now"])
    manager = ChatRunManager(retention_seconds=10, max_active=1, max_runs=2)
    gates = []

    def start(key):
        gate = threading.Event()
        gates.append(gate)

        def worker(run):
            assert gate.wait(3)
            run.publish({"type": "agent_end", "data": {"final_response": key}})

        return manager.start(
            user_id="alice",
            request_id=key,
            fingerprint=key,
            session_id=None,
            user_message=key,
            prepare=lambda: (key, worker),
        )

    try:
        first = start("first")
        with pytest.raises(ChatRunCapacityError):
            start("active-overflow")
        gates[0].set()
        wait_finished(first)
        second = start("second")
        gates[-1].set()
        wait_finished(second)
        with pytest.raises(ChatRunCapacityError):
            start("cache-overflow")
        clock["now"] = 109.9
        assert manager.get(first.id, "alice") is first
        clock["now"] = 110.0
        with pytest.raises(KeyError):
            manager.get(first.id, "alice")
        assert first._journal.closed and second._journal.closed
        # 过期后释放缓存与幂等键，原 request_id 可以重新启动。
        replacement = start("first")
        assert replacement.id != first.id
        manager.close()
        assert replacement.cancel_event.is_set()
        with pytest.raises(ChatRunCapacityError):
            start("after-shutdown")
        gates[-2].set()
        wait_finished(replacement)
    finally:
        for gate in gates:
            gate.set()
        manager.close()
