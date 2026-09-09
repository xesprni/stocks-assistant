"""Requests retain one settings snapshot while shared runtime caches move forward."""

import gc
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app import deps
from app.config import Settings


@pytest.fixture
def resources(monkeypatch, tmp_path):
    old = Settings(
        workspace_dir=str(tmp_path / "old"),
        llm_model="old-llm",
        embedding_model="old-embedding",
        mcp_servers={"old": {"transport": "stdio", "command": "fixture-old"}},
    )
    new = old.model_copy(
        update={
            "workspace_dir": str(tmp_path / "new"),
            "llm_model": "new-llm",
            "embedding_model": "new-embedding",
            "mcp_servers": {"new": {"transport": "stdio", "command": "fixture-new"}},
        },
        deep=True,
    )
    state = SimpleNamespace(current=new, old=old, new=new, memories=[], mcps=[])
    monkeypatch.setattr(deps, "get_settings", lambda: state.current)
    monkeypatch.setattr(deps, "get_effective_settings", lambda user: state.current)
    monkeypatch.setattr(deps, "_user_memory_managers", {})
    monkeypatch.setattr(deps, "_memory_manager_signatures", {})
    monkeypatch.setattr(deps, "_mcp_managers", {})
    monkeypatch.setattr(deps, "_mcp_resources", {})
    monkeypatch.setattr(deps, "_mcp_manager_signatures", {})
    monkeypatch.setattr(deps, "_llm_provider_cache", {})
    deps.get_memory_manager.cache_clear()

    class Memory:
        def __init__(self, *, config, embedding_provider, llm_provider):
            self.config = config
            self.embedding_provider = embedding_provider
            self.llm_provider = llm_provider
            self.storage = SimpleNamespace(close=MagicMock())

    monkeypatch.setattr("app.core.memory.manager.MemoryManager", Memory)
    monkeypatch.setattr(deps, "create_embedding_provider_from_settings", lambda settings: settings)
    monkeypatch.setattr(deps, "create_memory_llm_provider", lambda settings: settings)

    def mcp(user_id, settings):
        manager = SimpleNamespace(
            user_id=user_id, settings=settings, close_sync=MagicMock(), get_tools=lambda: []
        )
        state.mcps.append(manager)
        return manager

    monkeypatch.setattr(deps, "_create_mcp_manager", mcp)
    yield state
    deps.close_mcp_managers()
    deps.clear_user_memory_managers()
    deps.get_memory_manager.cache_clear()
    deps.clear_llm_provider_cache()
    gc.collect()


@pytest.mark.parametrize("user_id", [None, "alice"])
def test_memory_old_snapshot_does_not_borrow_or_replace_current_instance(resources, user_id):
    shared = deps.get_memory_manager_for_user(user_id)
    with deps.lease_memory_manager_for_user(user_id, settings=resources.old) as borrowed:
        assert borrowed is not shared
        assert borrowed.config.workspace_root == resources.old.workspace_dir
        assert borrowed.config.embedding_model == "old-embedding"
        assert borrowed.embedding_provider is resources.old
        assert borrowed.llm_provider is resources.old
        assert deps.get_memory_manager_for_user(user_id) is shared
        close = borrowed.storage.close
    # 租约结束后其他在途使用者（例如异步记忆整理）仍可持有 MemoryManager。
    close.assert_not_called()
    del borrowed
    gc.collect()
    close.assert_called_once()
    shared.storage.close.assert_not_called()


@pytest.mark.parametrize("user_id", [None, "alice"])
def test_memory_matching_snapshot_reuses_shared_instance(resources, user_id):
    with (
        deps.lease_memory_manager_for_user(user_id, settings=resources.new) as first,
        deps.lease_memory_manager_for_user(user_id, settings=resources.new) as second,
    ):
        assert first is second
        assert first is deps.get_memory_manager_for_user(user_id)


