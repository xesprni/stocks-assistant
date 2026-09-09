"""IdentityRepository implementation."""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session, sessionmaker

from app.core.app_store_defs import (
    PAGE_PERMISSION_REQUIREMENTS,
    PERMISSION_DESCRIPTIONS,
    ROLE_PERMISSIONS,
    json_dumps,
    utc_now,
)
from app.core.orm.database import session_scope
from app.core.orm.models.app import (
    AuditEvent,
    PagePermission,
    Permission,
    Role,
    RolePermission,
    User,
    UserRole,
)


class IdentityRepository:
    """Application identity persistence."""

    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self.session_factory = session_factory

    def _seed_rbac(self, session: Session) -> None:
        now = utc_now()
        for key, description in PERMISSION_DESCRIPTIONS.items():
            stmt = sqlite_insert(Permission).values(key=key, description=description)
            session.execute(
                stmt.on_conflict_do_update(
                    index_elements=[Permission.key], set_={"description": description}
                )
            )

        for page, permission in PAGE_PERMISSION_REQUIREMENTS.items():
            stmt = sqlite_insert(PagePermission).values(
                page=page, permission_key=permission, updated_at=now
            )
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
                        .on_conflict_do_nothing(
                            index_elements=[RolePermission.role_id, RolePermission.permission_key]
                        )
                    )
            else:
                role.builtin = 1

    def has_users(self) -> bool:
        with session_scope(self.session_factory) as session:
            return bool(session.scalar(select(User.id).limit(1)))

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
        now = utc_now()
        user_id = str(uuid.uuid4())
        roles = list(role_names or ["user"])
        with session_scope(self.session_factory) as session:
            user = User(
                id=user_id,
                username=username.strip(),
                password_hash=password_hash,
                display_name=display_name.strip(),
                avatar_base64=avatar_base64.strip(),
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

    def get_user_by_username(self, username: str) -> dict[str, Any] | None:
        with session_scope(self.session_factory) as session:
            row = session.scalar(select(User).where(User.username == username.strip()))
            return self._user_to_dict(session, row) if row else None

    def get_user_by_id(self, user_id: str) -> dict[str, Any] | None:
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
        display_name: str | None = None,
        is_active: bool | None = None,
        password_hash: str | None = None,
        avatar_base64: str | None = None,
        role_names: list[str] | None = None,
    ) -> dict[str, Any]:
        with session_scope(self.session_factory) as session:
            user = session.get(User, user_id)
            if not user:
                raise KeyError(user_id)
            if display_name is not None:
                user.display_name = display_name.strip()
            if avatar_base64 is not None:
                user.avatar_base64 = avatar_base64.strip()
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
            "avatar_base64": row.avatar_base64,
            "is_active": bool(row.is_active),
            "roles": list(role_rows),
            "permissions": sorted(permissions),
            "created_at": row.created_at,
            "updated_at": row.updated_at,
            "last_login_at": row.last_login_at,
        }

    def get_user_permissions(self, user_id: str, *, session: Session | None = None) -> set[str]:
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

    def list_roles(self) -> list[dict[str, Any]]:
        with session_scope(self.session_factory) as session:
            rows = session.scalars(
                select(Role).order_by(Role.builtin.desc(), Role.name.asc())
            ).all()
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
                    set_={
                        "description": stmt.excluded.description,
                        "updated_at": stmt.excluded.updated_at,
                    },
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
            rows = session.scalars(
                select(PagePermission)
                .where(PagePermission.page.in_(tuple(PAGE_PERMISSION_REQUIREMENTS)))
                .order_by(PagePermission.page.asc())
            ).all()
            return {row.page: row.permission_key for row in rows}

    def upsert_page_permission(self, page: str, permission: str) -> dict[str, str]:
        clean_page = page.strip()
        clean_permission = permission.strip()
        if not clean_page:
            raise ValueError("Page is required")
        if clean_page not in PAGE_PERMISSION_REQUIREMENTS:
            raise ValueError(f"Unknown page: {clean_page}")
        if clean_permission not in PERMISSION_DESCRIPTIONS:
            raise ValueError(f"Unknown permission: {clean_permission}")
        now = utc_now()
        with session_scope(self.session_factory) as session:
            stmt = sqlite_insert(PagePermission).values(
                page=clean_page, permission_key=clean_permission, updated_at=now
            )
            session.execute(
                stmt.on_conflict_do_update(
                    index_elements=[PagePermission.page],
                    set_={
                        "permission_key": stmt.excluded.permission_key,
                        "updated_at": stmt.excluded.updated_at,
                    },
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

    def audit(
        self,
        user_id: str | None,
        action: str,
        resource: str = "",
        detail: dict[str, Any] | None = None,
    ) -> None:
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
