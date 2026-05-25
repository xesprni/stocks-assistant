"""Application database ORM models."""

from __future__ import annotations

from sqlalchemy import ForeignKey, Index, Integer, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.orm.base import AppBase


class SystemKV(AppBase):
    __tablename__ = "system_kv"

    key: Mapped[str] = mapped_column(Text, primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False)


class AppConfig(AppBase):
    __tablename__ = "app_config"

    key: Mapped[str] = mapped_column(Text, primary_key=True)
    value_json: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False)


class UserConfig(AppBase):
    __tablename__ = "user_config"

    user_id: Mapped[str] = mapped_column(Text, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    key: Mapped[str] = mapped_column(Text, primary_key=True)
    value_json: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False)


class User(AppBase):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    username: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    display_name: Mapped[str] = mapped_column(Text, nullable=False, default="")
    is_active: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False)
    last_login_at: Mapped[str | None] = mapped_column(Text)


class Role(AppBase):
    __tablename__ = "roles"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    builtin: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False)


class Permission(AppBase):
    __tablename__ = "permissions"

    key: Mapped[str] = mapped_column(Text, primary_key=True)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")


class RolePermission(AppBase):
    __tablename__ = "role_permissions"

    role_id: Mapped[str] = mapped_column(Text, ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True)
    permission_key: Mapped[str] = mapped_column(Text, ForeignKey("permissions.key", ondelete="CASCADE"), primary_key=True)


class PagePermission(AppBase):
    __tablename__ = "page_permissions"

    page: Mapped[str] = mapped_column(Text, primary_key=True)
    permission_key: Mapped[str] = mapped_column(Text, ForeignKey("permissions.key", ondelete="RESTRICT"), nullable=False)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False)


class UserRole(AppBase):
    __tablename__ = "user_roles"

    user_id: Mapped[str] = mapped_column(Text, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    role_id: Mapped[str] = mapped_column(Text, ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True)


class LoginSession(AppBase):
    __tablename__ = "login_sessions"
    __table_args__ = (
        Index("idx_login_sessions_user", "user_id"),
        Index("idx_login_sessions_user_device", "user_id", "device_id"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    user_id: Mapped[str] = mapped_column(Text, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    device_id: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[str] = mapped_column(Text, nullable=False)
    last_seen_at: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[str] = mapped_column(Text, nullable=False)
    revoked_at: Mapped[str | None] = mapped_column(Text)
    user_agent: Mapped[str] = mapped_column(Text, nullable=False, default="")
    ip_address: Mapped[str] = mapped_column(Text, nullable=False, default="")
    last_ip_address: Mapped[str] = mapped_column(Text, nullable=False, default="")


class RefreshToken(AppBase):
    __tablename__ = "refresh_tokens"
    __table_args__ = (
        Index("idx_refresh_tokens_user", "user_id"),
        Index("idx_refresh_tokens_session", "session_id"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    user_id: Mapped[str] = mapped_column(Text, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    session_id: Mapped[str | None] = mapped_column(Text, ForeignKey("login_sessions.id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    expires_at: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[str] = mapped_column(Text, nullable=False)
    revoked_at: Mapped[str | None] = mapped_column(Text)
    replaced_by: Mapped[str | None] = mapped_column(Text)
    user_agent: Mapped[str] = mapped_column(Text, nullable=False, default="")
    ip_address: Mapped[str] = mapped_column(Text, nullable=False, default="")


class AuditEvent(AppBase):
    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    user_id: Mapped[str | None] = mapped_column(Text, ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(Text, nullable=False)
    resource: Mapped[str] = mapped_column(Text, nullable=False, default="")
    detail_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[str] = mapped_column(Text, nullable=False)


class MarketDashboardConfig(AppBase):
    __tablename__ = "market_dashboard_configs"

    user_id: Mapped[str] = mapped_column(Text, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    config_json: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False)


class SchedulerTask(AppBase):
    __tablename__ = "scheduler_tasks"
    __table_args__ = (Index("idx_scheduler_tasks_user", "user_id"),)

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    user_id: Mapped[str] = mapped_column(Text, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    task_json: Mapped[str] = mapped_column(Text, nullable=False)
    enabled: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    next_run_at: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False)


class SchedulerRun(AppBase):
    __tablename__ = "scheduler_runs"
    __table_args__ = (Index("idx_scheduler_runs_user_started", "user_id", "started_at"),)

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    user_id: Mapped[str] = mapped_column(Text, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    task_id: Mapped[str] = mapped_column(Text, nullable=False, default="")
    run_json: Mapped[str] = mapped_column(Text, nullable=False)
    started_at: Mapped[str] = mapped_column(Text, nullable=False)


class MCPOAuthToken(AppBase):
    __tablename__ = "mcp_oauth_tokens"

    user_id: Mapped[str] = mapped_column(Text, primary_key=True, default="")
    server_name: Mapped[str] = mapped_column(Text, primary_key=True)
    entry_json: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False)


class SkillConfig(AppBase):
    __tablename__ = "skill_configs"

    name: Mapped[str] = mapped_column(Text, primary_key=True)
    config_json: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False)


class SubagentRole(AppBase):
    __tablename__ = "subagent_roles"

    name: Mapped[str] = mapped_column(Text, primary_key=True)
    role_json: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False)
