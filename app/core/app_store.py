"""Application-level SQLite store.

This database owns system configuration, users/RBAC, refresh tokens, and
small global/user-scoped runtime records that used to live in JSON files.
"""

from __future__ import annotations

import json
import logging
import os
import secrets
import sqlite3
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Optional

from cryptography.fernet import Fernet, InvalidToken


APP_DB_ENV = "STOCKS_ASSISTANT_DB_PATH"
DEFAULT_APP_DB = "~/stocks-assistant/stocks-assistant.db"
JWT_SECRET_KEY = "jwt_secret"
CONFIG_ENCRYPTION_KEY = "config_encryption_key"
ENCRYPTED_MARKER = "__stocks_assistant_encrypted__"
ENCRYPTED_VERSION = "fernet-v1"
logger = logging.getLogger("stocks-assistant.app_store")

SENSITIVE_CONFIG_KEYS = {
    "llm_api_key",
    "embedding_api_key",
    "telegram_bot_token",
    "longbridge_app_key",
    "longbridge_app_secret",
    "longbridge_access_token",
}

ROLE_PERMISSIONS: dict[str, list[str]] = {
    "admin": ["*"],
    "user": [
        "chat:read",
        "chat:write",
        "config:read",
        "fundamentals:read",
        "knowledge:read",
        "knowledge:write",
        "market:read",
        "market:write",
        "mcp:read",
        "mcp:write",
        "memory:read",
        "memory:write",
        "portfolio:read",
        "portfolio:write",
        "scheduler:read",
        "scheduler:write",
        "scheduler:run",
        "skills:read",
        "tools:read",
        "tracing:read",
        "watchlist:read",
        "watchlist:write",
    ],
    "readonly": [
        "chat:read",
        "config:read",
        "fundamentals:read",
        "knowledge:read",
        "market:read",
        "mcp:read",
        "memory:read",
        "portfolio:read",
        "scheduler:read",
        "skills:read",
        "tracing:read",
        "watchlist:read",
    ],
}

PERMISSION_DESCRIPTIONS: dict[str, str] = {
    "*": "All permissions",
    "chat:read": "Read own chat sessions",
    "chat:write": "Create chat messages and sessions",
    "config:read": "Read masked system configuration",
    "config:write": "Update system configuration",
    "fundamentals:read": "Read fundamentals data",
    "knowledge:read": "Read own knowledge base",
    "knowledge:write": "Write own knowledge base",
    "market:read": "Read market data and dashboard config",
    "market:write": "Update own market dashboard config",
    "mcp:read": "Read MCP server status",
    "mcp:write": "Manage MCP server config and OAuth credentials",
    "memory:read": "Read/search own memory",
    "memory:write": "Write/sync/delete own memory",
    "portfolio:read": "Read own portfolio",
    "portfolio:write": "Write own portfolio",
    "scheduler:read": "Read own scheduler tasks",
    "scheduler:write": "Write own scheduler tasks",
    "scheduler:run": "Run own scheduler tasks",
    "skills:read": "Read skills",
    "skills:write": "Manage installed skills",
    "tools:read": "Read tool list",
    "tools:execute": "Execute tools directly",
    "tracing:read": "Read own traces",
    "users:manage": "Manage users",
    "roles:manage": "Manage roles",
    "watchlist:read": "Read own watchlist",
    "watchlist:write": "Write own watchlist",
}

