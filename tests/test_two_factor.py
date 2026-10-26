"""2FA 的完整协议、安全边界、旧库升级和一次性消费回归。"""

import base64
import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import config
from app.constants.security import TOTP_PERIOD_SECONDS, TWO_FACTOR_LOCK_SECONDS
from app.core import app_store
from app.core.security import create_access_token, hash_password, verify_password
from app.core.two_factor import service
from app.core.two_factor.totp import code_at_step, matching_step
from app.main import app


@pytest.fixture
def account(tmp_path, monkeypatch):
    store = app_store.AppStore(tmp_path / "app.db")
    monkeypatch.setattr(app_store, "_app_store", store)
    monkeypatch.setattr(config, "_config_instance", None)
    store.set_config_values({"workspace_dir": str(tmp_path / "workspace")})
    now = [1_800_000_000]
    monkeypatch.setattr(service, "time", SimpleNamespace(time=lambda: now[0]))
    with TestClient(app) as client:
        tokens = client.post(
            "/api/v1/auth/setup",
            json={
                "username": "admin",
                "password": "Password123!",
                "device_id": "original",
            },
        ).json()
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}
        yield SimpleNamespace(
            store=store,
            client=client,
            tokens=tokens,
            headers=headers,
            now=now,
            user_id=tokens["user"]["id"],
            password="Password123!",
        )
    store.engine.dispose()
    config.clear_effective_settings_cache()


def start(account):
    response = account.client.post(
        "/api/v1/auth/me/two-factor/setup",
        headers=account.headers,
        json={"current_password": account.password},
    )
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    return response.json()


