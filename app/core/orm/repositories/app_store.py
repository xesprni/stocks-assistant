"""Application store repository backed by SQLAlchemy ORM."""

from __future__ import annotations

import json
import logging
import secrets
import uuid
from copy import deepcopy
from pathlib import Path
from typing import Any, Iterable, Optional

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import delete, desc, func, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.core.app_store_defs import (
    CONFIG_ENCRYPTION_KEY,
    JWT_SECRET_KEY,
    PAGE_PERMISSION_REQUIREMENTS,
    PERMISSION_DESCRIPTIONS,
    ROLE_PERMISSIONS,
    SENSITIVE_CONFIG_KEYS,
    app_db_path,
    is_encrypted_payload,
    json_dumps,
    json_loads,
    utc_now,
)
from app.core.orm.database import connect_sqlite, create_session_factory, create_sqlite_engine, session_scope
from app.core.orm.migrations import (
    init_app_schema,
    migrate_portfolio_db_user_scope,
    migrate_sessions_db_user_scope,
    migrate_watchlist_db_user_scope,
)
from app.core.orm.models.app import (
    AppConfig,
    AuditEvent,
    LoginSession,
    MarketDashboardConfig,
    MCPOAuthToken,
    PagePermission,
    Permission,
    RefreshToken,
    Role,
    RolePermission,
    SchedulerRun,
    SchedulerTask,
    SkillConfig,
    SubagentRole,
    SystemKV,
    User,
    UserConfig,
    UserRole,
)

logger = logging.getLogger("stocks-assistant.app_store")


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