PAGE_PERMISSION_REQUIREMENTS: dict[str, str] = {
    "overview": "config:read",
    "chat": "chat:read",
    "tracing": "tracing:read",
    "market": "market:read",
    "market_config": "market:write",
    "watchlist": "watchlist:read",
    "portfolio": "portfolio:read",
    "news": "market:read",
    "config": "config:read",
    "chart": "market:read",
    "fundamentals": "fundamentals:read",
    "skills": "skills:read",
    "subagents": "config:write",
    "mcp": "mcp:read",
    "memory": "memory:read",
    "knowledge": "knowledge:read",
    "scheduler": "scheduler:read",
    "users": "users:manage",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def app_db_path() -> Path:
    return Path(os.environ.get(APP_DB_ENV) or DEFAULT_APP_DB).expanduser()


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _json_loads(value: str | None, fallback: Any = None) -> Any:
    if value is None:
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


def _is_encrypted_payload(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and value.get(ENCRYPTED_MARKER) == ENCRYPTED_VERSION
        and isinstance(value.get("value"), str)
    )


def _looks_secret_key(key: str) -> bool:
    lower = key.lower()
    return any(part in lower for part in ("authorization", "token", "secret", "password", "api-key", "apikey", "key"))


def _auth_value_is_sensitive(key: str, auth: dict[str, Any]) -> bool:
    lower = key.lower()
    if _looks_secret_key(key) or lower in {"password", "client_secret"}:
        return True
    if lower == "value":
        return _looks_secret_key(str(auth.get("name") or ""))
    return False


class AppStore:
    """Thin SQLite gateway for application-owned data."""

    def __init__(self, db_path: Optional[Path | str] = None):
        self.db_path = Path(db_path).expanduser() if db_path else app_db_path()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA busy_timeout = 5000")
        return conn

    def _init_db(self) -> None:
        with self.connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS system_kv (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS app_config (
                    key TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS user_config (
                    user_id TEXT NOT NULL,
                    key TEXT NOT NULL,
                    value_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (user_id, key),
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    username TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    display_name TEXT NOT NULL DEFAULT '',
                    is_active INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_login_at TEXT
                );

                CREATE TABLE IF NOT EXISTS roles (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL UNIQUE,
                    description TEXT NOT NULL DEFAULT '',
                    builtin INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS permissions (
                    key TEXT PRIMARY KEY,
                    description TEXT NOT NULL DEFAULT ''
                );

                CREATE TABLE IF NOT EXISTS role_permissions (
                    role_id TEXT NOT NULL,
                    permission_key TEXT NOT NULL,
                    PRIMARY KEY (role_id, permission_key),
                    FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE CASCADE,
                    FOREIGN KEY(permission_key) REFERENCES permissions(key) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS page_permissions (
                    page TEXT PRIMARY KEY,
                    permission_key TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(permission_key) REFERENCES permissions(key) ON DELETE RESTRICT
                );

                CREATE TABLE IF NOT EXISTS user_roles (
                    user_id TEXT NOT NULL,
                    role_id TEXT NOT NULL,
                    PRIMARY KEY (user_id, role_id),
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
                    FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS refresh_tokens (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    token_hash TEXT NOT NULL UNIQUE,
                    expires_at TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    revoked_at TEXT,
                    replaced_by TEXT,
                    user_agent TEXT NOT NULL DEFAULT '',
                    ip_address TEXT NOT NULL DEFAULT '',
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS audit_events (
                    id TEXT PRIMARY KEY,
                    user_id TEXT,
                    action TEXT NOT NULL,
                    resource TEXT NOT NULL DEFAULT '',
                    detail_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
                );

                CREATE TABLE IF NOT EXISTS market_dashboard_configs (
                    user_id TEXT PRIMARY KEY,
                    config_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS scheduler_tasks (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    task_json TEXT NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    next_run_at TEXT,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS scheduler_runs (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    task_id TEXT NOT NULL,
                    run_json TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS mcp_oauth_tokens (
                    user_id TEXT NOT NULL DEFAULT '',
                    server_name TEXT NOT NULL,
                    entry_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (user_id, server_name)
                );

                CREATE TABLE IF NOT EXISTS skill_configs (
                    name TEXT PRIMARY KEY,
                    config_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS subagent_roles (
                    name TEXT PRIMARY KEY,
                    role_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
                CREATE INDEX IF NOT EXISTS idx_scheduler_tasks_user ON scheduler_tasks(user_id);
                CREATE INDEX IF NOT EXISTS idx_scheduler_runs_user_started ON scheduler_runs(user_id, started_at);
                """
            )
            self._ensure_mcp_oauth_tokens_schema(conn)
            self._seed_rbac(conn)
            if not self.get_system_value(JWT_SECRET_KEY, conn=conn):
                conn.execute(
                    "INSERT INTO system_kv (key, value, updated_at) VALUES (?, ?, ?)",
                    (JWT_SECRET_KEY, secrets.token_urlsafe(48), utc_now()),
                )
            if not self.get_system_value(CONFIG_ENCRYPTION_KEY, conn=conn):
                conn.execute(
                    "INSERT INTO system_kv (key, value, updated_at) VALUES (?, ?, ?)",
                    (CONFIG_ENCRYPTION_KEY, Fernet.generate_key().decode("ascii"), utc_now()),
                )
            self._migrate_plaintext_secrets(conn)
            self._migrate_subagent_roles_from_config(conn)
            conn.commit()

    def _ensure_mcp_oauth_tokens_schema(self, conn: sqlite3.Connection) -> None:
        """Upgrade legacy global MCP OAuth token storage to user-scoped rows."""
        cols = {row[1]: row for row in conn.execute("PRAGMA table_info(mcp_oauth_tokens)").fetchall()}
        pk_cols = [row[1] for row in sorted(cols.values(), key=lambda item: item[5]) if row[5]]
        if "user_id" in cols and pk_cols == ["user_id", "server_name"]:
            return

        conn.execute("ALTER TABLE mcp_oauth_tokens RENAME TO mcp_oauth_tokens_legacy")
        conn.execute(
            """
            CREATE TABLE mcp_oauth_tokens (
                user_id TEXT NOT NULL DEFAULT '',
                server_name TEXT NOT NULL,
                entry_json TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, server_name)
            )
            """
        )
        old_cols = {row[1] for row in conn.execute("PRAGMA table_info(mcp_oauth_tokens_legacy)").fetchall()}
        user_expr = "user_id" if "user_id" in old_cols else "'' AS user_id"
        conn.execute(
            f"""
            INSERT OR REPLACE INTO mcp_oauth_tokens (user_id, server_name, entry_json, updated_at)
            SELECT {user_expr}, server_name, entry_json, updated_at
            FROM mcp_oauth_tokens_legacy
            """
        )
        conn.execute("DROP TABLE mcp_oauth_tokens_legacy")

    def _seed_rbac(self, conn: sqlite3.Connection) -> None:
        now = utc_now()
        for key, description in PERMISSION_DESCRIPTIONS.items():
            conn.execute(
                """
                INSERT INTO permissions (key, description)
                VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET description = excluded.description
                """,
                (key, description),
            )
        for page, permission in PAGE_PERMISSION_REQUIREMENTS.items():
            conn.execute(
                """
                INSERT OR IGNORE INTO page_permissions (page, permission_key, updated_at)
                VALUES (?, ?, ?)
                """,
                (page, permission, now),
            )
        for role_name, permissions in ROLE_PERMISSIONS.items():
            role_id = role_name
            existing = conn.execute("SELECT id FROM roles WHERE name = ?", (role_name,)).fetchone()
            if not existing:
                conn.execute(
                    """
                    INSERT INTO roles (id, name, description, builtin, created_at, updated_at)
                    VALUES (?, ?, ?, 1, ?, ?)
                    """,
                    (role_id, role_name, f"Built-in {role_name} role", now, now),
                )
                for permission in permissions:
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
                        VALUES (?, ?)
                        """,
                        (role_id, permission),
                    )
            else:
                conn.execute("UPDATE roles SET builtin = 1 WHERE id = ?", (existing["id"],))

    # ------------------------------------------------------------------ system

    def get_system_value(self, key: str, *, conn: Optional[sqlite3.Connection] = None) -> Optional[str]:
        own_conn = conn is None
        active = conn or self.connect()
        try:
            row = active.execute("SELECT value FROM system_kv WHERE key = ?", (key,)).fetchone()
            return str(row["value"]) if row else None
        finally:
            if own_conn:
                active.close()

    def set_system_value(self, key: str, value: str) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO system_kv (key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
                """,
                (key, value, utc_now()),
            )
            conn.commit()

    # ------------------------------------------------------------------ encryption

    def _fernet(self, conn: sqlite3.Connection) -> Fernet:
        key = self.get_system_value(CONFIG_ENCRYPTION_KEY, conn=conn)
        if not key:
            key = Fernet.generate_key().decode("ascii")
            conn.execute(
                "INSERT INTO system_kv (key, value, updated_at) VALUES (?, ?, ?)",
                (CONFIG_ENCRYPTION_KEY, key, utc_now()),
            )
        return Fernet(key.encode("ascii"))

    def _encrypt_json_value(self, conn: sqlite3.Connection, value: Any) -> dict[str, str]:
        if _is_encrypted_payload(value):
            return value
        payload = _json_dumps(value).encode("utf-8")
        encrypted = self._fernet(conn).encrypt(payload).decode("ascii")
        return {ENCRYPTED_MARKER: ENCRYPTED_VERSION, "value": encrypted}

    def _decrypt_json_value(self, conn: sqlite3.Connection, value: Any) -> Any:
        if not _is_encrypted_payload(value):
            return value
        try:
            decrypted = self._fernet(conn).decrypt(value["value"].encode("ascii")).decode("utf-8")
            return _json_loads(decrypted)
        except (InvalidToken, ValueError, TypeError) as exc:
            logger.warning("Failed to decrypt stored application secret: %s", exc)
            return ""

    def _encrypt_secret_string(self, conn: sqlite3.Connection, value: Any) -> Any:
        if not isinstance(value, str) or not value:
            return value
        return self._encrypt_json_value(conn, value)

    def _decrypt_recursive(self, conn: sqlite3.Connection, value: Any) -> Any:
        if _is_encrypted_payload(value):
            return self._decrypt_json_value(conn, value)
        if isinstance(value, dict):
            return {key: self._decrypt_recursive(conn, item) for key, item in value.items()}
        if isinstance(value, list):
            return [self._decrypt_recursive(conn, item) for item in value]
        return value

    def _encrypt_mcp_server_config(self, conn: sqlite3.Connection, config: dict[str, Any]) -> dict[str, Any]:
        encrypted = deepcopy(config)
        for key, value in list(encrypted.items()):
            if _looks_secret_key(str(key)):
                encrypted[key] = self._encrypt_secret_string(conn, value)

        headers = encrypted.get("headers")
        if isinstance(headers, dict):
            encrypted["headers"] = {
                key: self._encrypt_secret_string(conn, value) if _looks_secret_key(str(key)) else value
                for key, value in headers.items()
            }

        env = encrypted.get("env")
        if isinstance(env, dict):
            encrypted["env"] = {
                key: self._encrypt_secret_string(conn, value) if _looks_secret_key(str(key)) else value
                for key, value in env.items()
            }

        auth = encrypted.get("auth")
        if isinstance(auth, str):
            encrypted["auth"] = self._encrypt_secret_string(conn, auth)
        elif isinstance(auth, dict):
            encrypted["auth"] = {
                key: self._encrypt_secret_string(conn, value) if _auth_value_is_sensitive(str(key), auth) else value
                for key, value in auth.items()
            }
        return encrypted

    def _encrypt_mcp_servers(self, conn: sqlite3.Connection, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        return {
            name: self._encrypt_mcp_server_config(conn, config) if isinstance(config, dict) else config
            for name, config in value.items()
        }

    def _encode_config_value(self, conn: sqlite3.Connection, key: str, value: Any) -> Any:
        if key in SENSITIVE_CONFIG_KEYS and isinstance(value, str) and value:
            return self._encrypt_json_value(conn, value)
        if key == "mcp_servers":
            return self._encrypt_mcp_servers(conn, value)
        return value

    def _decode_config_value(self, conn: sqlite3.Connection, key: str, value: Any) -> Any:
        if key in SENSITIVE_CONFIG_KEYS:
            return self._decrypt_json_value(conn, value)
        if key == "mcp_servers":
            return self._decrypt_recursive(conn, value)
        return self._decrypt_recursive(conn, value)

    def _value_needs_secret_migration(self, key: str, value: Any) -> bool:
        if key in SENSITIVE_CONFIG_KEYS:
            return isinstance(value, str) and bool(value)
        if key == "mcp_servers":
            return isinstance(value, dict) and not _is_encrypted_payload(value)
        return False

    def _migrate_plaintext_secrets(self, conn: sqlite3.Connection) -> None:
        rows = conn.execute("SELECT key, value_json FROM app_config").fetchall()
        for row in rows:
            key = row["key"]
            value = _json_loads(row["value_json"])
            if not self._value_needs_secret_migration(key, value):
                continue
            encoded = self._encode_config_value(conn, key, value)
            if encoded != value:
                conn.execute(
                    "UPDATE app_config SET value_json = ?, updated_at = ? WHERE key = ?",
                    (_json_dumps(encoded), utc_now(), key),
                )

        token_rows = conn.execute("SELECT server_name, entry_json FROM mcp_oauth_tokens").fetchall()
        for row in token_rows:
            entry = _json_loads(row["entry_json"], {})
            if _is_encrypted_payload(entry):
                continue
            conn.execute(
                "UPDATE mcp_oauth_tokens SET entry_json = ?, updated_at = ? WHERE server_name = ?",
                (_json_dumps(self._encrypt_json_value(conn, entry)), utc_now(), row["server_name"]),
            )

    # ------------------------------------------------------------------ config

    def get_config(self) -> dict[str, Any]:
        with self.connect() as conn:
            rows = conn.execute("SELECT key, value_json FROM app_config").fetchall()
            config = {
                row["key"]: self._decode_config_value(conn, row["key"], _json_loads(row["value_json"]))
                for row in rows
            }
            subagent_roles = self.get_subagent_roles(conn=conn)
            if subagent_roles:
                config["multi_agent_roles"] = subagent_roles
            return config

    def set_config_values(self, values: dict[str, Any]) -> None:
        if not values:
            return
        now = utc_now()
        with self.connect() as conn:
            for key, value in values.items():
                if key == "multi_agent_roles":
                    self.save_subagent_roles(value, conn=conn)
                    conn.execute("DELETE FROM app_config WHERE key = ?", (key,))
                    continue
                encoded = self._encode_config_value(conn, key, value)
                conn.execute(
                    """
                    INSERT INTO app_config (key, value_json, updated_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(key) DO UPDATE SET
                        value_json = excluded.value_json,
                        updated_at = excluded.updated_at
                    """,
                    (key, _json_dumps(encoded), now),
                )
            conn.commit()

    def has_config(self) -> bool:
        with self.connect() as conn:
            return bool(conn.execute("SELECT 1 FROM app_config LIMIT 1").fetchone())

    def get_user_config(self, user_id: str) -> dict[str, Any]:
        if not user_id:
            return {}
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT key, value_json FROM user_config WHERE user_id = ?",
                (user_id,),
            ).fetchall()
            return {
                row["key"]: self._decode_config_value(conn, row["key"], _json_loads(row["value_json"]))
                for row in rows
            }

    def set_user_config_values(self, user_id: str, values: dict[str, Any]) -> None:
        if not user_id or not values:
            return
        now = utc_now()
        with self.connect() as conn:
            for key, value in values.items():
                encoded = self._encode_config_value(conn, key, value)
                conn.execute(
                    """
                    INSERT INTO user_config (user_id, key, value_json, updated_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(user_id, key) DO UPDATE SET
                        value_json = excluded.value_json,
                        updated_at = excluded.updated_at
                    """,
                    (user_id, key, _json_dumps(encoded), now),
                )
            conn.commit()

    def migrate_config_json_once(self, config_path: str | Path = "config.json") -> dict[str, Any]:
        if self.get_system_value("migration.config_json"):
            return {}
        path = Path(config_path)
        migrated: dict[str, Any] = {}
        if path.exists() and not self.has_config():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    migrated = data
                    self.set_config_values(migrated)
            except Exception:
                migrated = {}
        self.set_system_value("migration.config_json", utc_now())
        return migrated

    # ------------------------------------------------------------------ subagents

    def _migrate_subagent_roles_from_config(self, conn: sqlite3.Connection) -> None:
        if conn.execute("SELECT 1 FROM subagent_roles LIMIT 1").fetchone():
            return
        row = conn.execute("SELECT value_json FROM app_config WHERE key = 'multi_agent_roles'").fetchone()
        if not row:
            return
        roles = _json_loads(row["value_json"], {})
        if isinstance(roles, dict):
            self.save_subagent_roles(roles, conn=conn)
        conn.execute("DELETE FROM app_config WHERE key = 'multi_agent_roles'")

    def get_subagent_roles(self, *, conn: Optional[sqlite3.Connection] = None) -> dict[str, dict[str, Any]]:
        own_conn = conn is None
        active = conn or self.connect()
        try:
            self._migrate_subagent_roles_from_config(active)
            rows = active.execute("SELECT name, role_json FROM subagent_roles ORDER BY name").fetchall()
            return {row["name"]: _json_loads(row["role_json"], {}) for row in rows}
        finally:
            if own_conn:
                active.close()

    def save_subagent_roles(
        self,
        roles: dict[str, dict[str, Any]],
        *,
        conn: Optional[sqlite3.Connection] = None,
    ) -> None:
        if not isinstance(roles, dict):
            raise ValueError("multi_agent_roles must be an object")
        own_conn = conn is None
        active = conn or self.connect()
        try:
            now = utc_now()
            existing = {row["name"] for row in active.execute("SELECT name FROM subagent_roles").fetchall()}
            incoming = set(roles)
            for name in existing - incoming:
                active.execute("DELETE FROM subagent_roles WHERE name = ?", (name,))
            for name, role in roles.items():
                if not isinstance(name, str) or not name:
                    raise ValueError("SubAgent role names must be non-empty strings")
                if not isinstance(role, dict):
                    raise ValueError(f"SubAgent role '{name}' must be an object")
                active.execute(
                    """
                    INSERT INTO subagent_roles (name, role_json, updated_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(name) DO UPDATE SET
                        role_json = excluded.role_json,
                        updated_at = excluded.updated_at
                    """,
                    (name, _json_dumps(role), now),
                )
            if own_conn:
                active.commit()
        finally:
            if own_conn:
                active.close()

    # ------------------------------------------------------------------ users

    def has_users(self) -> bool:
        with self.connect() as conn:
            return bool(conn.execute("SELECT 1 FROM users LIMIT 1").fetchone())

    def create_user(
        self,
        username: str,
        password_hash: str,
        *,
        display_name: str = "",
        role_names: Optional[Iterable[str]] = None,
        is_active: bool = True,
    ) -> dict[str, Any]:
        now = utc_now()
        user_id = str(uuid.uuid4())
        roles = list(role_names or ["user"])
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO users (id, username, password_hash, display_name, is_active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (user_id, username.strip(), password_hash, display_name.strip(), int(is_active), now, now),
            )
            for role_name in roles:
                role = conn.execute("SELECT id FROM roles WHERE name = ?", (role_name,)).fetchone()
                if not role:
                    raise ValueError(f"Role not found: {role_name}")
                conn.execute(
                    "INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)",
                    (user_id, role["id"]),
                )
            conn.commit()
        return self.get_user_by_id(user_id) or {}

    def get_user_by_username(self, username: str) -> Optional[dict[str, Any]]:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM users WHERE username = ?", (username.strip(),)).fetchone()
            return self._user_row_to_dict(conn, row) if row else None

    def get_user_by_id(self, user_id: str) -> Optional[dict[str, Any]]:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            return self._user_row_to_dict(conn, row) if row else None

    def list_users(self) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute("SELECT * FROM users ORDER BY created_at ASC").fetchall()
            return [self._user_row_to_dict(conn, row) for row in rows]

    def update_user(
        self,
        user_id: str,
        *,
        display_name: Optional[str] = None,
        is_active: Optional[bool] = None,
        password_hash: Optional[str] = None,
        role_names: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        fields: list[str] = []
        params: list[Any] = []
        if display_name is not None:
            fields.append("display_name = ?")
            params.append(display_name.strip())
        if is_active is not None:
            fields.append("is_active = ?")
            params.append(int(is_active))
        if password_hash is not None:
            fields.append("password_hash = ?")
            params.append(password_hash)
        fields.append("updated_at = ?")
        params.append(utc_now())
        params.append(user_id)
        with self.connect() as conn:
            cursor = conn.execute(f"UPDATE users SET {', '.join(fields)} WHERE id = ?", params)
            if cursor.rowcount == 0:
                raise KeyError(user_id)
            if role_names is not None:
                conn.execute("DELETE FROM user_roles WHERE user_id = ?", (user_id,))
                for role_name in role_names:
                    role = conn.execute("SELECT id FROM roles WHERE name = ?", (role_name,)).fetchone()
                    if not role:
                        raise ValueError(f"Role not found: {role_name}")
                    conn.execute(
                        "INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)",
                        (user_id, role["id"]),
                    )
            conn.commit()
        return self.get_user_by_id(user_id) or {}

    def touch_login(self, user_id: str) -> None:
        with self.connect() as conn:
            conn.execute(
                "UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?",
                (utc_now(), utc_now(), user_id),
            )
            conn.commit()

    def _user_row_to_dict(self, conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
        role_rows = conn.execute(
            """
            SELECT r.name
            FROM roles r
            JOIN user_roles ur ON ur.role_id = r.id
            WHERE ur.user_id = ?
            ORDER BY r.name
            """,
            (row["id"],),
        ).fetchall()
        roles = [r["name"] for r in role_rows]
        permissions = self.get_user_permissions(row["id"], conn=conn)
        return {
            "id": row["id"],
            "username": row["username"],
            "password_hash": row["password_hash"],
            "display_name": row["display_name"],
            "is_active": bool(row["is_active"]),
            "roles": roles,
            "permissions": sorted(permissions),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "last_login_at": row["last_login_at"],
        }

    def get_user_permissions(self, user_id: str, *, conn: Optional[sqlite3.Connection] = None) -> set[str]:
        own_conn = conn is None
        active = conn or self.connect()
        try:
            rows = active.execute(
                """
                SELECT rp.permission_key
                FROM role_permissions rp
                JOIN user_roles ur ON ur.role_id = rp.role_id
                WHERE ur.user_id = ?
                """,
                (user_id,),
            ).fetchall()
            permissions = {row["permission_key"] for row in rows}
            if "*" in permissions:
                permissions.update(PERMISSION_DESCRIPTIONS.keys())
            return permissions
        finally:
            if own_conn:
                active.close()

    # ------------------------------------------------------------------ roles

    def list_roles(self) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute("SELECT * FROM roles ORDER BY builtin DESC, name ASC").fetchall()
            return [self._role_row_to_dict(conn, row) for row in rows]

    def upsert_role(self, name: str, description: str, permissions: list[str]) -> dict[str, Any]:
        clean = name.strip()
        now = utc_now()
        with self.connect() as conn:
            role = conn.execute("SELECT * FROM roles WHERE name = ?", (clean,)).fetchone()
            role_id = role["id"] if role else str(uuid.uuid4())
            builtin = int(role["builtin"]) if role else 0
            conn.execute(
                """
                INSERT INTO roles (id, name, description, builtin, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(name) DO UPDATE SET description = excluded.description, updated_at = excluded.updated_at
                """,
                (role_id, clean, description.strip(), builtin, now, now),
            )
            conn.execute("DELETE FROM role_permissions WHERE role_id = ?", (role_id,))
            for permission in permissions:
                if permission not in PERMISSION_DESCRIPTIONS:
                    raise ValueError(f"Unknown permission: {permission}")
                conn.execute(
                    "INSERT OR IGNORE INTO role_permissions (role_id, permission_key) VALUES (?, ?)",
                    (role_id, permission),
                )
            conn.commit()
            row = conn.execute("SELECT * FROM roles WHERE id = ?", (role_id,)).fetchone()
            return self._role_row_to_dict(conn, row)

    def list_page_permissions(self) -> dict[str, str]:
        with self.connect() as conn:
            rows = conn.execute("SELECT page, permission_key FROM page_permissions ORDER BY page").fetchall()
            return {row["page"]: row["permission_key"] for row in rows}

    def upsert_page_permission(self, page: str, permission: str) -> dict[str, str]:
        clean_page = page.strip()
        clean_permission = permission.strip()
        if not clean_page:
            raise ValueError("Page is required")
        if clean_permission not in PERMISSION_DESCRIPTIONS:
            raise ValueError(f"Unknown permission: {clean_permission}")
        now = utc_now()
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO page_permissions (page, permission_key, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(page) DO UPDATE SET
                    permission_key = excluded.permission_key,
                    updated_at = excluded.updated_at
                """,
                (clean_page, clean_permission, now),
            )
            conn.commit()
        return self.list_page_permissions()

    def _role_row_to_dict(self, conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
        rows = conn.execute(
            "SELECT permission_key FROM role_permissions WHERE role_id = ? ORDER BY permission_key",
            (row["id"],),
        ).fetchall()
        return {
            "id": row["id"],
            "name": row["name"],
            "description": row["description"],
            "builtin": bool(row["builtin"]),
            "permissions": [item["permission_key"] for item in rows],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    # ------------------------------------------------------------------ tokens

    def create_refresh_token(
        self,
        user_id: str,
        token_hash: str,
        expires_at: str,
        *,
        user_agent: str = "",
        ip_address: str = "",
    ) -> str:
        token_id = str(uuid.uuid4())
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO refresh_tokens (
                    id, user_id, token_hash, expires_at, created_at, user_agent, ip_address
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (token_id, user_id, token_hash, expires_at, utc_now(), user_agent[:500], ip_address[:100]),
            )
            conn.commit()
        return token_id

    def get_refresh_token(self, token_hash: str) -> Optional[dict[str, Any]]:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM refresh_tokens WHERE token_hash = ?", (token_hash,)).fetchone()
            return dict(row) if row else None

    def revoke_refresh_token(self, token_id: str, *, replaced_by: Optional[str] = None) -> None:
        with self.connect() as conn:
            conn.execute(
                "UPDATE refresh_tokens SET revoked_at = ?, replaced_by = ? WHERE id = ?",
                (utc_now(), replaced_by, token_id),
            )
            conn.commit()

    # ------------------------------------------------------------------ audit

    def audit(self, user_id: Optional[str], action: str, resource: str = "", detail: Optional[dict[str, Any]] = None) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO audit_events (id, user_id, action, resource, detail_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (str(uuid.uuid4()), user_id, action, resource, _json_dumps(detail or {}), utc_now()),
            )
            conn.commit()

    # ------------------------------------------------------------------ market

    def get_market_config(self, user_id: str) -> Optional[dict[str, Any]]:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT config_json FROM market_dashboard_configs WHERE user_id = ?",
                (user_id,),
            ).fetchone()
            return _json_loads(row["config_json"], {}) if row else None

    def save_market_config(self, user_id: str, config: dict[str, Any]) -> dict[str, Any]:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO market_dashboard_configs (user_id, config_json, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    config_json = excluded.config_json,
                    updated_at = excluded.updated_at
                """,
                (user_id, _json_dumps(config), utc_now()),
            )
            conn.commit()
        return config

    # ---------------------------------------------------------------- scheduler

    def upsert_scheduler_task(self, task: dict[str, Any]) -> None:
        now = utc_now()
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO scheduler_tasks (id, user_id, task_json, enabled, next_run_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    user_id = excluded.user_id,
                    task_json = excluded.task_json,
                    enabled = excluded.enabled,
                    next_run_at = excluded.next_run_at,
                    updated_at = excluded.updated_at
                """,
                (
                    task["id"],
                    task["user_id"],
                    _json_dumps(task),
                    int(bool(task.get("enabled", True))),
                    task.get("next_run_at"),
                    now,
                ),
            )
            conn.commit()

    def delete_scheduler_task(self, task_id: str, user_id: Optional[str] = None) -> bool:
        query = "DELETE FROM scheduler_tasks WHERE id = ?"
        params: list[Any] = [task_id]
        if user_id:
            query += " AND user_id = ?"
            params.append(user_id)
        with self.connect() as conn:
            cursor = conn.execute(query, params)
            conn.commit()
            return cursor.rowcount > 0

    def get_scheduler_task(self, task_id: str, user_id: Optional[str] = None) -> Optional[dict[str, Any]]:
        query = "SELECT task_json FROM scheduler_tasks WHERE id = ?"
        params: list[Any] = [task_id]
        if user_id:
            query += " AND user_id = ?"
            params.append(user_id)
        with self.connect() as conn:
            row = conn.execute(query, params).fetchone()
            return _json_loads(row["task_json"], {}) if row else None

    def list_scheduler_tasks(self, user_id: Optional[str] = None, enabled_only: bool = False) -> list[dict[str, Any]]:
        query = "SELECT task_json FROM scheduler_tasks"
        clauses: list[str] = []
        params: list[Any] = []
        if user_id:
            clauses.append("user_id = ?")
            params.append(user_id)
        if enabled_only:
            clauses.append("enabled = 1")
        if clauses:
            query += " WHERE " + " AND ".join(clauses)
        query += " ORDER BY COALESCE(next_run_at, 'z') ASC"
        with self.connect() as conn:
            rows = conn.execute(query, params).fetchall()
            return [_json_loads(row["task_json"], {}) for row in rows]

    def add_scheduler_run(self, run: dict[str, Any], max_records: int = 500) -> dict[str, Any]:
        record = {"id": uuid.uuid4().hex[:12], **run}
        user_id = record.get("user_id") or ""
        started = record.get("started_at") or utc_now()
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO scheduler_runs (id, user_id, task_id, run_json, started_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (record["id"], user_id, record.get("task_id", ""), _json_dumps(record), started),
            )
            if max_records > 0:
                conn.execute(
                    """
                    DELETE FROM scheduler_runs
                    WHERE id IN (
                        SELECT id FROM scheduler_runs
                        WHERE user_id = ?
                        ORDER BY started_at DESC
                        LIMIT -1 OFFSET ?
                    )
                    """,
                    (user_id, max_records),
                )
            conn.commit()
        return record

    def list_scheduler_runs(self, user_id: Optional[str] = None, task_id: Optional[str] = None, limit: int = 50) -> list[dict[str, Any]]:
        query = "SELECT run_json FROM scheduler_runs"
        clauses: list[str] = []
        params: list[Any] = []
        if user_id:
            clauses.append("user_id = ?")
            params.append(user_id)
        if task_id:
            clauses.append("task_id = ?")
            params.append(task_id)
        if clauses:
            query += " WHERE " + " AND ".join(clauses)
        query += " ORDER BY started_at DESC LIMIT ?"
        params.append(max(1, min(int(limit or 50), 200)))
        with self.connect() as conn:
            rows = conn.execute(query, params).fetchall()
            return [_json_loads(row["run_json"], {}) for row in rows]

    # ------------------------------------------------------------------ mcp

    def get_mcp_oauth_entry(self, server_name: str, user_id: Optional[str] = None) -> dict[str, Any]:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT entry_json FROM mcp_oauth_tokens WHERE user_id = ? AND server_name = ?",
                (user_id or "", server_name),
            ).fetchone()
            return self._decrypt_json_value(conn, _json_loads(row["entry_json"], {})) if row else {}

    def set_mcp_oauth_entry(self, server_name: str, entry: dict[str, Any], user_id: Optional[str] = None) -> None:
        with self.connect() as conn:
            encrypted_entry = self._encrypt_json_value(conn, entry)
            conn.execute(
                """
                INSERT INTO mcp_oauth_tokens (user_id, server_name, entry_json, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id, server_name) DO UPDATE SET
                    entry_json = excluded.entry_json,
                    updated_at = excluded.updated_at
                """,
                (user_id or "", server_name, _json_dumps(encrypted_entry), utc_now()),
            )
            conn.commit()

    def clear_mcp_oauth_entry(self, server_name: str, user_id: Optional[str] = None) -> None:
        with self.connect() as conn:
            conn.execute(
                "DELETE FROM mcp_oauth_tokens WHERE user_id = ? AND server_name = ?",
                (user_id or "", server_name),
            )
            conn.commit()

    # ------------------------------------------------------------------ skills

    def load_skill_configs(self) -> dict[str, dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute("SELECT name, config_json FROM skill_configs").fetchall()
            return {row["name"]: _json_loads(row["config_json"], {}) for row in rows}

    def save_skill_configs(self, configs: dict[str, dict[str, Any]]) -> None:
        now = utc_now()
        with self.connect() as conn:
            existing = {row["name"] for row in conn.execute("SELECT name FROM skill_configs").fetchall()}
            incoming = set(configs)
            for name in existing - incoming:
                conn.execute("DELETE FROM skill_configs WHERE name = ?", (name,))
            for name, config in configs.items():
                conn.execute(
                    """
                    INSERT INTO skill_configs (name, config_json, updated_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(name) DO UPDATE SET
                        config_json = excluded.config_json,
                        updated_at = excluded.updated_at
                    """,
                    (name, _json_dumps(config), now),
                )
            conn.commit()

    # ---------------------------------------------------------------- migration

    def migrate_legacy_user_data(self, admin_user_id: str, workspace_dir: str) -> None:
        if self.get_system_value("migration.legacy_user_data"):
            return
        root = Path(workspace_dir).expanduser()
        migrations = [
            ("sessions", self._migrate_sessions_db, (root / "sessions" / "sessions.db", admin_user_id)),
            ("watchlist", self._migrate_watchlist_db, (root / "watchlist" / "watchlist.db", admin_user_id)),
            ("portfolio", self._migrate_portfolio_db, (root / "portfolio" / "portfolio.db", admin_user_id)),
            ("market_config", self._migrate_market_config, (root / "market_config.json", admin_user_id)),
            (
                "scheduler",
                self._migrate_scheduler_json,
                (root / "scheduler" / "tasks.json", root / "scheduler" / "runs.json", admin_user_id),
            ),
            ("mcp_tokens", self._migrate_mcp_tokens, (root / "mcp" / "oauth_tokens.json",)),
            ("skill_configs", self._migrate_skill_configs, (root / "skills" / "skills_config.json",)),
        ]
        for name, migrate, args in migrations:
            try:
                migrate(*args)
            except Exception as exc:
                source = args[0] if args else root
                logger.warning("Skipped legacy %s migration from %s: %s", name, source, exc)
        self.set_system_value("migration.legacy_user_data", utc_now())

    def _migrate_sessions_db(self, db_path: Path, admin_user_id: str) -> None:
        if not db_path.exists():
            return
        with sqlite3.connect(str(db_path)) as conn:
            cols = {row[1] for row in conn.execute("PRAGMA table_info(sessions)").fetchall()}
            if "user_id" not in cols:
                conn.execute("ALTER TABLE sessions ADD COLUMN user_id TEXT")
            conn.execute("UPDATE sessions SET user_id = ? WHERE user_id IS NULL OR user_id = ''", (admin_user_id,))
            conn.commit()

    def _migrate_watchlist_db(self, db_path: Path, admin_user_id: str) -> None:
        if not db_path.exists():
            return
        with sqlite3.connect(str(db_path)) as conn:
            cols = {row[1] for row in conn.execute("PRAGMA table_info(watchlist_items)").fetchall()}
            if "user_id" not in cols:
                conn.execute("ALTER TABLE watchlist_items ADD COLUMN user_id TEXT NOT NULL DEFAULT ''")
            conn.execute("UPDATE watchlist_items SET user_id = ? WHERE user_id = ''", (admin_user_id,))
            conn.execute("CREATE INDEX IF NOT EXISTS idx_watchlist_user_category ON watchlist_items(user_id, category)")
            conn.commit()

    def _migrate_portfolio_db(self, db_path: Path, admin_user_id: str) -> None:
        if not db_path.exists():
            return
        with sqlite3.connect(str(db_path)) as conn:
            item_cols = {row[1] for row in conn.execute("PRAGMA table_info(portfolio_items)").fetchall()}
            if "user_id" not in item_cols:
                conn.execute("ALTER TABLE portfolio_items ADD COLUMN user_id TEXT NOT NULL DEFAULT ''")
            conn.execute("UPDATE portfolio_items SET user_id = ? WHERE user_id = ''", (admin_user_id,))
            settings_cols = {row[1] for row in conn.execute("PRAGMA table_info(portfolio_settings)").fetchall()}
            if "user_id" not in settings_cols:
                conn.execute("ALTER TABLE portfolio_settings ADD COLUMN user_id TEXT NOT NULL DEFAULT ''")
            conn.execute("UPDATE portfolio_settings SET user_id = ? WHERE user_id = ''", (admin_user_id,))
            conn.execute("CREATE INDEX IF NOT EXISTS idx_portfolio_user_market ON portfolio_items(user_id, market)")
            conn.commit()

    def _migrate_market_config(self, path: Path, admin_user_id: str) -> None:
        if not path.exists() or self.get_market_config(admin_user_id):
            return
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return
        if isinstance(data, dict):
            self.save_market_config(admin_user_id, data)

    def _migrate_scheduler_json(self, tasks_path: Path, runs_path: Path, admin_user_id: str) -> None:
        if tasks_path.exists():
            try:
                data = json.loads(tasks_path.read_text(encoding="utf-8"))
                tasks = data.get("tasks", {}) if isinstance(data, dict) else {}
            except Exception:
                tasks = {}
            if isinstance(tasks, dict):
                for task in tasks.values():
                    if isinstance(task, dict):
                        task["user_id"] = task.get("user_id") or admin_user_id
                        self.upsert_scheduler_task(task)
        if runs_path.exists():
            try:
                data = json.loads(runs_path.read_text(encoding="utf-8"))
                runs = data.get("runs", []) if isinstance(data, dict) else []
            except Exception:
                runs = []
            if isinstance(runs, list):
                for run in runs:
                    if isinstance(run, dict):
                        run["user_id"] = run.get("user_id") or admin_user_id
                        self.add_scheduler_run(run)

    def _migrate_mcp_tokens(self, path: Path) -> None:
        if not path.exists():
            return
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return
        if isinstance(data, dict):
            for server_name, entry in data.items():
                if isinstance(entry, dict) and not self.get_mcp_oauth_entry(server_name):
                    self.set_mcp_oauth_entry(server_name, entry)

    def _migrate_skill_configs(self, path: Path) -> None:
        if not path.exists() or self.load_skill_configs():
            return
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return
        if isinstance(data, dict):
            self.save_skill_configs(data)


_app_store: Optional[AppStore] = None


def get_app_store() -> AppStore:
    global _app_store
    if _app_store is None:
        _app_store = AppStore()
    return _app_store


def reset_app_store_for_tests(db_path: Optional[str | Path] = None) -> AppStore:
    global _app_store
    _app_store = AppStore(db_path)
    return _app_store
