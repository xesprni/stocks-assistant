"""配置工作单元、缓存代次和运行时资源退休的行为回归。"""

import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from sqlalchemy import event

from app import config, deps
from app.core.app_store import AppStore
from app.core.configuration.resources import ManagedResource
from app.core.configuration.runtime import invalidate_runtime
from app.core.orm.models.app import AuditEvent


@pytest.mark.parametrize("user_id", [None, "alice"])
def test_config_read_started_before_invalidation_cannot_publish_old_value(monkeypatch, user_id):
    started, resume = threading.Event(), threading.Event()

    class Store:
        value = "old"
        first = True

        def migrate_config_json_once(self):
            pass

        def get_config(self):
            captured = self.value
            if self.first:
                self.first = False
                started.set()
                assert resume.wait(3)
            return {"llm_model": captured}

        def get_user_config(self, _user):
            return {}

    store = Store()
    monkeypatch.setattr("app.core.app_store.get_app_store", lambda: store)
    config.clear_effective_settings_cache()
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(config.get_effective_config, user_id)
        assert started.wait(3)
        store.value = "new"
        config.clear_effective_settings_cache(user_id)
        resume.set()
        assert pending.result(timeout=3)["llm_model"] == "new"
    assert config.get_effective_config(user_id)["llm_model"] == "new"
    config.clear_effective_settings_cache()


def test_personal_cache_invalidation_preserves_other_users(monkeypatch):
    store = MagicMock()
    store.get_config.return_value = {"llm_model": "shared"}
    store.get_user_config.return_value = {}
    monkeypatch.setattr("app.core.app_store.get_app_store", lambda: store)
    config.clear_effective_settings_cache()
    config.get_effective_config("alice")
    config.get_effective_config("bob")
    store.get_config.reset_mock()
    config.reset_settings_cache("alice")
    config.get_effective_config("bob")
    store.get_config.assert_not_called()
    config.get_effective_config("alice")
    store.get_config.assert_called_once()
    config.clear_effective_settings_cache()


def test_config_and_audit_are_atomic_across_system_and_user_scope(tmp_path):
    store = AppStore(tmp_path / "app.db")
    user_id = store.create_user("reader", "test-hash")["id"]
    store.set_config_values({"app_language": "zh"})
    store.set_user_config_values(user_id, {"llm_model": "old"})

    def reject_audit(session, _context, _instances):
        if any(isinstance(row, AuditEvent) for row in session.new):
            raise RuntimeError("audit unavailable")

    event.listen(store.session_factory, "before_flush", reject_audit)
    try:
        with pytest.raises(RuntimeError, match="audit unavailable"):
            store.apply_config_update(
                user_id, user_patch={"llm_model": "new"}, system_patch={"app_language": "en"}
            )
    finally:
        event.remove(store.session_factory, "before_flush", reject_audit)
    assert store.get_config()["app_language"] == "zh"
    assert store.get_user_config(user_id)["llm_model"] == "old"
    store.apply_config_update(
        user_id, user_patch={"llm_api_key": "test-secret"}, system_patch={"app_language": "en"}
    )
    assert store.get_user_config(user_id)["llm_api_key"] == "test-secret"
    with store.connect() as connection:
        audits = connection.execute("SELECT action FROM audit_events").fetchall()
        encrypted = connection.execute(
            "SELECT value_json FROM user_config WHERE key='llm_api_key'"
        ).fetchone()[0]
    assert sorted(row[0] for row in audits) == ["config.update", "config.user_update"]
    assert "test-secret" not in encrypted


def test_retired_resource_closes_once_after_all_leases_end():
    closed = MagicMock()
    resource = ManagedResource("connection", closed)
    first, second = resource.acquire(), resource.acquire()
    resource.retire()
    first.close()
    first.close()
    closed.assert_not_called()
    with pytest.raises(RuntimeError, match="retired"):
        resource.acquire()
    second.close()
    resource.retire()
    closed.assert_called_once()


def test_mcp_update_replaces_cache_without_interrupting_borrower(monkeypatch):
    old, replacement, bob = MagicMock(), MagicMock(), MagicMock()
    monkeypatch.setattr(deps, "_mcp_managers", {"alice": old, "bob": bob})
    monkeypatch.setattr(deps, "_mcp_resources", {})
    monkeypatch.setattr(deps, "_create_mcp_manager", lambda *_args: replacement)
    with deps.lease_mcp_manager_for_user("alice") as borrowed:
        invalidate_runtime({"mcp_servers": {}}, user_id="alice")
        assert borrowed is old
        old.close_sync.assert_not_called()
        assert deps.get_mcp_manager_for_user("alice") is replacement
        assert deps.get_mcp_manager_for_user("bob") is bob
    old.close_sync.assert_called_once()
    deps.close_mcp_managers()
    replacement.close_sync.assert_called_once()
    bob.close_sync.assert_called_once()


def test_lifespan_stops_scheduler_enabled_after_startup(monkeypatch, tmp_path):
    import app.core.agent.run_service as runs
    import app.main as main

    monkeypatch.setattr(runs, "chat_runs", runs.ChatRunManager())

    scheduler = SimpleNamespace(start=AsyncMock(), stop=AsyncMock())

    @lru_cache
    def scheduler_factory():
        return scheduler

    monkeypatch.setattr(deps, "get_scheduler_service", scheduler_factory)
    monkeypatch.setattr(main, "setup_logging", lambda **kwargs: None)
    monkeypatch.setattr(
        main,
        "get_settings",
        lambda: config.Settings(workspace_dir=str(tmp_path), scheduler_enabled=False),
    )

    async def run():
        async with main.lifespan(FastAPI()):
            await deps.get_scheduler_service().start()

    asyncio.run(run())
    scheduler.stop.assert_awaited_once()
    assert scheduler_factory.cache_info().currsize == 0


def test_shutdown_releases_other_resources_when_chat_cleanup_fails(monkeypatch):
    import app.core.agent.run_service as runs
    import app.core.llm.provider as providers
    from app.core.configuration.lifecycle import shutdown_runtime

    monkeypatch.setattr(runs, "chat_runs", SimpleNamespace(close=MagicMock(side_effect=OSError)))
    scheduler = SimpleNamespace(stop=AsyncMock())

    @lru_cache
    def scheduler_factory():
        return scheduler

    scheduler_factory()
    monkeypatch.setattr(deps, "get_scheduler_service", scheduler_factory)
    close_mcp, close_http = MagicMock(), MagicMock()
    monkeypatch.setattr(deps, "close_mcp_managers", close_mcp)
    monkeypatch.setattr(providers, "close_llm_client_pool", close_http)
    with pytest.raises(OSError):
        asyncio.run(shutdown_runtime())
    scheduler.stop.assert_awaited_once()
    close_mcp.assert_called_once()
    close_http.assert_called_once()
    assert scheduler_factory.cache_info().currsize == 0
