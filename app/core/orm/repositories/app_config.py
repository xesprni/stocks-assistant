"""AppConfigRepository implementation."""

from __future__ import annotations

import json
import logging
from copy import deepcopy
from pathlib import Path
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session, sessionmaker

from app.core.app_store_defs import (
    CONFIG_ENCRYPTION_KEY,
    SENSITIVE_CONFIG_KEYS,
    is_encrypted_payload,
    json_dumps,
    json_loads,
    utc_now,
)
from app.core.orm.database import session_scope
from app.core.orm.models.app import AppConfig, MCPOAuthToken, SubagentRole, SystemKV, UserConfig

logger = logging.getLogger("stocks-assistant.app_store")


def _looks_secret_key(key: str) -> bool:
    lower = key.lower()
    return any(
        part in lower
        for part in ("authorization", "token", "secret", "password", "api-key", "apikey", "key")
    )


def _auth_value_is_sensitive(key: str, auth: dict[str, Any]) -> bool:
    lower = key.lower()
    if _looks_secret_key(key) or lower in {"password", "client_secret"}:
        return True
    if lower == "value":
        return _looks_secret_key(str(auth.get("name") or ""))
    return False


class AppConfigRepository:
    """Application app config persistence."""

    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self.session_factory = session_factory

    def get_system_value(self, key: str, *, session: Session | None = None) -> str | None:
        if session is not None:
            row = session.get(SystemKV, key)
            return str(row.value) if row else None
        with session_scope(self.session_factory) as own_session:
            return self.get_system_value(key, session=own_session)

    def set_system_value(self, key: str, value: str) -> None:
        with session_scope(self.session_factory) as session:
            stmt = sqlite_insert(SystemKV).values(key=key, value=value, updated_at=utc_now())
            session.execute(
                stmt.on_conflict_do_update(
                    index_elements=[SystemKV.key],
                    set_={"value": stmt.excluded.value, "updated_at": stmt.excluded.updated_at},
                )
            )

    def _fernet(self, session: Session) -> Fernet:
        key = self.get_system_value(CONFIG_ENCRYPTION_KEY, session=session)
        if not key:
            key = Fernet.generate_key().decode("ascii")
            session.add(SystemKV(key=CONFIG_ENCRYPTION_KEY, value=key, updated_at=utc_now()))
            session.flush()
        return Fernet(key.encode("ascii"))

    def _encrypt_json_value(self, session: Session, value: Any) -> dict[str, str]:
        if is_encrypted_payload(value):
            return value
        payload = json_dumps(value).encode("utf-8")
        encrypted = self._fernet(session).encrypt(payload).decode("ascii")
        from app.core.app_store_defs import ENCRYPTED_MARKER, ENCRYPTED_VERSION

        return {ENCRYPTED_MARKER: ENCRYPTED_VERSION, "value": encrypted}

    def _decrypt_json_value(self, session: Session, value: Any) -> Any:
        if not is_encrypted_payload(value):
            return value
        try:
            decrypted = (
                self._fernet(session).decrypt(value["value"].encode("ascii")).decode("utf-8")
            )
            return json_loads(decrypted)
        except (InvalidToken, ValueError, TypeError) as exc:
            logger.warning("Failed to decrypt stored application secret: %s", exc)
            return ""

    def _encrypt_secret_string(self, session: Session, value: Any) -> Any:
        if not isinstance(value, str) or not value:
            return value
        return self._encrypt_json_value(session, value)

    def _decrypt_recursive(self, session: Session, value: Any) -> Any:
        if is_encrypted_payload(value):
            return self._decrypt_json_value(session, value)
        if isinstance(value, dict):
            return {key: self._decrypt_recursive(session, item) for key, item in value.items()}
        if isinstance(value, list):
            return [self._decrypt_recursive(session, item) for item in value]
        return value

    def _encrypt_mcp_server_config(
        self, session: Session, config: dict[str, Any]
    ) -> dict[str, Any]:
        encrypted = deepcopy(config)
        for key, value in list(encrypted.items()):
            if _looks_secret_key(str(key)):
                encrypted[key] = self._encrypt_secret_string(session, value)

        headers = encrypted.get("headers")
        if isinstance(headers, dict):
            encrypted["headers"] = {
                key: self._encrypt_secret_string(session, value)
                if _looks_secret_key(str(key))
                else value
                for key, value in headers.items()
            }

        env = encrypted.get("env")
        if isinstance(env, dict):
            encrypted["env"] = {
                key: self._encrypt_secret_string(session, value)
                if _looks_secret_key(str(key))
                else value
                for key, value in env.items()
            }

        auth = encrypted.get("auth")
        if isinstance(auth, str):
            encrypted["auth"] = self._encrypt_secret_string(session, auth)
        elif isinstance(auth, dict):
            encrypted["auth"] = {
                key: self._encrypt_secret_string(session, value)
                if _auth_value_is_sensitive(str(key), auth)
                else value
                for key, value in auth.items()
            }
        return encrypted

    def _encrypt_mcp_servers(self, session: Session, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        return {
            name: self._encrypt_mcp_server_config(session, config)
            if isinstance(config, dict)
            else config
            for name, config in value.items()
        }

    def _encode_config_value(self, session: Session, key: str, value: Any) -> Any:
        if key in SENSITIVE_CONFIG_KEYS and isinstance(value, str) and value:
            return self._encrypt_json_value(session, value)
        if key == "mcp_servers":
            return self._encrypt_mcp_servers(session, value)
        return value

    def _decode_config_value(self, session: Session, key: str, value: Any) -> Any:
        if key in SENSITIVE_CONFIG_KEYS:
            return self._decrypt_json_value(session, value)
        return self._decrypt_recursive(session, value)

    def _value_needs_secret_migration(self, key: str, value: Any) -> bool:
        if key in SENSITIVE_CONFIG_KEYS:
            return isinstance(value, str) and bool(value)
        if key == "mcp_servers":
            return isinstance(value, dict) and not is_encrypted_payload(value)
        return False

    def _migrate_plaintext_secrets(self, session: Session) -> None:
        for row in session.scalars(select(AppConfig)).all():
            value = json_loads(row.value_json)
            if not self._value_needs_secret_migration(row.key, value):
                continue
            encoded = self._encode_config_value(session, row.key, value)
            if encoded != value:
                row.value_json = json_dumps(encoded)
                row.updated_at = utc_now()

        for row in session.scalars(select(MCPOAuthToken)).all():
            entry = json_loads(row.entry_json, {})
            if is_encrypted_payload(entry):
                continue
            row.entry_json = json_dumps(self._encrypt_json_value(session, entry))
            row.updated_at = utc_now()

    def get_config(self) -> dict[str, Any]:
        with session_scope(self.session_factory) as session:
            rows = session.scalars(select(AppConfig).order_by(AppConfig.key)).all()
            config = {
                row.key: self._decode_config_value(session, row.key, json_loads(row.value_json))
                for row in rows
            }
            subagent_roles = self.get_subagent_roles(session=session)
            if subagent_roles:
                config["multi_agent_roles"] = subagent_roles
            return config

    def set_config_values(self, values: dict[str, Any], *, session: Session | None = None) -> None:
        if not values:
            return
        if session is None:
            with session_scope(self.session_factory) as own_session:
                self.set_config_values(values, session=own_session)
            return
        now = utc_now()
        for key, value in values.items():
            if key == "multi_agent_roles":
                self.save_subagent_roles(value, session=session)
                existing = session.get(AppConfig, key)
                if existing:
                    session.delete(existing)
                continue
            encoded = self._encode_config_value(session, key, value)
            stmt = sqlite_insert(AppConfig).values(
                key=key, value_json=json_dumps(encoded), updated_at=now
            )
            session.execute(
                stmt.on_conflict_do_update(
                    index_elements=[AppConfig.key],
                    set_={
                        "value_json": stmt.excluded.value_json,
                        "updated_at": stmt.excluded.updated_at,
                    },
                )
            )

    def has_config(self) -> bool:
        with session_scope(self.session_factory) as session:
            return bool(session.scalar(select(AppConfig.key).limit(1)))

    def get_user_config(self, user_id: str) -> dict[str, Any]:
        if not user_id:
            return {}
        with session_scope(self.session_factory) as session:
            rows = session.scalars(select(UserConfig).where(UserConfig.user_id == user_id)).all()
            return {
                row.key: self._decode_config_value(session, row.key, json_loads(row.value_json))
                for row in rows
            }

    def set_user_config_values(
        self, user_id: str, values: dict[str, Any], *, session: Session | None = None
    ) -> None:
        if not user_id or not values:
            return
        if session is None:
            with session_scope(self.session_factory) as own_session:
                self.set_user_config_values(user_id, values, session=own_session)
            return
        now = utc_now()
        for key, value in values.items():
            encoded = self._encode_config_value(session, key, value)
            stmt = sqlite_insert(UserConfig).values(
                user_id=user_id,
                key=key,
                value_json=json_dumps(encoded),
                updated_at=now,
            )
            session.execute(
                stmt.on_conflict_do_update(
                    index_elements=[UserConfig.user_id, UserConfig.key],
                    set_={
                        "value_json": stmt.excluded.value_json,
                        "updated_at": stmt.excluded.updated_at,
                    },
                )
            )

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

    def _migrate_subagent_roles_from_config(self, session: Session) -> None:
        if session.scalar(select(SubagentRole.name).limit(1)):
            return
        row = session.get(AppConfig, "multi_agent_roles")
        if not row:
            return
        roles = json_loads(row.value_json, {})
        if isinstance(roles, dict):
            self.save_subagent_roles(roles, session=session)
        session.delete(row)

    def get_subagent_roles(self, *, session: Session | None = None) -> dict[str, dict[str, Any]]:
        if session is not None:
            self._migrate_subagent_roles_from_config(session)
            rows = session.scalars(select(SubagentRole).order_by(SubagentRole.name)).all()
            return {row.name: json_loads(row.role_json, {}) for row in rows}
        with session_scope(self.session_factory) as own_session:
            return self.get_subagent_roles(session=own_session)

    def save_subagent_roles(
        self,
        roles: dict[str, dict[str, Any]],
        *,
        session: Session | None = None,
    ) -> None:
        if not isinstance(roles, dict):
            raise ValueError("multi_agent_roles must be an object")
        if session is not None:
            self._save_subagent_roles(session, roles)
            return
        with session_scope(self.session_factory) as own_session:
            self._save_subagent_roles(own_session, roles)

    def _save_subagent_roles(self, session: Session, roles: dict[str, dict[str, Any]]) -> None:
        now = utc_now()
        existing = {row.name for row in session.scalars(select(SubagentRole)).all()}
        incoming = set(roles)
        for name in existing - incoming:
            role = session.get(SubagentRole, name)
            if role:
                session.delete(role)
        for name, role in roles.items():
            if not isinstance(name, str) or not name:
                raise ValueError("SubAgent role names must be non-empty strings")
            if not isinstance(role, dict):
                raise ValueError(f"SubAgent role '{name}' must be an object")
            stmt = sqlite_insert(SubagentRole).values(
                name=name, role_json=json_dumps(role), updated_at=now
            )
            session.execute(
                stmt.on_conflict_do_update(
                    index_elements=[SubagentRole.name],
                    set_={
                        "role_json": stmt.excluded.role_json,
                        "updated_at": stmt.excluded.updated_at,
                    },
                )
            )
