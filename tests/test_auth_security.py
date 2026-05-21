import json
import os
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

import app.config as config_module
import app.core.app_store as app_store_module
from app.core.app_store import APP_DB_ENV, reset_app_store_for_tests
from app.core.security import hash_password, hash_refresh_token, verify_password
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
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        config_module._config_instance = None
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

    def test_config_api_masks_sensitive_values(self):
        tokens = self.setup_admin()
        self.store.set_config_values(
            {
                "llm_api_key": "sk-live-secret",
                "telegram_bot_token": "telegram-bot-secret",
                "longbridge_access_token": "lb-access-token",
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

        for secret in ("sk-live-secret", "telegram-bot-secret", "lb-access-token", "Bearer server-token", "mcp-header-secret"):
            self.assertNotIn(secret, serialized)
        self.assertTrue(body["has_llm_api_key"])
        self.assertTrue(body["has_telegram_bot_token"])
        self.assertTrue(body["has_longbridge_access_token"])
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


if __name__ == "__main__":
    unittest.main()
