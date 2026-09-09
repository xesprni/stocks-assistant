"""多智能体运行边界的 API 校验与个人配置隔离。"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

import app.config as config_module
import app.core.app_store as app_store_module
from app.api.config import router
from app.config import Settings, get_effective_settings
from app.core.app_store import APP_DB_ENV, reset_app_store_for_tests
from app.core.security import CurrentUser, get_current_user
from app.schemas.config import ConfigUpdate

LIMITS = {
    "multi_agent_max_parallel_agents": (3, 1, 8),
    "multi_agent_max_tasks_per_batch": (12, 1, 32),
    "multi_agent_task_timeout_seconds": (180, 10, 1800),
    "multi_agent_default_max_steps": (8, 1, 100),
    "multi_agent_max_depth": (1, 0, 1),
}


@pytest.fixture
def multi_agent_config_client(tmp_path, monkeypatch):
    monkeypatch.setenv(APP_DB_ENV, str(tmp_path / "app.db"))
    monkeypatch.setattr(app_store_module, "_app_store", None)
    monkeypatch.setattr(config_module, "_config_instance", None)
    config_module.clear_effective_settings_cache()
    store = reset_app_store_for_tests()
    store.migrate_config_json_once(tmp_path / "missing-config.json")
    store.set_config_values({"workspace_dir": str(tmp_path / "workspace")})
    users = {}
    for name, admin in (("admin", True), ("alice", False), ("bob", False)):
        roles = ("admin",) if admin else ("user",)
        user = store.create_user(name, "unused-test-password", role_names=roles)
        users[name] = CurrentUser(
            id=user["id"],
            username=name,
            display_name=name,
            roles=roles,
            permissions=frozenset({"*"} if admin else {"config:read"}),
            is_active=True,
        )
    current = {"user": users["admin"]}
    app = FastAPI()
    app.include_router(router, prefix="/api/v1/config")
    app.dependency_overrides[get_current_user] = lambda: current["user"]
    with TestClient(app) as client:
        yield client, store, users, current
    config_module.clear_effective_settings_cache()


@pytest.mark.parametrize("field", LIMITS)
def test_runtime_limits_validate_defaults_boundaries_and_reject_invalid_values(field):
    default, minimum, maximum = LIMITS[field]
    assert getattr(Settings(), field) == default
    for value in (minimum, maximum):
        assert getattr(Settings(**{field: value}), field) == value
        assert getattr(ConfigUpdate(**{field: value}), field) == value
    for value in (minimum - 1, maximum + 1, minimum + 0.5):
        for model in (Settings, ConfigUpdate):
            with pytest.raises(ValidationError):
                model(**{field: value})


def test_runtime_settings_exposed_persisted_and_isolated_per_user(multi_agent_config_client):
    client, store, users, current = multi_agent_config_client
    response = client.get("/api/v1/config")
    assert response.status_code == 200
    for field, (default, _, _) in LIMITS.items():
        assert response.json()[field] == default
    system = {"multi_agent_max_tasks_per_batch": 20, "multi_agent_task_timeout_seconds": 300}
    response = client.patch("/api/v1/config", json=system)
    assert response.status_code == 200, response.text
    for field, value in system.items():
        assert response.json()[field] == value
        assert store.get_config()[field] == value
        assert getattr(get_effective_settings(users["alice"].id), field) == value

    current["user"] = users["alice"]
    personal = {"multi_agent_max_tasks_per_batch": 6, "multi_agent_task_timeout_seconds": 90}
    response = client.patch("/api/v1/config", json=personal)
    assert response.status_code == 200, response.text
    for field, value in personal.items():
        assert response.json()[field] == value
        assert field in response.json()["personal_config_keys"]
        assert store.get_user_config(users["alice"].id)[field] == value
        assert getattr(get_effective_settings(users["alice"].id), field) == value
        assert getattr(get_effective_settings(users["bob"].id), field) == system[field]


@pytest.mark.parametrize("field", LIMITS)
def test_invalid_api_patch_does_not_persist_any_field(multi_agent_config_client, field):
    client, store, users, current = multi_agent_config_client
    current["user"] = users["alice"]
    before = store.get_user_config(users["alice"].id)
    response = client.patch(
        "/api/v1/config", json={field: LIMITS[field][2] + 1, "multi_agent_enabled": False}
    )
    assert response.status_code == 422, response.text
    assert store.get_user_config(users["alice"].id) == before


def test_new_limits_do_not_grant_role_or_dangerous_tool_edit_permissions(multi_agent_config_client):
    client, store, users, current = multi_agent_config_client
    current["user"] = users["alice"]
    for field in ("multi_agent_roles", "multi_agent_dangerous_tools"):
        response = client.patch(
            "/api/v1/config", json={field: {} if field.endswith("roles") else []}
        )
        assert response.status_code == 403, response.text
        assert field not in store.get_user_config(users["alice"].id)
