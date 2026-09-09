"""LegacyAppDataMigrator implementation."""

from __future__ import annotations

import json
import logging
from pathlib import Path

from app.core.app_store_defs import utc_now
from app.core.orm.migrations import (
    migrate_portfolio_db_user_scope,
    migrate_sessions_db_user_scope,
    migrate_watchlist_db_user_scope,
)
from app.core.orm.repositories.app_config import AppConfigRepository
from app.core.orm.repositories.integrations import IntegrationRepository

logger = logging.getLogger("stocks-assistant.app_store")


class LegacyAppDataMigrator:
    """Application legacy app data persistence."""

    def __init__(self, config: AppConfigRepository, integrations: IntegrationRepository) -> None:
        self.config = config
        self.integrations = integrations

    def migrate_legacy_user_data(self, admin_user_id: str, workspace_dir: str) -> None:
        if self.config.get_system_value("migration.legacy_user_data"):
            return
        root = Path(workspace_dir).expanduser()
        migrations = [
            (
                "sessions",
                migrate_sessions_db_user_scope,
                (root / "sessions" / "sessions.db", admin_user_id),
            ),
            (
                "watchlist",
                migrate_watchlist_db_user_scope,
                (root / "watchlist" / "watchlist.db", admin_user_id),
            ),
            (
                "portfolio",
                migrate_portfolio_db_user_scope,
                (root / "portfolio" / "portfolio.db", admin_user_id),
            ),
            (
                "market_config",
                self._migrate_market_config,
                (root / "market_config.json", admin_user_id),
            ),
            (
                "scheduler",
                self._migrate_scheduler_json,
                (
                    root / "scheduler" / "tasks.json",
                    root / "scheduler" / "runs.json",
                    admin_user_id,
                ),
            ),
            ("mcp_tokens", self._migrate_mcp_tokens, (root / "mcp" / "oauth_tokens.json",)),
            (
                "skill_configs",
                self._migrate_skill_configs,
                (root / "skills" / "skills_config.json",),
            ),
        ]
        for name, migrate, args in migrations:
            try:
                migrate(*args)
            except Exception as exc:
                source = args[0] if args else root
                logger.warning("Skipped legacy %s migration from %s: %s", name, source, exc)
        self.config.set_system_value("migration.legacy_user_data", utc_now())

    def _migrate_market_config(self, path: Path, admin_user_id: str) -> None:
        if not path.exists() or self.integrations.get_market_config(admin_user_id):
            return
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return
        if isinstance(data, dict):
            self.integrations.save_market_config(admin_user_id, data)

    def _migrate_scheduler_json(
        self, tasks_path: Path, runs_path: Path, admin_user_id: str
    ) -> None:
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
                        self.integrations.upsert_scheduler_task(task)
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
                        self.integrations.add_scheduler_run(run)

    def _migrate_mcp_tokens(self, path: Path) -> None:
        if not path.exists():
            return
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return
        if isinstance(data, dict):
            for server_name, entry in data.items():
                if isinstance(entry, dict) and not self.integrations.get_mcp_oauth_entry(
                    server_name
                ):
                    self.integrations.set_mcp_oauth_entry(server_name, entry)

    def _migrate_skill_configs(self, path: Path) -> None:
        if not path.exists() or self.integrations.load_skill_configs():
            return
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return
        if isinstance(data, dict):
            self.integrations.save_skill_configs(data)
