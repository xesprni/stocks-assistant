import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

import app.config as config_module
import app.core.app_store as app_store_module
from app import deps
from app.api.config import router
from app.config import Settings, get_effective_settings, get_settings
from app.core.app_store import APP_DB_ENV, AppStore, reset_app_store_for_tests
from app.core.security import CurrentUser, get_current_user
from app.schemas.config import ConfigUpdate


FIELD = "research_quick_prompts_refresh_seconds"


class ResearchQuickPromptsConfigTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.env_patch = patch.dict(os.environ, {APP_DB_ENV: str(self.root / "app.db")})
        self.env_patch.start()
        self.addCleanup(self.env_patch.stop)
        self.previous_store = app_store_module._app_store
        self.previous_settings = config_module._config_instance
        self.addCleanup(self._restore_config)
        self.store = reset_app_store_for_tests()
        # 首次初始化只使用临时文件，避免读取开发者的旧配置或凭据。
        self.store.migrate_config_json_once(self.root / "missing-config.json")
        self.store.set_config_values({"workspace_dir": str(self.root / "workspace")})
        config_module._config_instance = None
        config_module.clear_effective_settings_cache()
        self.admin = self._create_user("admin", admin=True)
        self.alice = self._create_user("alice")
        self.bob = self._create_user("bob")
        self.current = self.admin
        app = FastAPI()
        app.include_router(router, prefix="/api/v1/config")
        app.dependency_overrides[get_current_user] = lambda: self.current
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def _restore_config(self):
        app_store_module._app_store = self.previous_store
        config_module._config_instance = self.previous_settings
        config_module.clear_effective_settings_cache()

    def _create_user(self, username, *, admin=False):
        roles = ("admin",) if admin else ("user",)
        user = self.store.create_user(username, "unused-test-password", role_names=roles)
        return CurrentUser(
            id=user["id"],
            username=username,
            display_name=username,
            roles=roles,
            permissions=frozenset({"*"} if admin else {"config:read"}),
            is_active=True,
        )

    def _update(self, user, seconds):
        self.current = user
        response = self.client.patch("/api/v1/config", json={FIELD: seconds})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()[FIELD], seconds)
        return response.json()

    def test_initial_database_and_existing_config_default_to_one_hour(self):
        self.assertEqual(get_settings().research_quick_prompts_refresh_seconds, 3600)
        response = self.client.get("/api/v1/config")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()[FIELD], 3600)
        self.assertNotIn(FIELD, self.store.get_config())

    def test_system_default_and_personal_override_are_persisted_and_isolated(self):
        self._update(self.admin, 7200)
        self.assertEqual(get_effective_settings(self.alice.id).research_quick_prompts_refresh_seconds, 7200)
        self.assertEqual(get_effective_settings(self.bob.id).research_quick_prompts_refresh_seconds, 7200)

        personal = self._update(self.alice, 900)
        self.assertIn(FIELD, personal["personal_config_keys"])
        self._update(self.admin, 10800)
        self.assertEqual(get_effective_settings(self.alice.id).research_quick_prompts_refresh_seconds, 900)
        self.assertEqual(get_effective_settings(self.bob.id).research_quick_prompts_refresh_seconds, 10800)

        reopened = AppStore(self.root / "app.db")
        self.assertEqual(reopened.get_config()[FIELD], 10800)
        self.assertEqual(reopened.get_user_config(self.alice.id)[FIELD], 900)
        self.assertNotIn(FIELD, reopened.get_user_config(self.bob.id))
        self.assertNotIn(FIELD, reopened.get_user_config(self.admin.id))

    def test_invalid_intervals_are_rejected_without_changing_saved_value(self):
        self._update(self.alice, 3600)
        for seconds in (0, 59, 604801, 60.5):
            with self.subTest(seconds=seconds):
                response = self.client.patch("/api/v1/config", json={FIELD: seconds})
                self.assertEqual(response.status_code, 422, response.text)
                self.assertEqual(self.store.get_user_config(self.alice.id)[FIELD], 3600)
                with self.assertRaises(ValidationError):
                    Settings(**{FIELD: seconds})

    def test_interval_boundaries_are_accepted(self):
        self._update(self.alice, 60)
        self._update(self.alice, 604800)
        self.assertEqual(ConfigUpdate(**{FIELD: 60}).model_dump(exclude_unset=True), {FIELD: 60})

    def test_config_permission_is_required(self):
        self.current = CurrentUser(
            id=self.alice.id,
            username="alice",
            display_name="alice",
            roles=("user",),
            permissions=frozenset(),
            is_active=True,
        )
        response = self.client.patch("/api/v1/config", json={FIELD: 600})
        self.assertEqual(response.status_code, 403, response.text)
        self.assertNotIn(FIELD, self.store.get_user_config(self.alice.id))

    def test_workspace_change_invalidates_quick_prompts_and_local_context_services(self):
        new_workspace = str(self.root / "updated-workspace")
        with (
            patch.object(deps, "get_watchlist_service") as watchlist,
            patch.object(deps, "get_portfolio_service") as portfolio,
            patch.object(deps, "get_research_quick_prompts_service") as quick_prompts,
        ):
            response = self.client.patch("/api/v1/config", json={"workspace_dir": new_workspace})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["workspace_dir"], new_workspace)
            self.assertEqual(get_settings().workspace_dir, new_workspace)
            for service in (watchlist, portfolio, quick_prompts):
                service.cache_clear.assert_called_once_with()
                service.assert_not_called()
                service.reset_mock()

            # 调整刷新时间只更新有效配置，不能丢弃仍有效的生成缓存或重建本地服务。
            self._update(self.admin, 900)
            for service in (watchlist, portfolio, quick_prompts):
                service.cache_clear.assert_not_called()
                service.assert_not_called()

    def test_legacy_json_migrates_interval_once(self):
        legacy_path = self.root / "legacy-config.json"
        legacy_path.write_text(json.dumps({FIELD: 1800}), encoding="utf-8")
        migrated_store = AppStore(self.root / "legacy.db")
        self.assertEqual(migrated_store.migrate_config_json_once(legacy_path), {FIELD: 1800})
        app_store_module._app_store = migrated_store
        config_module._config_instance = None
        config_module.clear_effective_settings_cache()
        self.assertEqual(get_settings().research_quick_prompts_refresh_seconds, 1800)

        legacy_path.write_text(json.dumps({FIELD: 600}), encoding="utf-8")
        reopened = AppStore(self.root / "legacy.db")
        self.assertEqual(reopened.migrate_config_json_once(legacy_path), {})
        self.assertEqual(reopened.get_config()[FIELD], 1800)
        self.assertTrue(reopened.get_system_value("migration.config_json"))


if __name__ == "__main__":
    unittest.main()
