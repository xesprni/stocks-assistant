import os
import sqlite3
import tempfile
import unittest
from pathlib import Path

import app.core.app_store as app_store_module
from app.core.app_store import APP_DB_ENV, AppStore, reset_app_store_for_tests


class AppStoreSecurityTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old_db_path = os.environ.get(APP_DB_ENV)
        self.db_path = Path(self.tmp.name) / "app.db"
        os.environ[APP_DB_ENV] = str(self.db_path)
        self.store = reset_app_store_for_tests(self.db_path)

    def tearDown(self):
        app_store_module._app_store = None
        if self.old_db_path is None:
            os.environ.pop(APP_DB_ENV, None)
        else:
            os.environ[APP_DB_ENV] = self.old_db_path
        self.tmp.cleanup()

    def _raw_app_config(self) -> str:
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute("SELECT value_json FROM app_config ORDER BY key").fetchall()
        return "\n".join(row[0] for row in rows)

    def test_sensitive_config_values_are_encrypted_at_rest(self):
        self.store.set_config_values(
            {
                "llm_api_key": "sk-live-secret",
                "telegram_bot_token": "telegram-bot-secret",
                "longbridge_app_key": "lb-app-key",
                "longbridge_app_secret": "lb-app-secret",
                "longbridge_access_token": "lb-access-token",
                "guardian_api_key": "guardian-api-secret",
                "mcp_servers": {
                    "remote": {
                        "transport": "streamable_http",
                        "url": "https://example.com/mcp",
                        "headers": {"Authorization": "Bearer server-token", "X-Plain": "visible"},
                        "auth": {"type": "header", "name": "X-Api-Key", "value": "mcp-header-secret"},
                    }
                },
            }
        )

        raw = self._raw_app_config()
        for secret in (
            "sk-live-secret",
            "telegram-bot-secret",
            "lb-app-key",
            "lb-app-secret",
            "lb-access-token",
            "guardian-api-secret",
            "Bearer server-token",
            "mcp-header-secret",
        ):
            self.assertNotIn(secret, raw)

        config = self.store.get_config()
        self.assertEqual(config["llm_api_key"], "sk-live-secret")
        self.assertEqual(config["telegram_bot_token"], "telegram-bot-secret")
        self.assertEqual(config["longbridge_access_token"], "lb-access-token")
        self.assertEqual(config["guardian_api_key"], "guardian-api-secret")
        self.assertEqual(config["mcp_servers"]["remote"]["headers"]["Authorization"], "Bearer server-token")
        self.assertEqual(config["mcp_servers"]["remote"]["auth"]["value"], "mcp-header-secret")

    def test_mcp_oauth_tokens_are_encrypted_at_rest(self):
        self.store.set_mcp_oauth_entry(
            "remote",
            {"access_token": "oauth-access-secret", "refresh_token": "oauth-refresh-secret"},
        )

        with sqlite3.connect(self.db_path) as conn:
            raw = conn.execute("SELECT entry_json FROM mcp_oauth_tokens WHERE server_name = 'remote'").fetchone()[0]

        self.assertNotIn("oauth-access-secret", raw)
        self.assertNotIn("oauth-refresh-secret", raw)
        self.assertEqual(self.store.get_mcp_oauth_entry("remote")["access_token"], "oauth-access-secret")

    def test_subagent_roles_are_stored_in_dedicated_table(self):
        roles = {
            "analyst": {
                "description": "Read market data",
                "system_prompt": "Focus on facts.",
                "tools": ["web_search"],
            }
        }
        self.store.set_config_values({"multi_agent_roles": roles})

        with sqlite3.connect(self.db_path) as conn:
            app_config_row = conn.execute(
                "SELECT 1 FROM app_config WHERE key = 'multi_agent_roles'"
            ).fetchone()
            role_row = conn.execute(
                "SELECT role_json FROM subagent_roles WHERE name = 'analyst'"
            ).fetchone()

        self.assertIsNone(app_config_row)
        self.assertIsNotNone(role_row)
        self.assertEqual(self.store.get_config()["multi_agent_roles"], roles)

    def test_legacy_refresh_token_table_is_upgraded_before_session_index(self):
        legacy_db = Path(self.tmp.name) / "legacy.db"
        with sqlite3.connect(legacy_db) as conn:
            conn.executescript(
                """
                CREATE TABLE users (
                    id TEXT PRIMARY KEY,
                    username TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    display_name TEXT NOT NULL DEFAULT '',
                    is_active INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_login_at TEXT
                );

                CREATE TABLE refresh_tokens (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    token_hash TEXT NOT NULL UNIQUE,
                    expires_at TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    revoked_at TEXT,
                    replaced_by TEXT,
                    user_agent TEXT NOT NULL DEFAULT '',
                    ip_address TEXT NOT NULL DEFAULT ''
                );
                """
            )

        store = AppStore(legacy_db)
        with store.connect() as conn:
            user_columns = {row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
            refresh_columns = {row[1] for row in conn.execute("PRAGMA table_info(refresh_tokens)").fetchall()}
            indexes = {row[1] for row in conn.execute("PRAGMA index_list(refresh_tokens)").fetchall()}

        self.assertIn("avatar_base64", user_columns)
        self.assertIn("session_id", refresh_columns)
        self.assertIn("idx_refresh_tokens_session", indexes)


if __name__ == "__main__":
    unittest.main()
