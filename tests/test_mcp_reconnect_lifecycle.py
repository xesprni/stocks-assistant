"""手动重连只启动一次新连接，并保留其他用户及在途调用的连接。"""

from contextlib import ExitStack
from types import SimpleNamespace

import pytest

from app import deps
from app.api import mcp as mcp_api
from app.config import Settings
from app.core.tools.mcp import mcp_tool


@pytest.mark.parametrize("warm", [False, True], ids=["cold-user", "active-user-lease"])
def test_reconnect_starts_each_new_manager_once_and_preserves_active_leases(
    tmp_path, monkeypatch, warm
):
    deps.close_mcp_managers()
    created = []

    class FakeManager:
        def __init__(self, *, server_configs, workspace_dir, tool_timeout_seconds, user_id):
            self.server_configs = server_configs
            self.workspace_dir = workspace_dir
            self.tool_timeout_seconds = tool_timeout_seconds
            self.user_id = user_id
            self.connect_calls = 0
            self.reconnect_calls = 0
            self.close_calls = 0
            self._token_store = None
            created.append(self)

        def connect_all_background(self):
            self.connect_calls += 1

        def reconnect_background(self, server_configs):
            self.reconnect_calls += 1
            self.server_configs = server_configs
            self.connect_all_background()

        def get_server_state(self, name):
            assert self.close_calls == 0
            return "connecting", None, 0, None

        def close_sync(self):
            self.close_calls += 1

    settings = Settings(
        workspace_dir=str(tmp_path),
        mcp_servers={"demo": {"transport": "streamable_http", "url": "https://example.test/mcp"}},
    )
    monkeypatch.setattr(mcp_tool, "MCPManager", FakeManager)
    monkeypatch.setattr(deps, "get_effective_settings", lambda user_id: settings)
    monkeypatch.setattr(mcp_api, "get_effective_settings", lambda user_id: settings)
    user = SimpleNamespace(id="reconnecting-user")
    unrelated = deps.get_mcp_manager_for_user("other-user")
    old = None

    with ExitStack() as leases:
        if warm:
            old = leases.enter_context(deps.lease_mcp_manager_for_user(user.id, settings=settings))

        response = mcp_api.reconnect_mcp_servers(user)
        first = deps.get_mcp_manager_for_user(user.id)
        assert response.total == 1
        assert response.servers[0].name == "demo"
        assert response.servers[0].status == "connecting"
        assert first is not old
        assert first.connect_calls == 1
        assert first.reconnect_calls == 0
        assert first.close_calls == 0
        if old is not None:
            assert old.close_calls == 0

        mcp_api.reconnect_mcp_servers(user)
        second = deps.get_mcp_manager_for_user(user.id)
        assert second is not first
        assert second.connect_calls == 1
        assert second.reconnect_calls == 0
        assert first.close_calls == 1
        assert deps.get_mcp_manager_for_user("other-user") is unrelated
        assert unrelated.close_calls == 0

    if old is not None:
        assert old.close_calls == 1
    assert len([manager for manager in created if manager.user_id == user.id]) == (3 if warm else 2)
    assert all(manager.connect_calls == 1 for manager in created)
    deps.close_mcp_managers()
    assert all(manager.close_calls == 1 for manager in created)