def test_memory_new_snapshot_replaces_old_cache_even_before_invalidation(resources):
    resources.current = resources.old
    old = deps.get_memory_manager_for_user("alice")
    resources.current = resources.new
    with deps.lease_memory_manager_for_user("alice", settings=resources.new) as new:
        assert new is not old
        assert new.embedding_provider is resources.new
        assert deps.get_memory_manager_for_user("alice") is new
        old.storage.close.assert_not_called()


@pytest.mark.parametrize("user_id", [None, "alice"])
def test_mcp_old_snapshot_is_retired_without_replacing_new_shared_manager(resources, user_id):
    shared = deps.get_mcp_manager_for_user(user_id)
    with deps.lease_mcp_manager_for_user(user_id, settings=resources.old) as borrowed:
        assert borrowed is not shared
        assert borrowed.settings is resources.old
        assert deps.get_mcp_manager_for_user(user_id) is shared
        borrowed.close_sync.assert_not_called()
    borrowed.close_sync.assert_called_once()
    shared.close_sync.assert_not_called()
    assert id(borrowed) not in deps._mcp_resources
    assert id(borrowed) not in deps._mcp_manager_signatures


def test_mcp_new_snapshot_retires_old_manager_after_its_last_lease(resources):
    resources.current = resources.old
    with deps.lease_mcp_manager_for_user("alice", settings=resources.old) as old:
        resources.current = resources.new
        with deps.lease_mcp_manager_for_user("alice", settings=resources.new) as new:
            assert new is not old
            assert new.settings is resources.new
            old.close_sync.assert_not_called()
            assert deps.get_mcp_manager_for_user("alice") is new
        new.close_sync.assert_not_called()
    old.close_sync.assert_called_once()


def test_factory_threads_one_snapshot_through_provider_tools_memory_and_mcp(resources, monkeypatch):
    import app.core.agent.factory as factory

    recorded = []

    class ToolManager:
        def __init__(self, **kwargs):
            pass

        def load_builtin_tools(self, **kwargs):
            recorded.append(kwargs)

        def get_all_tools(self):
            return []

    provider = SimpleNamespace(call=MagicMock(), call_stream=MagicMock())
    provider_factory = MagicMock(return_value=provider)
    monkeypatch.setattr(deps, "create_llm_provider", provider_factory)
    monkeypatch.setattr(deps, "get_skill_manager", lambda: None)
    monkeypatch.setattr("app.core.tools.tool_manager.ToolManager", ToolManager)
    monkeypatch.setattr(factory, "Agent", lambda **kwargs: SimpleNamespace(**kwargs))

    agent = factory.create_agent("alice", settings=resources.old)
    try:
        assert agent.user_id == "alice"
        assert agent.settings is resources.old
        assert agent.memory_manager.embedding_provider is resources.old
        assert agent.memory_manager.llm_provider is resources.old
        assert recorded[0]["settings"] is resources.old
        assert recorded[0]["memory_manager"] is agent.memory_manager
        assert recorded[0]["user_id"] == "alice"
        assert resources.mcps[-1].settings is resources.old
        assert deps._mcp_managers == {}
        provider_factory.assert_called_once_with(resources.old)
    finally:
        agent.runtime_resources.close()
    resources.mcps[-1].close_sync.assert_called_once()


@pytest.mark.parametrize("user_id", [None, "alice"])
def test_provider_created_across_invalidation_cannot_refill_cache(resources, monkeypatch, user_id):
    started, resume = Event(), Event()
    created = []

    def create(settings):
        provider = SimpleNamespace(settings=settings)
        created.append(provider)
        if len(created) == 1:
            started.set()
            assert resume.wait(3)
        return provider

    monkeypatch.setattr(deps, "_create_llm_provider_impl", create)
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(deps.create_llm_provider, resources.old)
        assert started.wait(3)
        deps.invalidate_llm_providers(user_id)
        current = deps.create_llm_provider(resources.new)
        resume.set()
        original = pending.result(timeout=3)
    assert original.settings is resources.old
    assert deps._llm_provider_signature(resources.old) not in deps._llm_provider_cache
    assert deps.create_llm_provider(resources.new) is current
    assert deps.create_llm_provider(resources.old) is not original
    assert len(created) == 3