def enable(account):
    setup = start(account)
    code = code_at_step(setup["secret"], account.now[0] // TOTP_PERIOD_SECONDS)
    response = account.client.post(
        "/api/v1/auth/me/two-factor/enable",
        headers=account.headers,
        json={"current_password": account.password, "code": code},
    )
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    return setup["secret"], code, response.json()["recovery_codes"]


def login(account, code=None, password=None):
    payload = {"username": "admin", "password": password or account.password, "device_id": "next"}
    if code is not None:
        payload["two_factor_code"] = code
    return account.client.post("/api/v1/auth/login", json=payload)


def test_rfc_vectors_and_window():
    secret = base64.b32encode(b"12345678901234567890").decode()
    # RFC 4226 附录 D 的六位测试向量，独立于验证函数生成预期值。
    assert [code_at_step(secret, step) for step in range(10)] == [
        "755224",
        "287082",
        "359152",
        "969429",
        "338314",
        "254676",
        "287922",
        "162583",
        "399871",
        "520489",
    ]
    # RFC 6238 SHA1 向量按项目的六位输出截取。
    for timestamp, code in [
        (59, "287082"),
        (1111111109, "081804"),
        (1111111111, "050471"),
        (1234567890, "005924"),
        (2000000000, "279037"),
        (20000000000, "353130"),
    ]:
        assert code_at_step(secret, timestamp // 30) == code
    assert matching_step(secret, "287082", 59) == 1
    assert matching_step(secret, "287082", 59, 1) is None
    assert matching_step(secret, "287082", 90) is None
    assert matching_step(secret, "２８７０８２", 59) is None


def test_setup_is_confirmed_expiring_encrypted_and_private(account):
    denied = account.client.post(
        "/api/v1/auth/me/two-factor/setup", json={"current_password": account.password}
    )
    assert denied.status_code == 401
    wrong = account.client.post(
        "/api/v1/auth/me/two-factor/setup",
        headers=account.headers,
        json={"current_password": "incorrect"},
    )
    assert wrong.status_code == 400
    setup = start(account)
    assert setup["provisioning_uri"].startswith("otpauth://totp/Stocks%20Assistant%3Aadmin?")
    assert (
        account.client.get("/api/v1/auth/me", headers=account.headers).json()["two_factor_enabled"]
        is False
    )
    assert login(account).status_code == 200
    with account.store.connect() as conn:
        raw = conn.execute("SELECT * FROM user_two_factor").fetchone()
        assert raw["pending_secret_encrypted"] != setup["secret"]
        assert setup["secret"] not in str(dict(raw))
    account.now[0] = setup["expires_at"]
    expired = account.client.post(
        "/api/v1/auth/me/two-factor/enable",
        headers=account.headers,
        json={
            "current_password": account.password,
            "code": code_at_step(setup["secret"], account.now[0] // 30),
        },
    )
    assert expired.status_code == 400
    secret, _, codes = enable(account)
    for endpoint in ["/api/v1/auth/me", "/api/v1/users", "/api/v1/config"]:
        response = account.client.get(endpoint, headers=account.headers)
        assert secret not in response.text and codes[0] not in response.text
    with account.store.connect() as conn:
        assert secret not in str(
            [dict(row) for row in conn.execute("SELECT * FROM user_two_factor")]
        )
        assert codes[0].replace("-", "") not in str(
            [dict(row) for row in conn.execute("SELECT * FROM user_two_factor")]
        )
        audit = str([dict(row) for row in conn.execute("SELECT * FROM audit_events")])
        assert secret not in audit and codes[0] not in audit and account.password not in audit


def test_login_requires_2fa_before_tokens_or_touch_login(account):
    secret, used, codes = enable(account)
    with account.store.connect() as conn:
        before = conn.execute("SELECT COUNT(*) FROM login_sessions").fetchone()[0]
    last_login = account.store.get_user_by_id(account.user_id)["last_login_at"]
    for response in [login(account), login(account, "wrong"), login(account, used)]:
        assert response.status_code == 400
        assert "access_token" not in response.json() and "refresh_token" not in response.json()
    assert login(account, codes[0], password="wrong").status_code == 401
    assert account.store.get_user_by_id(account.user_id)["last_login_at"] == last_login
    with account.store.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM login_sessions").fetchone()[0] == before
    account.now[0] += 30
    response = login(account, code_at_step(secret, account.now[0] // 30))
    assert response.status_code == 200, response.text
    assert response.json()["user"]["two_factor_enabled"] is True
    assert (
        account.client.post(
            "/api/v1/auth/refresh", json={"refresh_token": response.json()["refresh_token"]}
        ).status_code
        == 200
    )
    assert login(account, codes[0]).status_code == 200
    assert login(account, codes[0]).status_code == 400


def test_password_change_and_disable_require_2fa(account):
    _, _, codes = enable(account)
    payload = {"current_password": account.password, "new_password": "Changed123!"}
    for code in [None, "bad"]:
        result = account.client.patch(
            "/api/v1/auth/me/password",
            headers=account.headers,
            json={**payload, "two_factor_code": code},
        )
        assert result.status_code == 400
        assert verify_password(
            account.password, account.store.get_user_by_id(account.user_id)["password_hash"]
        )
    result = account.client.patch(
        "/api/v1/auth/me/password",
        headers=account.headers,
        json={**payload, "two_factor_code": codes[0]},
    )
    assert result.status_code == 200, result.text
    assert login(account, codes[1]).status_code == 401
    account.password = payload["new_password"]
    assert login(account, codes[1]).status_code == 200
    for code, password in [("bad", account.password), (codes[2], "wrong")]:
        assert (
            account.client.post(
                "/api/v1/auth/me/two-factor/disable",
                headers=account.headers,
                json={"current_password": password, "code": code},
            ).status_code
            == 400
        )
    result = account.client.post(
        "/api/v1/auth/me/two-factor/disable",
        headers=account.headers,
        json={"current_password": account.password, "code": codes[2]},
    )
    assert result.status_code == 200, result.text
    assert login(account).status_code == 200
    assert not account.store.two_factor.is_enabled(account.user_id)
    with account.store.connect() as conn:
        state = conn.execute("SELECT * FROM user_two_factor").fetchone()
        assert state["secret_encrypted"] is None and json.loads(state["recovery_hashes"]) == []


def test_rate_limit_survives_restart_and_covers_management(account):
    _, _, codes = enable(account)
    for _ in range(4):
        assert login(account, "bad").status_code == 400
    assert login(account, "bad").status_code == 429
    # 重建仓储模拟进程重启，不得丢失限流或一次性码状态。
    app_store._app_store = app_store.AppStore(account.store.db_path)
    assert login(account, codes[0]).status_code == 429
    assert (
        account.client.post(
            "/api/v1/auth/me/two-factor/disable",
            headers=account.headers,
            json={"current_password": account.password, "code": codes[0]},
        ).status_code
        == 429
    )
    account.now[0] += TWO_FACTOR_LOCK_SECONDS
    assert login(account, codes[0]).status_code == 200


@pytest.mark.parametrize("recovery", [True, False])
def test_concurrent_replay_only_succeeds_once(account, recovery):
    secret, _, codes = enable(account)
    account.now[0] += 30
    code = codes[0] if recovery else code_at_step(secret, account.now[0] // 30)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: login(account, code), range(2)))
    assert sorted(response.status_code for response in responses) == [200, 400]


def test_no_dev_admin_legacy_or_other_session_bypass(account, monkeypatch):
    other = login(account).json()
    legacy = create_access_token(account.store.get_user_by_id(account.user_id))
    enable(account)
    for token in [other["access_token"], legacy]:
        assert (
            account.client.get(
                "/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}
            ).status_code
            == 401
        )
    assert (
        account.client.post(
            "/api/v1/auth/refresh", json={"refresh_token": other["refresh_token"]}
        ).status_code
        == 401
    )
    assert (
        account.client.patch(
            f"/api/v1/users/{account.user_id}",
            headers=account.headers,
            json={"password": "Bypass123!"},
        ).status_code
        == 400
    )
    monkeypatch.setenv("STOCKS_ASSISTANT_DEV_AUTH", "1")
    monkeypatch.setenv("STOCKS_ASSISTANT_DEV_AUTH_USERNAME", "admin")
    assert account.client.post("/api/v1/auth/dev-login").status_code == 403


def test_old_database_upgrades_idempotently_without_enabling_2fa(tmp_path):
    path = tmp_path / "legacy.db"
    store = app_store.AppStore(path)
    user = store.create_user("legacy", hash_password("Password123!"))
    store.engine.dispose()
    with sqlite3.connect(path) as conn:
        conn.execute("DROP TABLE user_two_factor")
    for _ in range(2):
        upgraded = app_store.AppStore(path)
        assert not upgraded.two_factor.is_enabled(user["id"])
        assert verify_password("Password123!", upgraded.get_user_by_id(user["id"])["password_hash"])
        upgraded.engine.dispose()


def test_user_cannot_change_another_accounts_factor(account):
    user = account.store.create_user("second", hash_password("Password123!"))
    setup = start(account)
    second = account.client.post(
        "/api/v1/auth/login", json={"username": "second", "password": "Password123!"}
    ).json()
    response = account.client.post(
        "/api/v1/auth/me/two-factor/enable",
        headers={"Authorization": f"Bearer {second['access_token']}"},
        json={
            "current_password": "Password123!",
            "code": code_at_step(setup["secret"], account.now[0] // 30),
            "user_id": account.user_id,
        },
    )
    assert response.status_code == 400
    assert not account.store.two_factor.is_enabled(user["id"])
    assert not account.store.two_factor.is_enabled(account.user_id)


def test_confirmation_cannot_be_skipped_or_overwrite_active_binding(account):
    setup = start(account)
    response = account.client.post(
        "/api/v1/auth/me/two-factor/enable",
        headers=account.headers,
        json={"current_password": account.password, "code": "wrong"},
    )
    assert response.status_code == 400
    assert not account.store.two_factor.is_enabled(account.user_id)
    secret, _, codes = enable(account)
    assert len(codes) == len(set(codes)) == 10
    assert secret != setup["secret"]
    response = account.client.post(
        "/api/v1/auth/me/two-factor/setup",
        headers=account.headers,
        json={"current_password": account.password},
    )
    assert response.status_code == 409
    response = account.client.post(
        "/api/v1/auth/me/two-factor/enable",
        headers=account.headers,
        json={"current_password": account.password, "code": codes[0]},
    )
    assert response.status_code == 409
    assert login(account, codes[0]).status_code == 200


def test_old_codes_stay_invalid_after_disable_and_reenrollment(account):
    _, _, old_codes = enable(account)
    response = account.client.post(
        "/api/v1/auth/me/two-factor/disable",
        headers=account.headers,
        json={"current_password": account.password, "code": old_codes[0]},
    )
    assert response.status_code == 200
    response = account.client.patch(
        "/api/v1/auth/me/password",
        headers=account.headers,
        json={"current_password": account.password, "new_password": "Changed123!"},
    )
    assert response.status_code == 200
    account.password = "Changed123!"
    _, _, new_codes = enable(account)
    assert login(account, old_codes[1]).status_code == 400
    assert login(account, new_codes[0]).status_code == 200
