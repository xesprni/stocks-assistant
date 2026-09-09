"""IntegrationRepository implementation."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import delete, desc, func, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session, sessionmaker

from app.core.app_store_defs import json_dumps, json_loads, utc_now
from app.core.orm.database import session_scope
from app.core.orm.models.app import (
    MarketDashboardConfig,
    MCPOAuthToken,
    SchedulerRun,
    SchedulerTask,
    SkillConfig,
)
from app.core.orm.repositories.app_config import AppConfigRepository


class IntegrationRepository:
    """Application integrations persistence."""

    def __init__(self, session_factory: sessionmaker[Session], config: AppConfigRepository) -> None:
        self.session_factory = session_factory
        self.config = config

    def get_market_config(self, user_id: str) -> dict[str, Any] | None:
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
                    set_={
                        "config_json": stmt.excluded.config_json,
                        "updated_at": stmt.excluded.updated_at,
                    },
                )
            )
        return config

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

    def delete_scheduler_task(self, task_id: str, user_id: str | None = None) -> bool:
        with session_scope(self.session_factory) as session:
            row = session.get(SchedulerTask, task_id)
            if not row or (user_id and row.user_id != user_id):
                return False
            session.delete(row)
            return True

    def get_scheduler_task(self, task_id: str, user_id: str | None = None) -> dict[str, Any] | None:
        with session_scope(self.session_factory) as session:
            row = session.get(SchedulerTask, task_id)
            if not row or (user_id and row.user_id != user_id):
                return None
            return json_loads(row.task_json, {})

    def list_scheduler_tasks(
        self, user_id: str | None = None, enabled_only: bool = False
    ) -> list[dict[str, Any]]:
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

    def list_scheduler_runs(
        self, user_id: str | None = None, task_id: str | None = None, limit: int = 50
    ) -> list[dict[str, Any]]:
        with session_scope(self.session_factory) as session:
            stmt = select(SchedulerRun)
            if user_id:
                stmt = stmt.where(SchedulerRun.user_id == user_id)
            if task_id:
                stmt = stmt.where(SchedulerRun.task_id == task_id)
            rows = session.scalars(
                stmt.order_by(desc(SchedulerRun.started_at)).limit(
                    max(1, min(int(limit or 50), 200))
                )
            ).all()
            return [json_loads(row.run_json, {}) for row in rows]

    def get_mcp_oauth_entry(self, server_name: str, user_id: str | None = None) -> dict[str, Any]:
        with session_scope(self.session_factory) as session:
            row = session.get(MCPOAuthToken, {"user_id": user_id or "", "server_name": server_name})
            return (
                self.config._decrypt_json_value(session, json_loads(row.entry_json, {}))
                if row
                else {}
            )

    def set_mcp_oauth_entry(
        self, server_name: str, entry: dict[str, Any], user_id: str | None = None
    ) -> None:
        with session_scope(self.session_factory) as session:
            encrypted_entry = self.config._encrypt_json_value(session, entry)
            stmt = sqlite_insert(MCPOAuthToken).values(
                user_id=user_id or "",
                server_name=server_name,
                entry_json=json_dumps(encrypted_entry),
                updated_at=utc_now(),
            )
            session.execute(
                stmt.on_conflict_do_update(
                    index_elements=[MCPOAuthToken.user_id, MCPOAuthToken.server_name],
                    set_={
                        "entry_json": stmt.excluded.entry_json,
                        "updated_at": stmt.excluded.updated_at,
                    },
                )
            )

    def clear_mcp_oauth_entry(self, server_name: str, user_id: str | None = None) -> None:
        with session_scope(self.session_factory) as session:
            row = session.get(MCPOAuthToken, {"user_id": user_id or "", "server_name": server_name})
            if row:
                session.delete(row)

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
                stmt = sqlite_insert(SkillConfig).values(
                    name=name, config_json=json_dumps(config), updated_at=now
                )
                session.execute(
                    stmt.on_conflict_do_update(
                        index_elements=[SkillConfig.name],
                        set_={
                            "config_json": stmt.excluded.config_json,
                            "updated_at": stmt.excluded.updated_at,
                        },
                    )
                )