class AppStoreRepository:
    """Repository for application-owned relational data."""

    def __init__(self, db_path: Optional[Path | str] = None):
        self.db_path = Path(db_path).expanduser() if db_path else app_db_path()
        self.engine = create_sqlite_engine(self.db_path)
        self.session_factory = create_session_factory(self.engine)
        init_app_schema(self.engine)
        self._init_seed_data()

    def connect(self):
        """Return a DB-API connection for legacy tests and one-off maintenance."""
        return connect_sqlite(self.db_path)

    def _init_seed_data(self) -> None:
        with session_scope(self.session_factory) as session:
            self._seed_rbac(session)
            if not self.get_system_value(JWT_SECRET_KEY, session=session):
                session.add(SystemKV(key=JWT_SECRET_KEY, value=secrets.token_urlsafe(48), updated_at=utc_now()))
            if not self.get_system_value(CONFIG_ENCRYPTION_KEY, session=session):
                session.add(
                    SystemKV(
                        key=CONFIG_ENCRYPTION_KEY,
                        value=Fernet.generate_key().decode("ascii"),
                        updated_at=utc_now(),
                    )
                )
            session.flush()
            self._migrate_plaintext_secrets(session)
            self._migrate_subagent_roles_from_config(session)

    def _seed_rbac(self, session: Session) -> None:
        now = utc_now()
        for key, description in PERMISSION_DESCRIPTIONS.items():
            stmt = sqlite_insert(Permission).values(key=key, description=description)
            session.execute(stmt.on_conflict_do_update(index_elements=[Permission.key], set_={"description": description}))

        for page, permission in PAGE_PERMISSION_REQUIREMENTS.items():
            stmt = sqlite_insert(PagePermission).values(page=page, permission_key=permission, updated_at=now)
            session.execute(stmt.on_conflict_do_nothing(index_elements=[PagePermission.page]))

        for role_name, permissions in ROLE_PERMISSIONS.items():
            role = session.scalar(select(Role).where(Role.name == role_name))
            if not role:
                role = Role(
                    id=role_name,
                    name=role_name,
                    description=f"Built-in {role_name} role",
                    builtin=1,
                    created_at=now,
                    updated_at=now,
                )
                session.add(role)
                session.flush()
                for permission in permissions:
                    session.execute(
                        sqlite_insert(RolePermission)
                        .values(role_id=role.id, permission_key=permission)
                        .on_conflict_do_nothing(index_elements=[RolePermission.role_id, RolePermission.permission_key])
                    )
            else:
                role.builtin = 1

    # ------------------------------------------------------------------ system

    def get_system_value(self, key: str, *, session: Optional[Session] = None) -> Optional[str]:
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

    # ------------------------------------------------------------------ encryption

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
            decrypted = self._fernet(session).decrypt(value["value"].encode("ascii")).decode("utf-8")
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

    def _encrypt_mcp_server_config(self, session: Session, config: dict[str, Any]) -> dict[str, Any]:
        encrypted = deepcopy(config)
        for key, value in list(encrypted.items()):
            if _looks_secret_key(str(key)):
                encrypted[key] = self._encrypt_secret_string(session, value)

        headers = encrypted.get("headers")
        if isinstance(headers, dict):
            encrypted["headers"] = {
                key: self._encrypt_secret_string(session, value) if _looks_secret_key(str(key)) else value
                for key, value in headers.items()
            }

        env = encrypted.get("env")
        if isinstance(env, dict):
            encrypted["env"] = {
                key: self._encrypt_secret_string(session, value) if _looks_secret_key(str(key)) else value
                for key, value in env.items()
            }

        auth = encrypted.get("auth")
        if isinstance(auth, str):
            encrypted["auth"] = self._encrypt_secret_string(session, auth)
        elif isinstance(auth, dict):
            encrypted["auth"] = {
                key: self._encrypt_secret_string(session, value) if _auth_value_is_sensitive(str(key), auth) else value
                for key, value in auth.items()
            }
        return encrypted

    def _encrypt_mcp_servers(self, session: Session, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        return {
            name: self._encrypt_mcp_server_config(session, config) if isinstance(config, dict) else config
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
        if key == "mcp_servers":
            return self._decrypt_recursive(session, value)
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

    # ------------------------------------------------------------------ config

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

    def set_config_values(self, values: dict[str, Any]) -> None:
        if not values:
            return
        now = utc_now()
        with session_scope(self.session_factory) as session:
            for key, value in values.items():
                if key == "multi_agent_roles":
                    self.save_subagent_roles(value, session=session)
                    existing = session.get(AppConfig, key)
                    if existing:
                        session.delete(existing)
                    continue
                encoded = self._encode_config_value(session, key, value)
                stmt = sqlite_insert(AppConfig).values(key=key, value_json=json_dumps(encoded), updated_at=now)
                session.execute(
                    stmt.on_conflict_do_update(
                        index_elements=[AppConfig.key],
                        set_={"value_json": stmt.excluded.value_json, "updated_at": stmt.excluded.updated_at},
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

    def set_user_config_values(self, user_id: str, values: dict[str, Any]) -> None:
        if not user_id or not values:
            return
        now = utc_now()
        with session_scope(self.session_factory) as session:
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
                        set_={"value_json": stmt.excluded.value_json, "updated_at": stmt.excluded.updated_at},
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

    # ------------------------------------------------------------------ subagents

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

    def get_subagent_roles(self, *, session: Optional[Session] = None) -> dict[str, dict[str, Any]]:
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
        session: Optional[Session] = None,
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
            stmt = sqlite_insert(SubagentRole).values(name=name, role_json=json_dumps(role), updated_at=now)
            session.execute(
                stmt.on_conflict_do_update(
                    index_elements=[SubagentRole.name],
                    set_={"role_json": stmt.excluded.role_json, "updated_at": stmt.excluded.updated_at},
                )
            )

    # ------------------------------------------------------------------ users

    def has_users(self) -> bool:
        with session_scope(self.session_factory) as session:
            return bool(session.scalar(select(User.id).limit(1)))

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
        with session_scope(self.session_factory) as session:
            user = User(
                id=user_id,
                username=username.strip(),
                password_hash=password_hash,
                display_name=display_name.strip(),
                is_active=int(is_active),
                created_at=now,
                updated_at=now,
            )
            session.add(user)
            session.flush()
            for role_name in roles:
                role = session.scalar(select(Role).where(Role.name == role_name))
                if not role:
                    raise ValueError(f"Role not found: {role_name}")
                session.execute(
                    sqlite_insert(UserRole)
                    .values(user_id=user_id, role_id=role.id)
                    .on_conflict_do_nothing(index_elements=[UserRole.user_id, UserRole.role_id])
                )
        return self.get_user_by_id(user_id) or {}

    def get_user_by_username(self, username: str) -> Optional[dict[str, Any]]:
        with session_scope(self.session_factory) as session:
            row = session.scalar(select(User).where(User.username == username.strip()))
            return self._user_to_dict(session, row) if row else None

    def get_user_by_id(self, user_id: str) -> Optional[dict[str, Any]]:
        with session_scope(self.session_factory) as session:
            row = session.get(User, user_id)
            return self._user_to_dict(session, row) if row else None

    def list_users(self) -> list[dict[str, Any]]:
        with session_scope(self.session_factory) as session:
            rows = session.scalars(select(User).order_by(User.created_at.asc())).all()
            return [self._user_to_dict(session, row) for row in rows]

    def update_user(
        self,
        user_id: str,
        *,
        display_name: Optional[str] = None,
        is_active: Optional[bool] = None,
        password_hash: Optional[str] = None,
        role_names: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        with session_scope(self.session_factory) as session:
            user = session.get(User, user_id)
            if not user:
                raise KeyError(user_id)
            if display_name is not None:
                user.display_name = display_name.strip()
            if is_active is not None:
                user.is_active = int(is_active)
            if password_hash is not None:
                user.password_hash = password_hash
            user.updated_at = utc_now()
            if role_names is not None:
                session.execute(delete(UserRole).where(UserRole.user_id == user_id))
                for role_name in role_names:
                    role = session.scalar(select(Role).where(Role.name == role_name))
                    if not role:
                        raise ValueError(f"Role not found: {role_name}")
                    session.execute(
                        sqlite_insert(UserRole)
                        .values(user_id=user_id, role_id=role.id)
                        .on_conflict_do_nothing(index_elements=[UserRole.user_id, UserRole.role_id])
                    )
        return self.get_user_by_id(user_id) or {}

    def touch_login(self, user_id: str) -> None:
        with session_scope(self.session_factory) as session:
            user = session.get(User, user_id)
            if user:
                now = utc_now()
                user.last_login_at = now
                user.updated_at = now

    def _user_to_dict(self, session: Session, row: User) -> dict[str, Any]:
        role_rows = session.scalars(
            select(Role.name)
            .join(UserRole, UserRole.role_id == Role.id)
            .where(UserRole.user_id == row.id)
            .order_by(Role.name.asc())
        ).all()
        permissions = self.get_user_permissions(row.id, session=session)
        return {
            "id": row.id,
            "username": row.username,
            "password_hash": row.password_hash,
            "display_name": row.display_name,
            "is_active": bool(row.is_active),
            "roles": list(role_rows),
            "permissions": sorted(permissions),
            "created_at": row.created_at,
            "updated_at": row.updated_at,
            "last_login_at": row.last_login_at,
        }

    def get_user_permissions(self, user_id: str, *, session: Optional[Session] = None) -> set[str]:
        if session is not None:
            rows = session.scalars(
                select(RolePermission.permission_key)
                .join(UserRole, UserRole.role_id == RolePermission.role_id)
                .where(UserRole.user_id == user_id)
            ).all()
            permissions = set(rows)
            if "*" in permissions:
                permissions.update(PERMISSION_DESCRIPTIONS.keys())
            return permissions
        with session_scope(self.session_factory) as own_session:
            return self.get_user_permissions(user_id, session=own_session)

    # ------------------------------------------------------------------ roles

    def list_roles(self) -> list[dict[str, Any]]:
        with session_scope(self.session_factory) as session:
            rows = session.scalars(select(Role).order_by(Role.builtin.desc(), Role.name.asc())).all()
            return [self._role_to_dict(session, row) for row in rows]

    def upsert_role(self, name: str, description: str, permissions: list[str]) -> dict[str, Any]:
        clean = name.strip()
        now = utc_now()
        with session_scope(self.session_factory) as session:
            role = session.scalar(select(Role).where(Role.name == clean))
            role_id = role.id if role else str(uuid.uuid4())
            builtin = int(role.builtin) if role else 0
            stmt = sqlite_insert(Role).values(
                id=role_id,
                name=clean,
                description=description.strip(),
                builtin=builtin,
                created_at=now,
                updated_at=now,
            )
            session.execute(
                stmt.on_conflict_do_update(
                    index_elements=[Role.name],
                    set_={"description": stmt.excluded.description, "updated_at": stmt.excluded.updated_at},
                )
            )
            session.execute(delete(RolePermission).where(RolePermission.role_id == role_id))
            for permission in permissions:
                if permission not in PERMISSION_DESCRIPTIONS:
                    raise ValueError(f"Unknown permission: {permission}")
                session.add(RolePermission(role_id=role_id, permission_key=permission))
            session.flush()
            row = session.get(Role, role_id)
            return self._role_to_dict(session, row)

    def list_page_permissions(self) -> dict[str, str]:
        with session_scope(self.session_factory) as session:
            rows = session.scalars(select(PagePermission).order_by(PagePermission.page.asc())).all()
            return {row.page: row.permission_key for row in rows}

    def upsert_page_permission(self, page: str, permission: str) -> dict[str, str]:
        clean_page = page.strip()
        clean_permission = permission.strip()
        if not clean_page:
            raise ValueError("Page is required")
        if clean_permission not in PERMISSION_DESCRIPTIONS:
            raise ValueError(f"Unknown permission: {clean_permission}")
        now = utc_now()
        with session_scope(self.session_factory) as session:
            stmt = sqlite_insert(PagePermission).values(page=clean_page, permission_key=clean_permission, updated_at=now)
            session.execute(
                stmt.on_conflict_do_update(
                    index_elements=[PagePermission.page],
                    set_={"permission_key": stmt.excluded.permission_key, "updated_at": stmt.excluded.updated_at},
                )
            )
        return self.list_page_permissions()

    def _role_to_dict(self, session: Session, row: Role) -> dict[str, Any]:
        rows = session.scalars(
            select(RolePermission.permission_key)
            .where(RolePermission.role_id == row.id)
            .order_by(RolePermission.permission_key.asc())
        ).all()
        return {
            "id": row.id,
            "name": row.name,
            "description": row.description,
            "builtin": bool(row.builtin),
            "permissions": list(rows),
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }

    # ------------------------------------------------------------------ tokens

    def create_login_session(
        self,
        user_id: str,
        *,
        expires_at: str,
        user_agent: str = "",
        ip_address: str = "",
        device_id: str = "",
    ) -> dict[str, Any]:
        session_id = str(uuid.uuid4())
        clean_device_id = (device_id or session_id).strip()[:128] or session_id
        now = utc_now()
        with session_scope(self.session_factory) as session:
            # 设备维度只保留一个活跃登录，避免同一浏览器反复登录显示成多台设备。
            old_sessions = session.scalars(
                select(LoginSession).where(
                    LoginSession.user_id == user_id,
                    LoginSession.device_id == clean_device_id,
                    LoginSession.revoked_at.is_(None),
                )
            ).all()
            for old_session in old_sessions:
                old_session.revoked_at = now
                for token in session.scalars(select(RefreshToken).where(RefreshToken.session_id == old_session.id)).all():
                    if not token.revoked_at:
                        token.revoked_at = now
            session.add(
                LoginSession(
                    id=session_id,
                    user_id=user_id,
                    device_id=clean_device_id,
                    created_at=now,
                    last_seen_at=now,
                    expires_at=expires_at,
                    user_agent=user_agent[:500],
                    ip_address=ip_address[:100],
                    last_ip_address=ip_address[:100],
                )
            )
        login_session = self.get_login_session(session_id)
        if not login_session:
            raise RuntimeError("Failed to create login session")
        return login_session

    def get_login_session(self, session_id: str) -> Optional[dict[str, Any]]:
        with session_scope(self.session_factory) as session:
            row = session.get(LoginSession, session_id)
            return self._login_session_to_dict(session, row) if row else None

    def get_login_device(self, identifier: str, user_id: Optional[str] = None) -> Optional[dict[str, Any]]:
        with session_scope(self.session_factory) as session:
            row = session.get(LoginSession, identifier)
            if row and (not user_id or row.user_id == user_id):
                rows = session.scalars(
                    select(LoginSession).where(LoginSession.user_id == row.user_id, LoginSession.device_id == row.device_id)
                ).all()
                return self._device_group_to_dict(session, rows)
            stmt = select(LoginSession).where(LoginSession.device_id == identifier)
            if user_id:
                stmt = stmt.where(LoginSession.user_id == user_id)
            rows = session.scalars(stmt).all()
            return self._device_group_to_dict(session, rows) if rows else None

    def list_login_sessions(self, user_id: Optional[str] = None) -> list[dict[str, Any]]:
        with session_scope(self.session_factory) as session:
            stmt = select(LoginSession)
            if user_id:
                stmt = stmt.where(LoginSession.user_id == user_id)
            rows = session.scalars(stmt.order_by(desc(LoginSession.last_seen_at), desc(LoginSession.created_at))).all()
            groups: dict[tuple[str, str], list[LoginSession]] = {}
            for row in rows:
                groups.setdefault((row.user_id, row.device_id or row.id), []).append(row)
            devices = [self._device_group_to_dict(session, group) for group in groups.values()]
            devices.sort(key=lambda item: (item["is_active"], item["last_seen_at"], item["created_at"]), reverse=True)
            return devices

    def touch_login_session(
        self,
        session_id: str,
        *,
        user_agent: str = "",
        ip_address: str = "",
        device_id: str = "",
    ) -> None:
        with session_scope(self.session_factory) as session:
            row = session.get(LoginSession, session_id)
            if not row:
                return
            row.last_seen_at = utc_now()
            row.last_ip_address = ip_address[:100]
            if device_id:
                row.device_id = device_id[:128]
            if user_agent:
                row.user_agent = user_agent[:500]

    def revoke_login_session(self, session_id: str) -> bool:
        now = utc_now()
        with session_scope(self.session_factory) as session:
            row = session.get(LoginSession, session_id)
            if row and not row.revoked_at:
                row.revoked_at = now
            tokens = session.scalars(select(RefreshToken).where(RefreshToken.session_id == session_id)).all()
            for token in tokens:
                if not token.revoked_at:
                    token.revoked_at = now
            return row is not None

    def revoke_login_device(self, identifier: str, user_id: Optional[str] = None) -> bool:
        now = utc_now()
        with session_scope(self.session_factory) as session:
            first = session.get(LoginSession, identifier)
            device_id = first.device_id if first and (not user_id or first.user_id == user_id) else identifier
            stmt = select(LoginSession).where(LoginSession.device_id == device_id)
            if user_id:
                stmt = stmt.where(LoginSession.user_id == user_id)
            rows = session.scalars(stmt).all()
            if not rows:
                return False
            for row in rows:
                if not row.revoked_at:
                    row.revoked_at = now
                for token in session.scalars(select(RefreshToken).where(RefreshToken.session_id == row.id)).all():
                    if not token.revoked_at:
                        token.revoked_at = now
            return True

    def enforce_login_session_limit(self, user_id: str, max_sessions: int, *, keep_session_id: str) -> list[str]:
        max_sessions = max(1, int(max_sessions))
        now = utc_now()
        with session_scope(self.session_factory) as session:
            current = session.get(LoginSession, keep_session_id)
            keep_device_id = current.device_id if current else ""
            active_token_exists = (
                select(RefreshToken.id)
                .where(
                    RefreshToken.session_id == LoginSession.id,
                    RefreshToken.revoked_at.is_(None),
                    RefreshToken.expires_at > now,
                )
                .exists()
            )
            active_rows = session.scalars(
                select(LoginSession)
                .where(
                    LoginSession.user_id == user_id,
                    LoginSession.revoked_at.is_(None),
                    LoginSession.expires_at > now,
                    active_token_exists,
                )
            ).all()
            devices: dict[str, list[LoginSession]] = {}
            for row in active_rows:
                devices.setdefault(row.device_id or row.id, []).append(row)

            def device_sort_key(item: tuple[str, list[LoginSession]]) -> tuple[int, str, str]:
                device_id, rows = item
                latest = max(rows, key=lambda row: (row.last_seen_at, row.created_at))
                return (1 if device_id == keep_device_id else 0, latest.last_seen_at, latest.created_at)

            ordered_devices = sorted(devices.items(), key=device_sort_key, reverse=True)
            revoke_device_ids = [device_id for device_id, _rows in ordered_devices[max_sessions:] if device_id != keep_device_id]
            revoke_ids: list[str] = []
            for device_id in revoke_device_ids:
                for row in devices.get(device_id, []):
                    revoke_ids.append(row.id)
                    if not row.revoked_at:
                        row.revoked_at = now
                    for token in session.scalars(select(RefreshToken).where(RefreshToken.session_id == row.id)).all():
                        if not token.revoked_at:
                            token.revoked_at = now
            return revoke_ids

    def _device_group_to_dict(self, session: Session, rows: list[LoginSession]) -> dict[str, Any]:
        now = utc_now()
        sorted_rows = sorted(rows, key=lambda row: (row.last_seen_at, row.created_at), reverse=True)
        row_payloads = [self._login_session_to_dict(session, row) for row in sorted_rows]
        active_payloads = [
            item
            for item in row_payloads
            if not item.get("revoked_at")
            and item.get("expires_at", "") > now
            and int(item.get("active_refresh_tokens") or 0) > 0
        ]
        representative = active_payloads[0] if active_payloads else row_payloads[0]
        created_at = min(item["created_at"] for item in row_payloads)
        last_seen_at = max(item["last_seen_at"] for item in row_payloads)
        expires_at = max((item["expires_at"] for item in active_payloads), default=representative["expires_at"])
        active_tokens = sum(int(item.get("active_refresh_tokens") or 0) for item in row_payloads)
        session_ids = [item["id"] for item in row_payloads]
        return {
            **representative,
            "id": representative["device_id"],
            "created_at": created_at,
            "last_seen_at": last_seen_at,
            "expires_at": expires_at,
            "revoked_at": None if active_payloads else representative.get("revoked_at"),
            "session_count": len(row_payloads),
            "active_refresh_tokens": active_tokens,
            "is_active": bool(active_payloads),
            "session_ids": session_ids,
        }

    def _login_session_to_dict(self, session: Session, row: LoginSession) -> dict[str, Any]:
        user = session.get(User, row.user_id)
        active_tokens = session.scalar(
            select(func.count())
            .select_from(RefreshToken)
            .where(
                RefreshToken.session_id == row.id,
                RefreshToken.revoked_at.is_(None),
                RefreshToken.expires_at > utc_now(),
            )
        )
        return {
            "id": row.id,
            "user_id": row.user_id,
            "username": user.username if user else "",
            "display_name": user.display_name if user else "",
            "device_id": row.device_id or row.id,
            "created_at": row.created_at,
            "last_seen_at": row.last_seen_at,
            "expires_at": row.expires_at,
            "revoked_at": row.revoked_at,
            "user_agent": row.user_agent,
            "ip_address": row.ip_address,
            "last_ip_address": row.last_ip_address,
            "session_count": 1,
            "active_refresh_tokens": int(active_tokens or 0),
        }

    def create_refresh_token(
        self,
        user_id: str,
        token_hash: str,
        expires_at: str,
        *,
        session_id: Optional[str] = None,
        user_agent: str = "",
        ip_address: str = "",
    ) -> str:
        token_id = str(uuid.uuid4())
        with session_scope(self.session_factory) as session:
            session.add(
                RefreshToken(
                    id=token_id,
                    user_id=user_id,
                    session_id=session_id,
                    token_hash=token_hash,
                    expires_at=expires_at,
                    created_at=utc_now(),
                    user_agent=user_agent[:500],
                    ip_address=ip_address[:100],
                )
            )
        return token_id

    def get_refresh_token(self, token_hash: str) -> Optional[dict[str, Any]]:
        with session_scope(self.session_factory) as session:
            row = session.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
            return self._refresh_token_to_dict(row) if row else None

    def revoke_refresh_token(self, token_id: str, *, replaced_by: Optional[str] = None) -> None:
        with session_scope(self.session_factory) as session:
            row = session.get(RefreshToken, token_id)
            if row:
                row.revoked_at = utc_now()
                row.replaced_by = replaced_by

    @staticmethod
    def _refresh_token_to_dict(row: RefreshToken) -> dict[str, Any]:
        return {
            "id": row.id,
            "user_id": row.user_id,
            "session_id": row.session_id,
            "token_hash": row.token_hash,
            "expires_at": row.expires_at,
            "created_at": row.created_at,
            "revoked_at": row.revoked_at,
            "replaced_by": row.replaced_by,
            "user_agent": row.user_agent,
            "ip_address": row.ip_address,
        }

    # ------------------------------------------------------------------ audit

    def audit(self, user_id: Optional[str], action: str, resource: str = "", detail: Optional[dict[str, Any]] = None) -> None:
        with session_scope(self.session_factory) as session:
            session.add(
                AuditEvent(
                    id=str(uuid.uuid4()),
                    user_id=user_id,
                    action=action,
                    resource=resource,
                    detail_json=json_dumps(detail or {}),
                    created_at=utc_now(),
                )
            )

    # ------------------------------------------------------------------ market

    def get_market_config(self, user_id: str) -> Optional[dict[str, Any]]:
        with session_scope(self.session_factory) as session:
            row = session.get(MarketDashboardConfig, user_id)
            return json_loads(row.config_json, {}) if row else None

    def save_market_config(self, user_id: str, config: dict[str, Any]) -> dict[str, Any]:
        with session_scope(self.session_factory) as session:
            stmt = sqlite_insert(MarketDashboardConfig).values(
                user_id=user_id,
                config_json=json_dumps(config),
                updated_at=utc_now(),
            )
            session.execute(
                stmt.on_conflict_do_update(
                    index_elements=[MarketDashboardConfig.user_id],
                    set_={"config_json": stmt.excluded.config_json, "updated_at": stmt.excluded.updated_at},
                )
            )
        return config

    # ---------------------------------------------------------------- scheduler

    def upsert_scheduler_task(self, task: dict[str, Any]) -> None:
        now = utc_now()
        with session_scope(self.session_factory) as session:
            stmt = sqlite_insert(SchedulerTask).values(
                id=task["id"],
                user_id=task["user_id"],
                task_json=json_dumps(task),
                enabled=int(bool(task.get("enabled", True))),
                next_run_at=task.get("next_run_at"),
                updated_at=now,
            )
            session.execute(
                stmt.on_conflict_do_update(
                    index_elements=[SchedulerTask.id],
                    set_={
                        "user_id": stmt.excluded.user_id,
                        "task_json": stmt.excluded.task_json,
                        "enabled": stmt.excluded.enabled,
                        "next_run_at": stmt.excluded.next_run_at,
                        "updated_at": stmt.excluded.updated_at,
                    },
                )
            )

    def delete_scheduler_task(self, task_id: str, user_id: Optional[str] = None) -> bool:
        with session_scope(self.session_factory) as session:
            row = session.get(SchedulerTask, task_id)
            if not row or (user_id and row.user_id != user_id):
                return False
            session.delete(row)
            return True

    def get_scheduler_task(self, task_id: str, user_id: Optional[str] = None) -> Optional[dict[str, Any]]:
        with session_scope(self.session_factory) as session:
            row = session.get(SchedulerTask, task_id)
            if not row or (user_id and row.user_id != user_id):
                return None
            return json_loads(row.task_json, {})

    def list_scheduler_tasks(self, user_id: Optional[str] = None, enabled_only: bool = False) -> list[dict[str, Any]]:
        with session_scope(self.session_factory) as session:
            stmt = select(SchedulerTask)
            if user_id:
                stmt = stmt.where(SchedulerTask.user_id == user_id)
            if enabled_only:
                stmt = stmt.where(SchedulerTask.enabled == 1)
            rows = session.scalars(
                stmt.order_by(func.coalesce(SchedulerTask.next_run_at, "z").asc())
            ).all()
            return [json_loads(row.task_json, {}) for row in rows]

    def add_scheduler_run(self, run: dict[str, Any], max_records: int = 500) -> dict[str, Any]:
        record = {"id": uuid.uuid4().hex[:12], **run}
        user_id = record.get("user_id") or ""
        started = record.get("started_at") or utc_now()
        with session_scope(self.session_factory) as session:
            session.add(
                SchedulerRun(
                    id=record["id"],
                    user_id=user_id,
                    task_id=record.get("task_id", ""),
                    run_json=json_dumps(record),
                    started_at=started,
                )
            )
            if max_records > 0:
                stale_ids = session.scalars(
                    select(SchedulerRun.id)
                    .where(SchedulerRun.user_id == user_id)
                    .order_by(desc(SchedulerRun.started_at))
                    .offset(max_records)
                ).all()
                if stale_ids:
                    session.execute(delete(SchedulerRun).where(SchedulerRun.id.in_(stale_ids)))
        return record

    def list_scheduler_runs(self, user_id: Optional[str] = None, task_id: Optional[str] = None, limit: int = 50) -> list[dict[str, Any]]:
        with session_scope(self.session_factory) as session:
            stmt = select(SchedulerRun)
            if user_id:
                stmt = stmt.where(SchedulerRun.user_id == user_id)
            if task_id:
                stmt = stmt.where(SchedulerRun.task_id == task_id)
            rows = session.scalars(
                stmt.order_by(desc(SchedulerRun.started_at)).limit(max(1, min(int(limit or 50), 200)))
            ).all()
            return [json_loads(row.run_json, {}) for row in rows]

    # ------------------------------------------------------------------ mcp

    def get_mcp_oauth_entry(self, server_name: str, user_id: Optional[str] = None) -> dict[str, Any]:
        with session_scope(self.session_factory) as session:
            row = session.get(MCPOAuthToken, {"user_id": user_id or "", "server_name": server_name})
            return self._decrypt_json_value(session, json_loads(row.entry_json, {})) if row else {}

    def set_mcp_oauth_entry(self, server_name: str, entry: dict[str, Any], user_id: Optional[str] = None) -> None:
        with session_scope(self.session_factory) as session:
            encrypted_entry = self._encrypt_json_value(session, entry)
            stmt = sqlite_insert(MCPOAuthToken).values(
                user_id=user_id or "",
                server_name=server_name,
                entry_json=json_dumps(encrypted_entry),
                updated_at=utc_now(),
            )
            session.execute(
                stmt.on_conflict_do_update(
                    index_elements=[MCPOAuthToken.user_id, MCPOAuthToken.server_name],
                    set_={"entry_json": stmt.excluded.entry_json, "updated_at": stmt.excluded.updated_at},
                )
            )

    def clear_mcp_oauth_entry(self, server_name: str, user_id: Optional[str] = None) -> None:
        with session_scope(self.session_factory) as session:
            row = session.get(MCPOAuthToken, {"user_id": user_id or "", "server_name": server_name})
            if row:
                session.delete(row)

    # ------------------------------------------------------------------ skills

    def load_skill_configs(self) -> dict[str, dict[str, Any]]:
        with session_scope(self.session_factory) as session:
            rows = session.scalars(select(SkillConfig)).all()
            return {row.name: json_loads(row.config_json, {}) for row in rows}

    def save_skill_configs(self, configs: dict[str, dict[str, Any]]) -> None:
        now = utc_now()
        with session_scope(self.session_factory) as session:
            existing = {row.name for row in session.scalars(select(SkillConfig)).all()}
            incoming = set(configs)
            for name in existing - incoming:
                row = session.get(SkillConfig, name)
                if row:
                    session.delete(row)
            for name, config in configs.items():
                stmt = sqlite_insert(SkillConfig).values(name=name, config_json=json_dumps(config), updated_at=now)
                session.execute(
                    stmt.on_conflict_do_update(
                        index_elements=[SkillConfig.name],
                        set_={"config_json": stmt.excluded.config_json, "updated_at": stmt.excluded.updated_at},
                    )
                )

    # ---------------------------------------------------------------- migration

    def migrate_legacy_user_data(self, admin_user_id: str, workspace_dir: str) -> None:
        if self.get_system_value("migration.legacy_user_data"):
            return
        root = Path(workspace_dir).expanduser()
        migrations = [
            ("sessions", migrate_sessions_db_user_scope, (root / "sessions" / "sessions.db", admin_user_id)),
            ("watchlist", migrate_watchlist_db_user_scope, (root / "watchlist" / "watchlist.db", admin_user_id)),
            ("portfolio", migrate_portfolio_db_user_scope, (root / "portfolio" / "portfolio.db", admin_user_id)),
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
