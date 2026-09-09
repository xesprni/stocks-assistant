"""Compatibility facade over application repositories sharing one transaction factory."""

from __future__ import annotations

import secrets
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from cryptography.fernet import Fernet
from sqlalchemy.orm import Session

from app.core.app_store_defs import CONFIG_ENCRYPTION_KEY, JWT_SECRET_KEY, app_db_path, utc_now
from app.core.orm.database import (
    connect_sqlite,
    create_session_factory,
    create_sqlite_engine,
    session_scope,
)
from app.core.orm.migrations import init_app_schema
from app.core.orm.models.app import SystemKV
from app.core.orm.repositories.app_config import AppConfigRepository
from app.core.orm.repositories.identity import IdentityRepository
from app.core.orm.repositories.integrations import IntegrationRepository
from app.core.orm.repositories.legacy_app_data import LegacyAppDataMigrator
from app.core.orm.repositories.login_sessions import LoginSessionRepository


class AppStoreRepository:
    """Preserve the application store API while each repository owns one domain."""

    def __init__(self, db_path: Path | str | None = None) -> None:
        self.db_path = Path(db_path).expanduser() if db_path else app_db_path()
        self.engine = create_sqlite_engine(self.db_path)
        self.session_factory = create_session_factory(self.engine)
        init_app_schema(self.engine)
        self.config = AppConfigRepository(self.session_factory)
        self.identity = IdentityRepository(self.session_factory)
        self.login_sessions = LoginSessionRepository(self.session_factory)
        self.integrations = IntegrationRepository(self.session_factory, self.config)
        self.legacy_data = LegacyAppDataMigrator(self.config, self.integrations)
        self._init_seed_data()

    def connect(self):
        """Return a DB-API connection for legacy tests and one-off maintenance."""
        return connect_sqlite(self.db_path)

    def _init_seed_data(self) -> None:
        # 角色、密钥和旧配置迁移共用一个事务，任一步失败都回滚首次初始化。
        with session_scope(self.session_factory) as session:
            self.identity._seed_rbac(session)
            if not self.get_system_value(JWT_SECRET_KEY, session=session):
                session.add(
                    SystemKV(
                        key=JWT_SECRET_KEY, value=secrets.token_urlsafe(48), updated_at=utc_now()
                    )
                )
            if not self.get_system_value(CONFIG_ENCRYPTION_KEY, session=session):
                session.add(
                    SystemKV(
                        key=CONFIG_ENCRYPTION_KEY,
                        value=Fernet.generate_key().decode("ascii"),
                        updated_at=utc_now(),
                    )
                )
            session.flush()
            self.config._migrate_plaintext_secrets(session)
            self.config._migrate_subagent_roles_from_config(session)

    def get_system_value(self, key: str, *, session: Session | None = None) -> str | None:
        return self.config.get_system_value(key, session=session)

    def set_system_value(self, key: str, value: str) -> None:
        return self.config.set_system_value(key, value)

    def get_config(self) -> dict[str, Any]:
        return self.config.get_config()

    def set_config_values(self, values: dict[str, Any]) -> None:
        return self.config.set_config_values(values)

    def has_config(self) -> bool:
        return self.config.has_config()

    def get_user_config(self, user_id: str) -> dict[str, Any]:
        return self.config.get_user_config(user_id)

    def set_user_config_values(self, user_id: str, values: dict[str, Any]) -> None:
        return self.config.set_user_config_values(user_id, values)

    def migrate_config_json_once(self, config_path: str | Path = "config.json") -> dict[str, Any]:
        return self.config.migrate_config_json_once(config_path)

    def get_subagent_roles(self, *, session: Session | None = None) -> dict[str, dict[str, Any]]:
        return self.config.get_subagent_roles(session=session)

    def save_subagent_roles(
        self, roles: dict[str, dict[str, Any]], *, session: Session | None = None
    ) -> None:
        return self.config.save_subagent_roles(roles, session=session)

    def has_users(self) -> bool:
        return self.identity.has_users()

    def create_user(
        self,
        username: str,
        password_hash: str,
        *,
        display_name: str = "",
        avatar_base64: str = "",
        role_names: Iterable[str] | None = None,
        is_active: bool = True,
    ) -> dict[str, Any]:
        return self.identity.create_user(
            username,
            password_hash,
            display_name=display_name,
            avatar_base64=avatar_base64,
            role_names=role_names,
            is_active=is_active,
        )

    def get_user_by_username(self, username: str) -> dict[str, Any] | None:
        return self.identity.get_user_by_username(username)

    def get_user_by_id(self, user_id: str) -> dict[str, Any] | None:
        return self.identity.get_user_by_id(user_id)

    def list_users(self) -> list[dict[str, Any]]:
        return self.identity.list_users()

    def update_user(
        self,
        user_id: str,
        *,
        display_name: str | None = None,
        is_active: bool | None = None,
        password_hash: str | None = None,
        avatar_base64: str | None = None,
        role_names: list[str] | None = None,
    ) -> dict[str, Any]:
        return self.identity.update_user(
            user_id,
            display_name=display_name,
            is_active=is_active,
            password_hash=password_hash,
            avatar_base64=avatar_base64,
            role_names=role_names,
        )

    def touch_login(self, user_id: str) -> None:
        return self.identity.touch_login(user_id)

    def get_user_permissions(self, user_id: str, *, session: Session | None = None) -> set[str]:
        return self.identity.get_user_permissions(user_id, session=session)

    def list_roles(self) -> list[dict[str, Any]]:
        return self.identity.list_roles()

    def upsert_role(self, name: str, description: str, permissions: list[str]) -> dict[str, Any]:
        return self.identity.upsert_role(name, description, permissions)

    def list_page_permissions(self) -> dict[str, str]:
        return self.identity.list_page_permissions()

    def upsert_page_permission(self, page: str, permission: str) -> dict[str, str]:
        return self.identity.upsert_page_permission(page, permission)

    def audit(
        self,
        user_id: str | None,
        action: str,
        resource: str = "",
        detail: dict[str, Any] | None = None,
    ) -> None:
        return self.identity.audit(user_id, action, resource, detail)

    def create_login_session(
        self,
        user_id: str,
        *,
        expires_at: str,
        user_agent: str = "",
        ip_address: str = "",
        device_id: str = "",
    ) -> dict[str, Any]:
        return self.login_sessions.create_login_session(
            user_id,
            expires_at=expires_at,
            user_agent=user_agent,
            ip_address=ip_address,
            device_id=device_id,
        )

    def get_login_session(self, session_id: str) -> dict[str, Any] | None:
        return self.login_sessions.get_login_session(session_id)

    def get_login_device(
        self, identifier: str, user_id: str | None = None
    ) -> dict[str, Any] | None:
        return self.login_sessions.get_login_device(identifier, user_id)

    def list_login_sessions(self, user_id: str | None = None) -> list[dict[str, Any]]:
        return self.login_sessions.list_login_sessions(user_id)

    def touch_login_session(
        self, session_id: str, *, user_agent: str = "", ip_address: str = "", device_id: str = ""
    ) -> None:
        return self.login_sessions.touch_login_session(
            session_id, user_agent=user_agent, ip_address=ip_address, device_id=device_id
        )

    def heartbeat_login_device(
        self,
        user_id: str,
        *,
        expires_at: str,
        session_id: str | None = None,
        user_agent: str = "",
        ip_address: str = "",
        device_id: str = "",
    ) -> dict[str, Any]:
        return self.login_sessions.heartbeat_login_device(
            user_id,
            expires_at=expires_at,
            session_id=session_id,
            user_agent=user_agent,
            ip_address=ip_address,
            device_id=device_id,
        )

    def revoke_login_session(self, session_id: str) -> bool:
        return self.login_sessions.revoke_login_session(session_id)

    def revoke_login_device(self, identifier: str, user_id: str | None = None) -> bool:
        return self.login_sessions.revoke_login_device(identifier, user_id)

    def revoke_other_login_devices(
        self, user_id: str, *, current_session_id: str | None
    ) -> dict[str, int]:
        return self.login_sessions.revoke_other_login_devices(
            user_id, current_session_id=current_session_id
        )

    def delete_login_session_record(self, session_id: str, user_id: str | None = None) -> bool:
        return self.login_sessions.delete_login_session_record(session_id, user_id)

    def delete_login_device(self, identifier: str, user_id: str | None = None) -> list[str]:
        return self.login_sessions.delete_login_device(identifier, user_id)

    def enforce_login_session_limit(
        self, user_id: str, max_sessions: int, *, keep_session_id: str
    ) -> list[str]:
        return self.login_sessions.enforce_login_session_limit(
            user_id, max_sessions, keep_session_id=keep_session_id
        )

    def create_refresh_token(
        self,
        user_id: str,
        token_hash: str,
        expires_at: str,
        *,
        session_id: str | None = None,
        user_agent: str = "",
        ip_address: str = "",
    ) -> str:
        return self.login_sessions.create_refresh_token(
            user_id,
            token_hash,
            expires_at,
            session_id=session_id,
            user_agent=user_agent,
            ip_address=ip_address,
        )

    def get_refresh_token(self, token_hash: str) -> dict[str, Any] | None:
        return self.login_sessions.get_refresh_token(token_hash)

    def revoke_refresh_token(self, token_id: str, *, replaced_by: str | None = None) -> None:
        return self.login_sessions.revoke_refresh_token(token_id, replaced_by=replaced_by)

    def get_market_config(self, user_id: str) -> dict[str, Any] | None:
        return self.integrations.get_market_config(user_id)

    def save_market_config(self, user_id: str, config: dict[str, Any]) -> dict[str, Any]:
        return self.integrations.save_market_config(user_id, config)

    def upsert_scheduler_task(self, task: dict[str, Any]) -> None:
        return self.integrations.upsert_scheduler_task(task)

    def delete_scheduler_task(self, task_id: str, user_id: str | None = None) -> bool:
        return self.integrations.delete_scheduler_task(task_id, user_id)

    def get_scheduler_task(self, task_id: str, user_id: str | None = None) -> dict[str, Any] | None:
        return self.integrations.get_scheduler_task(task_id, user_id)

    def list_scheduler_tasks(
        self, user_id: str | None = None, enabled_only: bool = False
    ) -> list[dict[str, Any]]:
        return self.integrations.list_scheduler_tasks(user_id, enabled_only)

    def add_scheduler_run(self, run: dict[str, Any], max_records: int = 500) -> dict[str, Any]:
        return self.integrations.add_scheduler_run(run, max_records)

    def list_scheduler_runs(
        self, user_id: str | None = None, task_id: str | None = None, limit: int = 50
    ) -> list[dict[str, Any]]:
        return self.integrations.list_scheduler_runs(user_id, task_id, limit)

    def get_mcp_oauth_entry(self, server_name: str, user_id: str | None = None) -> dict[str, Any]:
        return self.integrations.get_mcp_oauth_entry(server_name, user_id)

    def set_mcp_oauth_entry(
        self, server_name: str, entry: dict[str, Any], user_id: str | None = None
    ) -> None:
        return self.integrations.set_mcp_oauth_entry(server_name, entry, user_id)

    def clear_mcp_oauth_entry(self, server_name: str, user_id: str | None = None) -> None:
        return self.integrations.clear_mcp_oauth_entry(server_name, user_id)

    def load_skill_configs(self) -> dict[str, dict[str, Any]]:
        return self.integrations.load_skill_configs()

    def save_skill_configs(self, configs: dict[str, dict[str, Any]]) -> None:
        return self.integrations.save_skill_configs(configs)

    def migrate_legacy_user_data(self, admin_user_id: str, workspace_dir: str) -> None:
        return self.legacy_data.migrate_legacy_user_data(admin_user_id, workspace_dir)
