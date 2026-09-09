"""真实追踪仓储记录补充输入的接收、应用与终态，终态必须先于 recorder 关闭。"""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api import agent as agent_api
from app.core.agent.executor import AgentCancelledError
from app.core.agent.run_service import ChatRunManager
from app.core.session import ChatSessionStore
from app.core.tracing import TraceRecorder, TraceStore
from app.schemas import ChatRequest
from app.schemas.chat_inputs import ChatInputRequest


@pytest.mark.parametrize("outcome", ["success", "cancel", "error"])
def test_input_terminal_state_is_traced_before_run_closes(tmp_path, monkeypatch, outcome):
    sessions = ChatSessionStore(str(tmp_path))
    session_id = sessions.create_session(user_id="alice")["id"]
    traces = TraceStore(str(tmp_path))
    manager = ChatRunManager()

    class FakeAgent:
        last_sources = []

        def __init__(self):
            self.messages = []

        def run_stream(self, **kwargs):
            channel = self.input_channel
            channel.service.submit(
                session_id,
                ChatInputRequest(
                    request_id="steer-once",
                    message="改用人民币",
                    mode="steer",
                    target_run_id=channel.run.id,
                ),
                lambda _item: pytest.fail("Steering must not start another run"),
            )
            assert channel.drain()[0]["message"] == "改用人民币"
            if outcome == "cancel":
                kwargs["cancel_event"].set()
                raise AgentCancelledError("Stopped")
            if outcome == "error":
                raise RuntimeError("Model failed")
            assert channel.finish() == []
            return "已改用人民币"

    monkeypatch.setattr(agent_api, "chat_runs", manager)
    monkeypatch.setattr(agent_api, "get_session_store", lambda: sessions)
    monkeypatch.setattr(agent_api, "_build_agent", lambda _user: FakeAgent())
    monkeypatch.setattr(
        agent_api,
        "_start_trace",
        lambda session_id, message, _user: TraceRecorder.start(traces, session_id, message),
    )
    monkeypatch.setattr(agent_api, "_schedule_memory_curate", lambda **_kwargs: None)
    try:
        request = ChatRequest(message="整理数据", session_id=session_id)
        if outcome == "success":
            assert agent_api.chat(request, SimpleNamespace(id="alice")).response == "已改用人民币"
        else:
            with pytest.raises(HTTPException):
                agent_api.chat(request, SimpleNamespace(id="alice"))
        trace = traces.get_session_traces(session_id)["runs"][0]
        nodes = [event for event in trace["events"] if event["node_type"] == "input"]
        expected_final = "completed" if outcome == "success" else "failed"
        assert [node["payload"]["input"]["status"] for node in nodes] == [
            "pending",
            "applied",
            expected_final,
        ]
        assert all(node["payload"]["input"]["message"] == "改用人民币" for node in nodes)
        assert len({node["payload"]["input"]["id"] for node in nodes}) == 1
        assert (
            trace["status"] == {"success": "done", "cancel": "cancelled", "error": "error"}[outcome]
        )
    finally:
        manager.close()
