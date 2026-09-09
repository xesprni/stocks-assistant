"""API 重构的协议、依赖与隔离回归。"""

import asyncio
import threading
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import app.config as config_module
from app import deps
from app.api import agent as agent_api
from app.api import memory as memory_api
from app.config import Settings
from app.core.agent.executor import AgentCancelledError
from app.core.configuration.runtime import WORKSPACE_DEPENDENCIES, invalidate_runtime
from app.core.configuration.service import persist_config_update
from app.core.security import CurrentUser, get_current_user
from app.schemas.config import ConfigUpdate


def current_user(*, admin=False):
    return CurrentUser(
        id="alice",
        username="alice",
        display_name="Alice",
        roles=("admin" if admin else "user",),
        permissions=frozenset({"*"} if admin else {"chat:write", "config:read", "memory:read"}),
        is_active=True,
    )


def test_chat_and_scheduler_use_fresh_shared_factory(monkeypatch, tmp_path):
    import app.core.agent.factory as factory

    settings = Settings(
        workspace_dir=str(tmp_path), memory_enabled=False, llm_model="personal-model"
    )
    monkeypatch.setattr(factory, "get_effective_settings", lambda user_id: settings)
    provider = SimpleNamespace(call=MagicMock(), call_stream=MagicMock())
    monkeypatch.setattr(deps, "create_llm_provider", lambda config: provider)
    monkeypatch.setattr(deps, "get_skill_manager", lambda: None)
    tool_factory = MagicMock(return_value=[])
    monkeypatch.setattr(factory, "create_agent_tools", tool_factory)
    agents = []

    def fake_agent(**kwargs):
        agent = SimpleNamespace(**kwargs, run_stream=MagicMock(return_value="completed"))
        agents.append(agent)
        return agent

    monkeypatch.setattr(factory, "Agent", fake_agent)
    chat_agent = agent_api._build_agent("alice")
    assert deps._run_scheduled_agent("scheduled prompt", "alice") == "completed"
    assert len(agents) == 2 and agents[0] is not agents[1]
    assert chat_agent.settings is settings
    assert chat_agent.workspace_dir == str(tmp_path / "users" / "alice")
    assert chat_agent.model.call is provider.call
    agents[1].run_stream.assert_called_once_with(
        user_message="scheduled prompt", clear_history=True
    )
    assert tool_factory.call_args_list[0].args == (settings, "alice")


@pytest.mark.parametrize("user_id", [None, "alice"])
@pytest.mark.parametrize("explicit", [False, True])
def test_factory_tools_share_explicit_or_loaded_settings(monkeypatch, tmp_path, user_id, explicit):
    import app.core.agent.factory as factory
    import app.core.tools.tool_manager as tool_module
    from app.core.tools.base_tool import BaseTool

    snapshot = Settings(
        workspace_dir=str(tmp_path),
        memory_enabled=False,
        llm_model="snapshot",
        agent_tool_allowlist=["snapshot_tool"],
    )
    load_snapshot = MagicMock(return_value=snapshot)
    monkeypatch.setattr(factory, "get_effective_settings", load_snapshot)
    # 若 ToolManager 重读配置，工具将拿到不同模型，模拟请求期间配置刚好发生更新。
    reread = MagicMock(return_value=Settings(llm_model="changed-later"))
    monkeypatch.setattr(config_module, "get_effective_settings", reread)
    provider_factory = MagicMock(
        return_value=SimpleNamespace(call=MagicMock(), call_stream=MagicMock())
    )
    monkeypatch.setattr(deps, "create_llm_provider", provider_factory)
    monkeypatch.setattr(deps, "get_skill_manager", lambda: None)
    monkeypatch.setattr(factory, "Agent", lambda **kwargs: SimpleNamespace(**kwargs))

    class SnapshotTool(BaseTool):
        name = "snapshot_tool"

        def __init__(self, settings):
            self.settings = settings

    monkeypatch.setattr(
        tool_module,
        "builtin_factories",
        lambda manager: {
            SnapshotTool: lambda: SnapshotTool(manager.settings),
        },
    )
    agent = factory.create_agent(user_id, settings=snapshot if explicit else None)
    assert agent.settings is snapshot
    assert agent.tools[0].settings is snapshot
    provider_factory.assert_called_once_with(snapshot)
    assert load_snapshot.call_count == (0 if explicit else 1)
    reread.assert_not_called()


