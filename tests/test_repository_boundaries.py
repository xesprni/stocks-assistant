"""Regression checks for repository transactions and historical store APIs."""

import json
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import event

from app.core.app_store import AppStore
from app.core.orm.models.app import AuditEvent


def test_config_and_role_changes_roll_back_together(tmp_path):
    store = AppStore(tmp_path / "app.db")
    store.set_config_values({"app_language": "zh", "multi_agent_roles": {"analyst": {"tools": []}}})

    with pytest.raises(ValueError, match="must be an object"):
        store.set_config_values({"app_language": "en", "multi_agent_roles": {"invalid": "role"}})

    assert store.get_config()["app_language"] == "zh"
    assert store.get_subagent_roles() == {"analyst": {"tools": []}}


def test_revoke_devices_rolls_back_sessions_and_tokens_when_audit_fails(tmp_path):
    store = AppStore(tmp_path / "app.db")
    user = store.create_user("reader", "test-password-hash")
    expires = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    current = store.create_login_session(user["id"], expires_at=expires, device_id="current")
    other = store.create_login_session(user["id"], expires_at=expires, device_id="other")
    store.create_refresh_token(user["id"], "refresh-hash", expires, session_id=other["id"])

    def reject_audit(session, _context, _instances):
        if any(isinstance(row, AuditEvent) for row in session.new):
            raise RuntimeError("audit unavailable")

    event.listen(store.session_factory, "before_flush", reject_audit)
    try:
        with pytest.raises(RuntimeError, match="audit unavailable"):
            store.revoke_other_login_devices(user["id"], current_session_id=current["id"])
    finally:
        event.remove(store.session_factory, "before_flush", reject_audit)

    assert store.get_login_session(other["id"])["revoked_at"] is None
    assert store.get_refresh_token("refresh-hash")["revoked_at"] is None


def test_legacy_config_migrates_once_and_stays_encrypted(tmp_path):
    legacy = tmp_path / "config.json"
    legacy.write_text(json.dumps({"llm_api_key": "fixture-secret", "app_language": "en"}))
    store = AppStore(tmp_path / "app.db")
    assert store.migrate_config_json_once(legacy)["app_language"] == "en"
    legacy.write_text(json.dumps({"app_language": "zh"}))
    assert store.migrate_config_json_once(legacy) == {}
    assert store.get_config()["app_language"] == "en"
    with store.connect() as connection:
        value = connection.execute(
            "SELECT value_json FROM app_config WHERE key='llm_api_key'"
        ).fetchone()[0]
    assert "fixture-secret" not in value
