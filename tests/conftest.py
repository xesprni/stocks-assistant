"""Keep test defaults away from application data and legacy local configuration."""

from collections.abc import Iterator
from unittest.mock import Mock

import pytest


@pytest.fixture(scope="session", autouse=True)
def isolated_application_defaults(tmp_path_factory: pytest.TempPathFactory) -> Iterator[None]:
    sandbox = tmp_path_factory.mktemp("application")
    with pytest.MonkeyPatch.context() as patch:
        # 测试自身可以继续覆盖配置；默认值始终指向临时工作区。
        patch.chdir(sandbox)
        patch.setenv("STOCKS_ASSISTANT_DB_PATH", str(sandbox / "app.db"))
        from app import config
        from app.core import app_store

        patch.setattr(app_store, "_app_store", None)
        patch.setattr(config, "_config_instance", None)
        config.clear_effective_settings_cache()
        store = app_store.get_app_store()
        store.set_config_values({"workspace_dir": str(sandbox / "workspace")})
        yield
        config.clear_effective_settings_cache()


@pytest.fixture(autouse=True)
def isolated_mcp_transports(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    from app.deps import close_mcp_managers

    # 配置接口会后台重连。默认阻止网络和子进程；协议测试显式提供自己的传输替身。
    for transport in (
        "mcp.client.streamable_http.streamablehttp_client",
        "mcp.client.sse.sse_client",
        "mcp.client.stdio.stdio_client",
    ):
        monkeypatch.setattr(
            transport, Mock(side_effect=RuntimeError("Tests must provide a fake MCP transport"))
        )
    try:
        yield
    finally:
        # 测试不启动 lifespan，也必须等连接线程退出，避免影响后续测试。
        close_mcp_managers()