@pytest.fixture
def chat_client(monkeypatch):
    recorder = MagicMock()
    persisted = []
    curated = MagicMock()
    mode = {"failure": None}

    class FakeAgent:
        last_sources = [
            {
                "id": "source-1",
                "url": "https://example.test/source",
                "title": "Source",
                "fetched_at": "2026-09-09T00:00:00Z",
            }
        ]
        messages = []

        def run_stream(self, *, on_event=None, **kwargs):
            if on_event:
                for event_type, data in (
                    ("reasoning_update", {"text": "private reasoning"}),
                    (
                        "subagent_event",
                        {"child_event_type": "reasoning_update", "text": "private child"},
                    ),
                    ("llm_call_start", {}),
                    ("tool_start", {"name": "read_file"}),
                    ("agent_end", {"final_response": "premature"}),
                ):
                    on_event({"type": event_type, "data": data})
            if mode["failure"]:
                raise mode["failure"]
            return "answer"

    def persist(*args, **kwargs):
        persisted.append((args, kwargs))
        return "user-message", "assistant-message"

    monkeypatch.setattr(agent_api, "_prepare_session", lambda request, user: ("session", []))
    monkeypatch.setattr(agent_api, "_build_agent", lambda user_id: FakeAgent())
    monkeypatch.setattr(agent_api, "_start_trace", lambda *args: recorder)
    monkeypatch.setattr(agent_api, "_persist_exchange", persist)
    monkeypatch.setattr(agent_api, "_schedule_memory_curate", curated)
    app = FastAPI()
    app.include_router(agent_api.router, prefix="/agent")
    app.dependency_overrides[get_current_user] = current_user
    with TestClient(app) as client:
        yield client, persisted, curated, recorder, mode


def test_chat_and_stream_share_persistence_and_public_completion(chat_client):
    client, persisted, curated, recorder, _ = chat_client
    plain = client.post("/agent/chat", json={"message": "hello", "user_id": "another-user"})
    assert plain.status_code == 200, plain.text
    assert plain.json()["message_id"] == "assistant-message"
    stream = client.post("/agent/stream", json={"message": "hello", "user_id": "another-user"})
    assert stream.status_code == 200
    assert "private reasoning" not in stream.text and "private child" not in stream.text
    assert "llm_call_start" not in stream.text and "premature" not in stream.text
    assert stream.text.count('"type": "agent_end"') == 1
    assert '"message_id": "assistant-message"' in stream.text
    assert '"sources": [{"id": "source-1"' in stream.text
    assert persisted[0] == persisted[1]
    assert len(persisted) == curated.call_count == recorder.finish.call_count == 2
    assert all(call.kwargs["user_id"] == "alice" for call in curated.call_args_list)


@pytest.mark.parametrize(
    "failure,event",
    [(AgentCancelledError("stopped"), "agent_stopped"), (RuntimeError("failed"), "error")],
)
def test_stream_failure_does_not_complete_or_curate(chat_client, failure, event):
    client, persisted, curated, recorder, mode = chat_client
    mode["failure"] = failure
    response = client.post("/agent/stream", json={"message": "hello"})
    assert f'"type": "{event}"' in response.text
    assert '"type": "agent_end"' not in response.text
    assert not persisted
    curated.assert_not_called()
    assert recorder.finish.call_args.kwargs["status"] == (
        "cancelled" if event == "agent_stopped" else "error"
    )


def test_workspace_invalidation_covers_all_captured_dependencies(monkeypatch):
    factories = {}
    for name in (
        *WORKSPACE_DEPENDENCIES,
        "get_memory_manager",
        "get_memory_manager_for_user",
        "get_embedding_provider",
    ):
        factory = MagicMock()
        factories[name] = factory
        monkeypatch.setattr(deps, name, factory)
    close = MagicMock()
    monkeypatch.setattr(deps, "close_mcp_managers", close)
    invalidate_runtime({"workspace_dir": "/new/workspace"})
    for factory in factories.values():
        factory.cache_clear.assert_called_once_with()
        factory.assert_not_called()
    close.assert_called_once_with(None, all_users=True)
    for factory in factories.values():
        factory.reset_mock()
    invalidate_runtime({"research_quick_prompts_refresh_seconds": 600})
    for factory in factories.values():
        factory.cache_clear.assert_not_called()


def test_effective_config_returns_independent_nested_snapshots(monkeypatch):
    store = MagicMock()
    store.get_config.return_value = {
        "mcp_servers": {"remote": {"headers": {"Authorization": "secret"}}}
    }
    store.get_user_config.return_value = {}
    monkeypatch.setattr("app.core.app_store.get_app_store", lambda: store)
    config_module.clear_effective_settings_cache()
    try:
        first = config_module.get_effective_config("alice")
        first["mcp_servers"]["remote"]["headers"]["Authorization"] = "changed-first"
        second = config_module.get_effective_config("alice")
        second["mcp_servers"]["remote"]["headers"]["Authorization"] = "changed-cached"
        assert (
            config_module.get_effective_config("alice")["mcp_servers"]["remote"]["headers"][
                "Authorization"
            ]
            == "secret"
        )
    finally:
        config_module.clear_effective_settings_cache()


