import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import app.config as config_module
import app.core.app_store as app_store_module
from app.core.tracing import TraceStore
from app.core.app_store import APP_DB_ENV, reset_app_store_for_tests
from app.core.security import create_access_token, hash_password, hash_refresh_token, verify_password
from app.deps import get_session_store, get_trace_store
from app.main import app


class AuthSecurityTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old_db_path = os.environ.get(APP_DB_ENV)
        self.db_path = Path(self.tmp.name) / "app.db"
        self.workspace = Path(self.tmp.name) / "workspace"
        os.environ[APP_DB_ENV] = str(self.db_path)
        self.store = reset_app_store_for_tests(self.db_path)
        self.store.set_config_values({"workspace_dir": str(self.workspace)})
        config_module._config_instance = None
        get_session_store.cache_clear()
        get_trace_store.cache_clear()
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        config_module._config_instance = None
        get_session_store.cache_clear()
        get_trace_store.cache_clear()
        app_store_module._app_store = None
        if self.old_db_path is None:
            os.environ.pop(APP_DB_ENV, None)
        else:
            os.environ[APP_DB_ENV] = self.old_db_path
        self.tmp.cleanup()

    def setup_admin(self):
        response = self.client.post(
            "/api/v1/auth/setup",
            json={"username": "admin", "password": "Password123!", "display_name": "Admin"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_password_hash_round_trip(self):
        password_hash = hash_password("Password123!")
        self.assertTrue(verify_password("Password123!", password_hash))
        self.assertFalse(verify_password("wrong-password", password_hash))

    def test_setup_only_once_and_protected_api_requires_token(self):
        unauthorized = self.client.get("/api/v1/config")
        self.assertEqual(unauthorized.status_code, 503)
        self.assertTrue(unauthorized.json()["setup_required"])

        tokens = self.setup_admin()
        duplicate = self.client.post(
            "/api/v1/auth/setup",
            json={"username": "another", "password": "Password123!", "display_name": "Another"},
        )
        self.assertEqual(duplicate.status_code, 409)

        protected = self.client.get("/api/v1/config")
        self.assertEqual(protected.status_code, 401)

        authenticated = self.client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
        )
        self.assertEqual(authenticated.status_code, 200)
        self.assertEqual(authenticated.json()["username"], "admin")

    def test_refresh_token_rotation_revokes_previous_token(self):
        tokens = self.setup_admin()

        rotated = self.client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
        self.assertEqual(rotated.status_code, 200, rotated.text)
        next_refresh = rotated.json()["refresh_token"]

        old_record = self.store.get_refresh_token(hash_refresh_token(tokens["refresh_token"]))
        self.assertIsNotNone(old_record)
        self.assertIsNotNone(old_record["revoked_at"])

        replay = self.client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
        self.assertEqual(replay.status_code, 401)

        logout = self.client.post("/api/v1/auth/logout", json={"refresh_token": next_refresh})
        self.assertEqual(logout.status_code, 200)
        after_logout = self.client.post("/api/v1/auth/refresh", json={"refresh_token": next_refresh})
        self.assertEqual(after_logout.status_code, 401)

    def test_profile_update_stores_avatar_data_url(self):
        tokens = self.setup_admin()
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}
        avatar = "data:image/png;base64,iVBORw0KGgo="

        response = self.client.patch(
            "/api/v1/auth/me/profile",
            headers=headers,
            json={"display_name": "Admin User", "avatar_base64": avatar},
        )

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["display_name"], "Admin User")
        self.assertEqual(payload["avatar_base64"], avatar)

        me = self.client.get("/api/v1/auth/me", headers=headers)
        self.assertEqual(me.status_code, 200, me.text)
        self.assertEqual(me.json()["avatar_base64"], avatar)

    def test_profile_update_rejects_non_image_avatar(self):
        tokens = self.setup_admin()
        response = self.client.patch(
            "/api/v1/auth/me/profile",
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
            json={"avatar_base64": "data:text/plain;base64,SGVsbG8="},
        )

        self.assertEqual(response.status_code, 400)

    def test_login_sessions_are_listed_and_can_be_revoked(self):
        tokens = self.setup_admin()
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}

        listed = self.client.get("/api/v1/auth/sessions", headers=headers)
        self.assertEqual(listed.status_code, 200, listed.text)
        body = listed.json()
        self.assertEqual(body["max_lifetime_days"], 30)
        self.assertEqual(body["max_devices_per_user"], 5)
        self.assertEqual(body["refresh_token_days"], 7)
        self.assertEqual(len(body["sessions"]), 1)
        session = body["sessions"][0]
        self.assertTrue(session["is_current"])
        self.assertTrue(session["is_active"])

        revoked = self.client.delete(f"/api/v1/auth/sessions/{session['id']}", headers=headers)
        self.assertEqual(revoked.status_code, 200, revoked.text)
        self.assertTrue(revoked.json()["revoked_current"])

        blocked = self.client.get("/api/v1/auth/me", headers=headers)
        self.assertEqual(blocked.status_code, 401)
        refresh = self.client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
        self.assertEqual(refresh.status_code, 401)

    def test_same_device_relogin_is_listed_as_one_device(self):
        response = self.client.post(
            "/api/v1/auth/setup",
            json={"username": "admin", "password": "Password123!", "display_name": "Admin", "device_id": "browser-1"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        first_tokens = response.json()

        logout = self.client.post("/api/v1/auth/logout", json={"refresh_token": first_tokens["refresh_token"]})
        self.assertEqual(logout.status_code, 200, logout.text)

        second = self.client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "Password123!", "device_id": "browser-1"},
        )
        self.assertEqual(second.status_code, 200, second.text)
        headers = {"Authorization": f"Bearer {second.json()['access_token']}"}

        listed = self.client.get("/api/v1/auth/sessions", headers=headers)
        self.assertEqual(listed.status_code, 200, listed.text)
        sessions = listed.json()["sessions"]
        self.assertEqual(len(sessions), 1)
        self.assertEqual(sessions[0]["id"], "browser-1")
        self.assertEqual(sessions[0]["device_id"], "browser-1")
        self.assertEqual(sessions[0]["session_count"], 2)
        self.assertEqual(len(sessions[0]["records"]), 2)
        self.assertTrue(sessions[0]["is_active"])
        self.assertTrue(sessions[0]["is_current"])

        old_record = next(record for record in sessions[0]["records"] if not record["is_current"])
        deleted = self.client.delete(f"/api/v1/auth/sessions/browser-1/records/{old_record['id']}", headers=headers)
        self.assertEqual(deleted.status_code, 200, deleted.text)
        self.assertFalse(deleted.json()["deleted_current"])

        relisted = self.client.get("/api/v1/auth/sessions", headers=headers)
        self.assertEqual(relisted.status_code, 200, relisted.text)
        self.assertEqual(relisted.json()["sessions"][0]["session_count"], 1)

    def test_admin_lists_all_user_login_devices(self):
        admin_tokens = self.setup_admin()
        admin_headers = {"Authorization": f"Bearer {admin_tokens['access_token']}"}
        created = self.client.post(
            "/api/v1/users",
            json={
                "username": "trader",
                "password": "Password123!",
                "display_name": "Trader",
                "roles": ["user"],
            },
            headers=admin_headers,
        )
        self.assertEqual(created.status_code, 200, created.text)
        trader_user_id = created.json()["id"]

        user_login = self.client.post(
            "/api/v1/auth/login",
            json={"username": "trader", "password": "Password123!", "device_id": "trader-laptop"},
        )
        self.assertEqual(user_login.status_code, 200, user_login.text)
        user_headers = {"Authorization": f"Bearer {user_login.json()['access_token']}"}

        admin_list = self.client.get("/api/v1/auth/sessions", headers=admin_headers)
        self.assertEqual(admin_list.status_code, 200, admin_list.text)
        admin_sessions = admin_list.json()["sessions"]
        self.assertIn("admin", {session["username"] for session in admin_sessions})
        self.assertIn("trader", {session["username"] for session in admin_sessions})

        user_list = self.client.get("/api/v1/auth/sessions", headers=user_headers)
        self.assertEqual(user_list.status_code, 200, user_list.text)
        self.assertEqual({session["username"] for session in user_list.json()["sessions"]}, {"trader"})

        deleted = self.client.delete(
            f"/api/v1/auth/sessions/trader-laptop/device?user_id={trader_user_id}",
            headers=admin_headers,
        )
        self.assertEqual(deleted.status_code, 200, deleted.text)
        self.assertEqual(deleted.json()["deleted"], 1)

        blocked = self.client.get("/api/v1/auth/me", headers=user_headers)
        self.assertEqual(blocked.status_code, 401)

        admin_list_after_delete = self.client.get("/api/v1/auth/sessions", headers=admin_headers)
        self.assertEqual(admin_list_after_delete.status_code, 200, admin_list_after_delete.text)
        self.assertNotIn("trader", {session["username"] for session in admin_list_after_delete.json()["sessions"]})

    def test_device_heartbeat_updates_online_status(self):
        tokens = self.client.post(
            "/api/v1/auth/setup",
            json={"username": "admin", "password": "Password123!", "display_name": "Admin", "device_id": "browser-1"},
        ).json()
        headers = {"Authorization": f"Bearer {tokens['access_token']}", "X-Device-Id": "browser-1"}
        old_seen = (datetime.now(timezone.utc) - timedelta(minutes=10)).replace(microsecond=0).isoformat()
        with self.store.connect() as conn:
            conn.execute("UPDATE login_sessions SET last_seen_at = ? WHERE device_id = ?", (old_seen, "browser-1"))
            conn.commit()

        before = self.client.get("/api/v1/auth/sessions", headers=headers)
        self.assertEqual(before.status_code, 200, before.text)
        self.assertFalse(before.json()["sessions"][0]["is_online"])

        heartbeat = self.client.post("/api/v1/auth/device/heartbeat", headers=headers)
        self.assertEqual(heartbeat.status_code, 200, heartbeat.text)
        self.assertEqual(heartbeat.json()["device_id"], "browser-1")
        self.assertTrue(heartbeat.json()["is_online"])

        after = self.client.get("/api/v1/auth/sessions", headers=headers)
        self.assertEqual(after.status_code, 200, after.text)
        session = after.json()["sessions"][0]
        self.assertEqual(session["device_id"], "browser-1")
        self.assertTrue(session["is_online"])
        self.assertTrue(session["is_active"])

    def test_heartbeat_tracks_legacy_token_without_session_id(self):
        user = self.store.create_user(
            username="legacy",
            password_hash=hash_password("Password123!"),
            display_name="Legacy",
            role_names=["user"],
        )
        token = create_access_token(user)
        headers = {"Authorization": f"Bearer {token}", "X-Device-Id": "legacy-browser", "user-agent": "Legacy Browser"}

        heartbeat = self.client.post("/api/v1/auth/device/heartbeat", headers=headers)
        self.assertEqual(heartbeat.status_code, 200, heartbeat.text)
        self.assertEqual(heartbeat.json()["device_id"], "legacy-browser")

        listed = self.client.get("/api/v1/auth/sessions", headers=headers)
        self.assertEqual(listed.status_code, 200, listed.text)
        sessions = listed.json()["sessions"]
        self.assertEqual(len(sessions), 1)
        self.assertEqual(sessions[0]["device_id"], "legacy-browser")
        self.assertTrue(sessions[0]["is_online"])
        self.assertTrue(sessions[0]["is_active"])

        revoked = self.client.delete("/api/v1/auth/sessions/legacy-browser", headers=headers)
        self.assertEqual(revoked.status_code, 200, revoked.text)
        blocked = self.client.get("/api/v1/auth/me", headers=headers)
        self.assertEqual(blocked.status_code, 401)

    def test_refresh_requires_relogin_after_absolute_session_expiry(self):
        tokens = self.setup_admin()
        record = self.store.get_refresh_token(hash_refresh_token(tokens["refresh_token"]))
        self.assertIsNotNone(record)
        expired_at = (datetime.now(timezone.utc) - timedelta(seconds=1)).replace(microsecond=0).isoformat()
        with self.store.connect() as conn:
            conn.execute(
                "UPDATE login_sessions SET expires_at = ? WHERE id = ?",
                (expired_at, record["session_id"]),
            )
            conn.commit()

        refreshed = self.client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
        self.assertEqual(refreshed.status_code, 401)
        self.assertIn("expired", refreshed.json()["detail"].lower())

    def test_login_device_limit_revokes_oldest_active_session(self):
        self.store.set_config_values({"auth_max_devices_per_user": 1})
        config_module._config_instance = None
        tokens = self.setup_admin()
        first_headers = {"Authorization": f"Bearer {tokens['access_token']}"}

        second = self.client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "Password123!"},
            headers={"user-agent": "Second Device"},
        )
        self.assertEqual(second.status_code, 200, second.text)
        second_headers = {"Authorization": f"Bearer {second.json()['access_token']}"}

        old_access = self.client.get("/api/v1/auth/me", headers=first_headers)
        self.assertEqual(old_access.status_code, 401)
        old_refresh = self.client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
        self.assertEqual(old_refresh.status_code, 401)

        listed = self.client.get("/api/v1/auth/sessions", headers=second_headers)
        self.assertEqual(listed.status_code, 200, listed.text)
        sessions = listed.json()["sessions"]
        self.assertEqual(sum(1 for session in sessions if session["is_active"]), 1)
        self.assertEqual(sum(1 for session in sessions if session["is_current"]), 1)

    def test_only_admin_can_update_login_device_limit(self):
        admin_tokens = self.setup_admin()
        admin_headers = {"Authorization": f"Bearer {admin_tokens['access_token']}"}
        updated = self.client.patch(
            "/api/v1/config",
            json={"auth_max_devices_per_user": 2},
            headers=admin_headers,
        )
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["auth_max_devices_per_user"], 2)

        created = self.client.post(
            "/api/v1/users",
            json={
                "username": "limited",
                "password": "Password123!",
                "display_name": "Limited",
                "roles": ["user"],
            },
            headers=admin_headers,
        )
        self.assertEqual(created.status_code, 200, created.text)
        login = self.client.post("/api/v1/auth/login", json={"username": "limited", "password": "Password123!"})
        self.assertEqual(login.status_code, 200, login.text)
        user_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

        denied = self.client.patch(
            "/api/v1/config",
            json={"auth_max_devices_per_user": 3},
            headers=user_headers,
        )
        self.assertEqual(denied.status_code, 403)

    def test_rbac_denies_readonly_user_management(self):
        admin_tokens = self.setup_admin()
        admin_headers = {"Authorization": f"Bearer {admin_tokens['access_token']}"}

        created = self.client.post(
            "/api/v1/users",
            json={
                "username": "viewer",
                "password": "Password123!",
                "display_name": "Viewer",
                "roles": ["readonly"],
            },
            headers=admin_headers,
        )
        self.assertEqual(created.status_code, 200, created.text)

        login = self.client.post("/api/v1/auth/login", json={"username": "viewer", "password": "Password123!"})
        self.assertEqual(login.status_code, 200, login.text)
        viewer_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

        denied = self.client.get("/api/v1/users", headers=viewer_headers)
        self.assertEqual(denied.status_code, 403)

        readonly_config = self.client.get("/api/v1/config", headers=viewer_headers)
        self.assertEqual(readonly_config.status_code, 200)

    def test_builtin_roles_can_be_modified_and_page_permissions_are_configurable(self):
        admin_tokens = self.setup_admin()
        admin_headers = {"Authorization": f"Bearer {admin_tokens['access_token']}"}

        roles = self.client.get("/api/v1/roles", headers=admin_headers)
        self.assertEqual(roles.status_code, 200, roles.text)
        self.assertEqual(roles.json()["page_permissions"]["news"], "market:read")
        self.assertNotIn("chat", roles.json()["page_permissions"])
        self.assertNotIn("market", roles.json()["page_permissions"])
        self.assertNotIn("market_config", roles.json()["page_permissions"])

        removed_page = self.client.put(
            "/api/v1/roles/pages/market",
            json={"permission": "market:read"},
            headers=admin_headers,
        )
        self.assertEqual(removed_page.status_code, 400)

        updated_page = self.client.put(
            "/api/v1/roles/pages/news",
            json={"permission": "config:read"},
            headers=admin_headers,
        )
        self.assertEqual(updated_page.status_code, 200, updated_page.text)
        self.assertEqual(updated_page.json()["page_permissions"]["news"], "config:read")

        updated_role = self.client.put(
            "/api/v1/roles/readonly",
            json={"name": "readonly", "description": "Narrow read-only role", "permissions": ["config:read"]},
            headers=admin_headers,
        )
        self.assertEqual(updated_role.status_code, 200, updated_role.text)
        self.assertTrue(updated_role.json()["builtin"])
        self.assertEqual(updated_role.json()["permissions"], ["config:read"])

        # Re-initializing the store must not reset edited built-in role grants.
        self.store = reset_app_store_for_tests(self.db_path)
        readonly = next(role for role in self.store.list_roles() if role["name"] == "readonly")
        self.assertTrue(readonly["builtin"])
        self.assertEqual(readonly["permissions"], ["config:read"])
        self.assertEqual(self.store.list_page_permissions()["news"], "config:read")

    def test_clear_all_chat_sessions_deletes_attached_tracing(self):
        tokens = self.setup_admin()
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}

        first = self.client.post("/api/v1/agent/sessions", json={"title": "First"}, headers=headers)
        self.assertEqual(first.status_code, 200, first.text)
        second = self.client.post("/api/v1/agent/sessions", json={"title": "Second"}, headers=headers)
        self.assertEqual(second.status_code, 200, second.text)

        session_id = first.json()["id"]
        trace_store = TraceStore(str(self.workspace))
        run = trace_store.create_run(session_id=session_id, user_message="trace me")
        trace_store.add_event(run_id=run["run_id"], node_type="llm", title="LLM", parent_id=run["root_event_id"])
        self.assertEqual(len(trace_store.get_session_traces(session_id=session_id)["runs"]), 1)

        cleared = self.client.delete("/api/v1/agent/sessions", headers=headers)
        self.assertEqual(cleared.status_code, 200, cleared.text)
        self.assertEqual(cleared.json()["deleted"], 2)
        self.assertEqual(cleared.json()["tracing"], "cleared_by_session_cascade")

        listed = self.client.get("/api/v1/agent/sessions", headers=headers)
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual(listed.json()["total"], 0)
        self.assertEqual(trace_store.get_session_traces(session_id=session_id)["runs"], [])

    def test_user_can_change_own_password(self):
        admin_tokens = self.setup_admin()
        admin_headers = {"Authorization": f"Bearer {admin_tokens['access_token']}"}

        created = self.client.post(
            "/api/v1/users",
            json={
                "username": "trader",
                "password": "Password123!",
                "display_name": "Trader",
                "roles": ["user"],
            },
            headers=admin_headers,
        )
        self.assertEqual(created.status_code, 200, created.text)

        login = self.client.post("/api/v1/auth/login", json={"username": "trader", "password": "Password123!"})
        self.assertEqual(login.status_code, 200, login.text)
        user_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

        wrong_current = self.client.patch(
            "/api/v1/auth/me/password",
            json={"current_password": "wrong-password", "new_password": "NewPassword123!"},
            headers=user_headers,
        )
        self.assertEqual(wrong_current.status_code, 400)

        changed = self.client.patch(
            "/api/v1/auth/me/password",
            json={"current_password": "Password123!", "new_password": "NewPassword123!"},
            headers=user_headers,
        )
        self.assertEqual(changed.status_code, 200, changed.text)

        old_login = self.client.post("/api/v1/auth/login", json={"username": "trader", "password": "Password123!"})
        self.assertEqual(old_login.status_code, 401)
        new_login = self.client.post("/api/v1/auth/login", json={"username": "trader", "password": "NewPassword123!"})
        self.assertEqual(new_login.status_code, 200, new_login.text)

    def test_user_config_hides_inherited_defaults_and_saves_personal_mcp_capabilities(self):
        admin_tokens = self.setup_admin()
        admin_headers = {"Authorization": f"Bearer {admin_tokens['access_token']}"}
        self.store.set_config_values(
            {
                "llm_api_key": "sk-system-secret",
                "llm_model": "system-model",
                "telegram_bot_token": "telegram-system-secret",
                "longbridge_access_token": "longbridge-system-secret",
                "guardian_api_key": "guardian-system-secret",
                "mcp_servers": {
                    "system": {
                        "transport": "streamable_http",
                        "url": "https://example.com/system-mcp",
                        "headers": {"Authorization": "Bearer system-token"},
                    }
                },
            }
        )
        config_module._config_instance = None

        created = self.client.post(
            "/api/v1/users",
            json={
                "username": "personal",
                "password": "Password123!",
                "display_name": "Personal",
                "roles": ["user"],
            },
            headers=admin_headers,
        )
        self.assertEqual(created.status_code, 200, created.text)
        user_id = created.json()["id"]
        login = self.client.post("/api/v1/auth/login", json={"username": "personal", "password": "Password123!"})
        self.assertEqual(login.status_code, 200, login.text)
        user_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

        inherited = self.client.get("/api/v1/config", headers=user_headers)
        self.assertEqual(inherited.status_code, 200, inherited.text)
        inherited_body = inherited.json()
        self.assertEqual(inherited_body["llm_model"], "")
        self.assertFalse(inherited_body["has_llm_api_key"])
        self.assertEqual(inherited_body["mcp_servers"], {})
        self.assertFalse(inherited_body["has_telegram_bot_token"])
        self.assertFalse(inherited_body["has_longbridge_access_token"])
        self.assertFalse(inherited_body["has_guardian_api_key"])

        personal_mcp = {
            "mine": {
                "transport": "streamable_http",
                "url": "https://example.com/personal-mcp",
                "headers": {"Authorization": "Bearer personal-token"},
            }
        }
        patched = self.client.patch(
            "/api/v1/config",
            json={
                "app_language": "en",
                "memory_enabled": False,
                "scheduler_enabled": False,
                "llm_model": "personal-model",
                "mcp_servers": personal_mcp,
                "agent_max_steps": 7,
                "agent_max_context_turns": 5,
                "multi_agent_enabled": False,
                "memory_auto_curate_enabled": False,
                "memory_curator_min_importance": 0.55,
                "guardian_api_key": "guardian-personal-secret",
                "debug": True,
            },
            headers=user_headers,
        )
        self.assertEqual(patched.status_code, 200, patched.text)
        body = patched.json()
        self.assertEqual(body["app_language"], "en")
        self.assertFalse(body["memory_enabled"])
        self.assertFalse(body["scheduler_enabled"])
        self.assertEqual(body["llm_model"], "personal-model")
        self.assertEqual(body["agent_max_steps"], 7)
        self.assertEqual(body["agent_max_context_turns"], 5)
        self.assertFalse(body["multi_agent_enabled"])
        self.assertFalse(body["memory_auto_curate_enabled"])
        self.assertEqual(body["memory_curator_min_importance"], 0.55)
        self.assertTrue(body["debug"])
        self.assertIn("mine", body["mcp_servers"])
        self.assertIn("memory_enabled", body["personal_config_keys"])
        self.assertIn("mcp_servers", body["personal_config_keys"])
        self.assertIn("agent_max_steps", body["personal_config_keys"])
        self.assertIn("memory_auto_curate_enabled", body["personal_config_keys"])
        self.assertIn("guardian_api_key", body["personal_config_keys"])

        self.assertEqual(self.store.get_config()["llm_model"], "system-model")
        personal_config = self.store.get_user_config(user_id)
        self.assertEqual(personal_config["llm_model"], "personal-model")
        self.assertFalse(personal_config["memory_enabled"])
        self.assertEqual(personal_config["agent_max_steps"], 7)
        self.assertFalse(personal_config["multi_agent_enabled"])
        self.assertFalse(personal_config["memory_auto_curate_enabled"])
        self.assertEqual(personal_config["mcp_servers"]["mine"]["headers"]["Authorization"], "Bearer personal-token")
        self.assertEqual(personal_config["guardian_api_key"], "guardian-personal-secret")

        denied = self.client.patch(
            "/api/v1/config",
            json={"agent_tool_allowlist": ["read_file"], "multi_agent_roles": {}},
            headers=user_headers,
        )
        self.assertEqual(denied.status_code, 403)

    def test_config_api_masks_sensitive_values(self):
        tokens = self.setup_admin()
        self.store.set_config_values(
            {
                "llm_api_key": "sk-live-secret",
                "telegram_bot_token": "telegram-bot-secret",
                "longbridge_access_token": "lb-access-token",
                "guardian_api_key": "guardian-api-secret",
                "mcp_servers": {
                    "remote": {
                        "transport": "streamable_http",
                        "url": "https://example.com/mcp",
                        "headers": {"Authorization": "Bearer server-token"},
                        "auth": {"type": "header", "name": "X-Api-Key", "value": "mcp-header-secret"},
                    }
                },
            }
        )
        config_module._config_instance = None

        response = self.client.get(
            "/api/v1/config",
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        serialized = json.dumps(body, ensure_ascii=False)

        for secret in ("sk-live-secret", "telegram-bot-secret", "lb-access-token", "guardian-api-secret", "Bearer server-token", "mcp-header-secret"):
            self.assertNotIn(secret, serialized)
        self.assertTrue(body["has_llm_api_key"])
        self.assertTrue(body["has_telegram_bot_token"])
        self.assertTrue(body["has_longbridge_access_token"])
        self.assertTrue(body["has_guardian_api_key"])
        self.assertNotEqual(body["mcp_servers"]["remote"]["headers"]["Authorization"], "Bearer server-token")

        patched = self.client.patch(
            "/api/v1/config",
            json={"mcp_servers": body["mcp_servers"]},
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
        )
        self.assertEqual(patched.status_code, 200, patched.text)
        stored = self.store.get_config()["mcp_servers"]["remote"]
        self.assertEqual(stored["headers"]["Authorization"], "Bearer server-token")
        self.assertEqual(stored["auth"]["value"], "mcp-header-secret")

    def test_guardian_translate_api_uses_current_user_model(self):
        tokens = self.setup_admin()

        class FakeProvider:
            model = "fake-news-translator"

            def call(self, request):
                self.request = request
                return {"choices": [{"message": {"content": "中文译文"}}]}

        provider = FakeProvider()
        with patch("app.api.news.create_llm_provider", return_value=provider):
            response = self.client.post(
                "/api/v1/news/guardian/translate",
                json={"text": "Original Guardian article", "target_language": "zh-CN"},
                headers={"Authorization": f"Bearer {tokens['access_token']}"},
            )

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["translation"], "中文译文")
        self.assertEqual(body["model"], "fake-news-translator")
        self.assertIn("Original Guardian article", provider.request.messages[0]["content"])


if __name__ == "__main__":
    unittest.main()
