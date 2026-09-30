"""自选分组的持久化、权限与旧数据库兼容回归。"""

import sqlite3
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import watchlist as watchlist_api
from app.core.orm.repositories.watchlist import WatchlistRepository
from app.core.security import CurrentUser, get_current_user
from app.core.serialization import to_payload
from app.core.watchlist.service import WatchlistService
from app.schemas.watchlist import WatchlistItemCreate


@pytest.fixture
def group_api(tmp_path):
    service = WatchlistService(str(tmp_path))
    app = FastAPI()
    app.include_router(watchlist_api.router, prefix="/api/v1/watchlist")
    identity = {"id": "alice", "permissions": {"watchlist:read", "watchlist:write"}}
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        id=identity["id"],
        username=identity["id"],
        display_name="Test",
        roles=(),
        permissions=frozenset(identity["permissions"]),
        is_active=True,
    )
    with (
        patch.object(watchlist_api, "get_watchlist_service", return_value=service),
        TestClient(app) as client,
    ):
        yield client, service, identity
    service.repository.engine.dispose()


def test_group_lifecycle_and_membership_cascades(group_api):
    client, service, _ = group_api
    apple = to_payload(service.add_item(WatchlistItemCreate(category="US", symbol="AAPL"), "alice"))
    tencent = to_payload(service.add_item(WatchlistItemCreate(category="H", symbol="700"), "alice"))
    response = client.post("/api/v1/watchlist/groups", json={"name": "  核心关注  "})
    assert response.status_code == 200
    group = response.json()["groups"][0]
    assert group["name"] == "核心关注"
    path = f"/api/v1/watchlist/groups/{group['id']}"
    response = client.put(
        path + "/members", json={"item_ids": [apple["id"], tencent["id"], apple["id"]]}
    )
    assert response.status_code == 200
    assert response.json()["groups"][0]["item_ids"] == [apple["id"], tencent["id"]]
    assert client.patch(path, json={"name": "长期"}).json()["groups"][0]["name"] == "长期"
    second = client.post("/api/v1/watchlist/groups", json={"name": "科技"}).json()["groups"][1]
    service.set_group_members(second["id"], [apple["id"]], "alice")
    # 重开数据库仍保留跨市场、多分组的成员关系。
    reopened = WatchlistRepository(service.db_path)
    assert to_payload(reopened.list_groups("alice"))[0]["item_ids"] == [apple["id"], tencent["id"]]
    reopened.engine.dispose()
    assert client.delete(path).status_code == 200
    assert len(to_payload(service.list_items(user_id="alice"))) == 2
    assert to_payload(service.list_groups("alice"))[0]["item_ids"] == [apple["id"]]
    assert client.delete(f"/api/v1/watchlist/{apple['id']}").status_code == 200
    assert to_payload(service.list_groups("alice"))[0]["item_ids"] == []


def test_group_ownership_validation_and_atomic_failure(group_api):
    client, service, identity = group_api
    owned = to_payload(service.add_item(WatchlistItemCreate(category="US", symbol="AAPL"), "alice"))
    foreign = to_payload(service.add_item(WatchlistItemCreate(category="US", symbol="MSFT"), "bob"))
    group = client.post("/api/v1/watchlist/groups", json={"name": "同名"}).json()["groups"][0]
    path = f"/api/v1/watchlist/groups/{group['id']}"
    assert client.put(path + "/members", json={"item_ids": [owned["id"]]}).status_code == 200
    for bad_id in [foreign["id"], 999999]:
        assert client.put(path + "/members", json={"item_ids": [bad_id]}).status_code == 400
        assert to_payload(service.list_groups("alice"))[0]["item_ids"] == [owned["id"]]
    identity["id"] = "bob"
    assert client.get("/api/v1/watchlist/groups").json() == {"groups": []}
    assert client.patch(path, json={"name": "盗改"}).status_code == 404
    assert client.delete(path).status_code == 404
    assert client.put(path + "/members", json={"item_ids": [foreign["id"]]}).status_code == 404
    assert client.post("/api/v1/watchlist/groups", json={"name": "同名"}).status_code == 200
    identity["permissions"] = {"watchlist:read"}
    assert client.get("/api/v1/watchlist/groups").status_code == 200
    assert client.post("/api/v1/watchlist/groups", json={"name": "不可写"}).status_code == 403
    assert client.patch(path, json={"name": "不可写"}).status_code == 403
    assert client.put(path + "/members", json={"item_ids": []}).status_code == 403
    assert client.delete(path).status_code == 403
    identity["permissions"] = set()
    assert client.get("/api/v1/watchlist/groups").status_code == 403


def test_group_name_and_member_validation(group_api):
    client, _, _ = group_api
    for name in ["", "   ", "长" * 41]:
        assert client.post("/api/v1/watchlist/groups", json={"name": name}).status_code == 422
    group = client.post("/api/v1/watchlist/groups", json={"name": "有效"}).json()["groups"][0]
    assert client.post("/api/v1/watchlist/groups", json={"name": " 有效 "}).status_code == 400
    path = f"/api/v1/watchlist/groups/{group['id']}"
    assert client.put(path + "/members", json={"item_ids": [-1]}).status_code == 422
    assert client.put(path + "/members", json={"item_ids": [1] * 2001}).status_code == 422
    assert client.put(path + "/members", json={"item_ids": []}).status_code == 200


def test_legacy_watchlist_upgrade_keeps_items_and_valid_group_foreign_keys(tmp_path):
    path = tmp_path / "legacy.db"
    with sqlite3.connect(path) as conn:
        conn.executescript("""
            CREATE TABLE watchlist_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL,
                symbol TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '',
                name_cn TEXT NOT NULL DEFAULT '', name_en TEXT NOT NULL DEFAULT '',
                name_hk TEXT NOT NULL DEFAULT '', exchange TEXT NOT NULL DEFAULT '',
                currency TEXT NOT NULL DEFAULT '', last_done TEXT, change_value TEXT,
                change_rate TEXT, note TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            INSERT INTO watchlist_items (category, symbol, created_at, updated_at)
            VALUES ('US', 'AAPL.US', '2020-01-01', '2020-01-01');
        """)
    repository = WatchlistRepository(path)
    assert to_payload(repository.list_items())[0]["symbol"] == "AAPL.US"
    group_id = repository.save_group("legacy", "")
    repository.set_group_members(group_id, [1], "")
    assert to_payload(repository.list_groups(""))[0]["item_ids"] == [1]
    repository.delete_item(1)
    assert to_payload(repository.list_groups(""))[0]["item_ids"] == []
    with sqlite3.connect(path) as conn:
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    repository.engine.dispose()