@pytest.mark.parametrize(
    "path", ["memory/users/alice/../bob/private.md", "memory/users/alice/linked.md"]
)
def test_memory_file_rejects_resolved_cross_user_path(monkeypatch, tmp_path, path):
    alice = tmp_path / "memory/users/alice"
    bob = tmp_path / "memory/users/bob"
    alice.mkdir(parents=True)
    bob.mkdir(parents=True)
    (bob / "private.md").write_text("private")
    (alice / "linked.md").symlink_to(bob / "private.md")
    monkeypatch.setattr(
        config_module, "get_settings", lambda: Settings(workspace_dir=str(tmp_path))
    )
    with pytest.raises(HTTPException) as exc:
        memory_api.get_memory_file(path, current_user())
    assert exc.value.status_code == 403


def test_mcp_invalidation_closes_only_requested_user_and_is_idempotent(monkeypatch):
    alice, bob, system = MagicMock(), MagicMock(), MagicMock()
    monkeypatch.setattr(deps, "_mcp_managers", {"alice": alice, "bob": bob, None: system})
    invalidate_runtime({"mcp_tool_timeout_seconds": 20}, user_id="alice")
    alice.close_sync.assert_called_once_with()
    bob.close_sync.assert_not_called()
    system.close_sync.assert_not_called()
    deps.close_mcp_managers()
    deps.close_mcp_managers()
    bob.close_sync.assert_called_once_with()
    system.close_sync.assert_called_once_with()


def test_system_mcp_timeout_refresh_uses_system_settings(monkeypatch):
    import app.core.configuration.service as service

    store = MagicMock()
    monkeypatch.setattr(service, "get_app_store", lambda: store)
    monkeypatch.setattr(service, "get_effective_config", lambda user_id: {})
    monkeypatch.setattr(
        service, "get_effective_settings", lambda user_id: Settings(mcp_tool_timeout_seconds=7)
    )
    monkeypatch.setattr(service, "get_settings", lambda: Settings(mcp_tool_timeout_seconds=90))
    monkeypatch.setattr(service, "reset_settings_cache", lambda user_id=None: None)
    monkeypatch.setattr(service, "invalidate_runtime", MagicMock())
    manager = MagicMock()
    get_manager = MagicMock(return_value=manager)
    monkeypatch.setattr(deps, "get_mcp_manager_for_user", get_manager)
    asyncio.run(
        persist_config_update(ConfigUpdate(mcp_tool_timeout_seconds=90), current_user(admin=True))
    )
    get_manager.assert_called_once_with(None)
    manager.set_tool_timeout_seconds.assert_called_once_with(90)
    store.apply_config_update.assert_called_once_with(
        "alice", user_patch={}, system_patch={"mcp_tool_timeout_seconds": 90.0}
    )


def test_curator_capacity_covers_executor_backlog_and_recovers(monkeypatch):
    settings = Settings(memory_enabled=True, memory_auto_curate_enabled=True)
    monkeypatch.setattr(config_module, "get_effective_settings", lambda user_id: settings)
    monkeypatch.setattr(agent_api, "_memory_curator_slots", threading.BoundedSemaphore(13))
    executor = MagicMock()
    monkeypatch.setattr(agent_api, "_memory_curator_pool", executor)
    monkeypatch.setattr(deps, "create_memory_llm_provider", lambda config: None)
    for _ in range(14):
        agent_api._schedule_memory_curate("session", "user", "assistant")
    assert executor.submit.call_count == 13
    executor.submit.call_args.args[0]()
    agent_api._schedule_memory_curate("session", "user", "assistant")
    assert executor.submit.call_count == 14


@pytest.mark.parametrize("scheduler_stop_fails", [False, True])
def test_lifespan_closes_runtime_user_mcp_managers(monkeypatch, tmp_path, scheduler_stop_fails):
    import app.core.agent.run_service as runs
    import app.main as main_module

    monkeypatch.setattr(runs, "chat_runs", runs.ChatRunManager())

    settings = Settings(
        workspace_dir=str(tmp_path), scheduler_enabled=scheduler_stop_fails, mcp_servers={}
    )
    monkeypatch.setattr(main_module, "get_settings", lambda: settings)
    monkeypatch.setattr(main_module, "setup_logging", lambda **kwargs: None)
    monkeypatch.setattr(deps, "_mcp_managers", {})
    scheduler = SimpleNamespace(
        start=AsyncMock(), stop=AsyncMock(side_effect=RuntimeError("scheduler stop failed"))
    )
    scheduler_factory = MagicMock(return_value=scheduler)
    scheduler_factory.cache_info.return_value = SimpleNamespace(currsize=int(scheduler_stop_fails))
    monkeypatch.setattr(deps, "get_scheduler_service", scheduler_factory)
    manager = MagicMock()

    async def run_lifecycle():
        async with main_module.lifespan(FastAPI()):
            deps._mcp_managers["alice"] = manager

    if scheduler_stop_fails:
        with pytest.raises(RuntimeError, match="scheduler stop failed"):
            asyncio.run(run_lifecycle())
    else:
        asyncio.run(run_lifecycle())
    manager.close_sync.assert_called_once_with()
    assert not deps._mcp_managers
