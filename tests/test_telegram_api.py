"""Telegram 图片从配置、调度 API 到用户工作空间的集成回归。"""

import base64
import os
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

import app.config as config_module
import app.core.app_store as app_store_module
from app.api.config import router as config_router
from app.api.scheduler import router as scheduler_router
from app.core.app_store import APP_DB_ENV, reset_app_store_for_tests
from app.core.notifications.telegram import TelegramSender
from app.core.security import CurrentUser, get_current_user, user_workspace_dir
from app.core.tools.scheduler.tool import SchedulerTool
from app.deps import get_scheduler_service

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
)
PHOTO_URL = "https://example.com/chart.png"


class TelegramPhotoIntegrationTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        env = patch.dict(os.environ, {APP_DB_ENV: str(self.root / "app.db")})
        env.start()
        self.addCleanup(env.stop)
        self.previous_store = app_store_module._app_store
        self.previous_settings = config_module._config_instance
        self.addCleanup(self._restore_config)
        self.store = reset_app_store_for_tests()
        # 禁止临时数据库首次初始化时迁移开发者本地配置或凭据。
        self.store.migrate_config_json_once(self.root / "missing-config.json")
        self.workspace = self.root / "workspace"
        self.store.set_config_values(
            {
                "workspace_dir": str(self.workspace),
                "memory_enabled": False,
                "telegram_enabled": True,
                "telegram_bot_token": "system-test-token",
                "telegram_chat_id": "system-test-chat",
            }
        )
        self.alice = self._create_user("alice")
        self.bob = self._create_user("bob")
        self.current = self.alice
        config_module._config_instance = None
        config_module.clear_effective_settings_cache()
        get_scheduler_service.cache_clear()
        app = FastAPI()
        app.include_router(config_router, prefix="/api/v1/config")
        app.include_router(scheduler_router, prefix="/api/v1/scheduler")
        app.dependency_overrides[get_current_user] = lambda: self.current
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        # 所有测试保留真实图片校验及发送编排，仅截断最后的外部请求。
        http = patch.object(TelegramSender, "_post", autospec=True)
        self.post = http.start()
        self.post.return_value = {"ok": True, "result": {"message_id": 1}}
        self.addCleanup(http.stop)

    def _restore_config(self):
        get_scheduler_service.cache_clear()
        app_store_module._app_store = self.previous_store
        config_module._config_instance = self.previous_settings
        config_module.clear_effective_settings_cache()

    def _create_user(self, username):
        row = self.store.create_user(username, "unused-test-password", role_names=["user"])
        self.store.set_user_config_values(
            row["id"],
            {
                "telegram_bot_token": f"{username}-test-token",
                "telegram_chat_id": f"{username}-test-chat",
            },
        )
        return CurrentUser(
            id=row["id"],
            username=username,
            display_name=username,
            roles=("user",),
            permissions=frozenset({"config:read", "scheduler:read", "scheduler:write"}),
            is_active=True,
        )

    def _photo(self, user, name="chart.png"):
        path = Path(user_workspace_dir(str(self.workspace), user.id)) / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(PNG)
        return path

    def _create_task(self, **overrides):
        payload = {
            "name": "Daily chart",
            "prompt": "Generate a chart at charts/daily.png",
            "schedule": "every 5 minutes",
            "notify_telegram": True,
            "telegram_photos": ["charts/daily.png"],
            "metadata": {"source": "integration-test"},
        }
        payload.update(overrides)
        response = self.client.post("/api/v1/scheduler/tasks", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def _stored_task(self, task_id):
        return get_scheduler_service().task_store.for_user(self.current.id).get_task(task_id)

    def test_config_test_forwards_photos_and_uses_each_users_effective_settings(self):
        for user in (self.alice, self.bob):
            with self.subTest(user=user.username):
                self.current = user
                photo = self._photo(user)
                self.post.reset_mock()
                response = self.client.post(
                    "/api/v1/config/telegram/test",
                    json={"message": "  Daily chart  ", "photos": [PHOTO_URL, "chart.png"]},
                )
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["photos"], 2)
                self.assertEqual(response.json()["chunks"], 2)
                self.assertEqual(self.post.call_count, 2)
                first, second = self.post.call_args_list
                sender, method, payload = first.args
                self.assertEqual(sender.bot_token, f"{user.username}-test-token")
                self.assertEqual(sender.chat_id, f"{user.username}-test-chat")
                self.assertEqual(Path(sender.workspace_dir).resolve(), photo.parent.resolve())
                self.assertEqual(method, "sendPhoto")
                self.assertEqual(payload["photo"], PHOTO_URL)
                self.assertEqual(payload["caption"], "Daily chart")
                self.assertEqual(second.kwargs["photo"].content, PNG)
                self.assertNotIn("caption", second.args[2])

    def test_config_test_accepts_photo_only_and_preserves_empty_text_fallback(self):
        response = self.client.post(
            "/api/v1/config/telegram/test", json={"message": " ", "photos": [PHOTO_URL]}
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["photos"], 1)
        self.post.assert_called_once()
        self.assertEqual(self.post.call_args.args[1], "sendPhoto")
        self.assertNotIn("caption", self.post.call_args.args[2])

        self.post.reset_mock()
        response = self.client.post("/api/v1/config/telegram/test", json={"message": " "})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["photos"], 0)
        self.post.assert_called_once()
        self.assertEqual(self.post.call_args.args[1], "sendMessage")
        self.assertEqual(
            self.post.call_args.args[2]["text"], "Stocks Assistant Telegram test message."
        )

    def test_config_test_requires_permission_before_sending(self):
        self.current = replace(self.alice, permissions=frozenset())
        response = self.client.post("/api/v1/config/telegram/test", json={"photos": [PHOTO_URL]})
        self.assertEqual(response.status_code, 403, response.text)
        self.post.assert_not_called()

    def test_config_test_rejects_invalid_photos_and_cross_user_files_before_sending(self):
        other_photo = self._photo(self.bob)
        cases = [
            ([PHOTO_URL] * 11, 422),
            ("chart.png", 422),
            ([" "], 422),
            ([123], 422),
            (["file:///tmp/chart.png"], 400),
            (["missing.png"], 400),
            ([str(other_photo)], 400),
            ([f"../{self.bob.id}/chart.png"], 400),
        ]
        for photos, expected in cases:
            with self.subTest(photos=photos):
                response = self.client.post(
                    "/api/v1/config/telegram/test",
                    json={"message": "Do not send partially", "photos": photos},
                )
                self.assertEqual(response.status_code, expected, response.text)
        self.post.assert_not_called()

    def test_scheduler_api_persists_updates_preserves_and_clears_photo_metadata(self):
        created = self._create_task()
        task_id = created["id"]
        self.assertEqual(created["metadata"]["telegram_photos"], ["charts/daily.png"])
        self.assertEqual(self._stored_task(task_id)["metadata"], created["metadata"])

        for payload, expected in (
            ({"name": "Renamed"}, ["charts/daily.png"]),
            ({"metadata": {"label": "updated"}}, ["charts/daily.png"]),
            ({"telegram_photos": [PHOTO_URL]}, [PHOTO_URL]),
            ({"notify_telegram": False}, [PHOTO_URL]),
            ({"telegram_photos": []}, []),
        ):
            with self.subTest(payload=payload):
                response = self.client.put(f"/api/v1/scheduler/tasks/{task_id}", json=payload)
                self.assertEqual(response.status_code, 200, response.text)
                metadata = response.json()["metadata"]
                self.assertEqual(metadata["telegram_photos"], expected)
                self.assertEqual(metadata["source"], "integration-test")
                self.assertEqual(self._stored_task(task_id)["metadata"], metadata)
        self.assertFalse(metadata["notify_telegram"])
        self.post.assert_not_called()

    def test_scheduler_api_rejects_invalid_metadata_photos_without_saving(self):
        created = self._create_task()
        original = self._stored_task(created["id"])["metadata"]
        for invalid in ("chart.png", [PHOTO_URL] * 11, [None], [" "]):
            with self.subTest(invalid=invalid):
                for use_metadata in (True, False):
                    fields = (
                        {"metadata": {"telegram_photos": invalid}}
                        if use_metadata
                        else {"telegram_photos": invalid}
                    )
                    response = self.client.post(
                        "/api/v1/scheduler/tasks",
                        json={"name": "Invalid", "prompt": "chart", "schedule": "now", **fields},
                    )
                    self.assertEqual(response.status_code, 422, response.text)
                    response = self.client.put(
                        f"/api/v1/scheduler/tasks/{created['id']}", json=fields
                    )
                    self.assertEqual(response.status_code, 422, response.text)
                    self.assertEqual(self._stored_task(created["id"])["metadata"], original)
        tasks = get_scheduler_service().task_store.for_user(self.alice.id).list_tasks()
        self.assertEqual(len(tasks), 1)

    def test_scheduler_tool_creates_updates_and_clears_photos(self):
        tool = SchedulerTool(scheduler_service=get_scheduler_service(), user_id=self.alice.id)
        created = tool.execute_tool(
            {
                "action": "create",
                "name": "Tool chart",
                "prompt": "Write charts/tool.png",
                "schedule": "every 5 minutes",
                "notify_telegram": True,
                "telegram_photos": ["charts/tool.png"],
                "metadata": {"source": "tool"},
            }
        )
        self.assertEqual(created.status, "success", created.result)
        task_id = created.result["id"]
        self.assertEqual(created.result["metadata"]["telegram_photos"], ["charts/tool.png"])
        for fields, expected in (
            ({"metadata": {"label": "preserved"}}, ["charts/tool.png"]),
            ({"telegram_photos": [PHOTO_URL]}, [PHOTO_URL]),
            ({"telegram_photos": []}, []),
        ):
            result = tool.execute_tool({"action": "update", "task_id": task_id, **fields})
            self.assertEqual(result.status, "success", result.result)
            self.assertEqual(result.result["metadata"]["telegram_photos"], expected)
            self.assertTrue(result.result["metadata"]["notify_telegram"])
            self.assertEqual(result.result["metadata"]["source"], "tool")
        for fields in (
            {"telegram_photos": [""]},
            {"metadata": {"telegram_photos": "chart.png"}},
            {"metadata": {"telegram_photos": [PHOTO_URL] * 11}},
        ):
            result = tool.execute_tool({"action": "update", "task_id": task_id, **fields})
            self.assertEqual(result.status, "error")
            self.assertEqual(self._stored_task(task_id)["metadata"]["telegram_photos"], [])

    def test_scheduler_sends_chart_generated_by_agent_from_task_users_workspace(self):
        created = self._create_task()
        task = self._stored_task(created["id"])
        self.current = self.bob
        generated = []

        def run_agent(prompt, *, user_id):
            self.assertEqual(user_id, self.alice.id)
            self.assertIn("charts/daily.png", prompt)
            self.post.assert_not_called()
            generated.append(self._photo(self.alice, "charts/daily.png"))
            return "Chart generated successfully"

        with patch("app.deps._run_scheduled_agent", side_effect=run_agent) as agent:
            result = get_scheduler_service().execute_callback(task)
        agent.assert_called_once()
        self.assertEqual(result, "Chart generated successfully")
        self.assertEqual(len(generated), 1)
        self.post.assert_called_once()
        sender, method, payload = self.post.call_args.args
        self.assertEqual(sender.bot_token, "alice-test-token")
        self.assertEqual(payload["chat_id"], "alice-test-chat")
        self.assertEqual(Path(sender.workspace_dir).resolve(), generated[0].parent.parent.resolve())
        self.assertEqual(method, "sendPhoto")
        self.assertIn(result, payload["caption"])
        self.assertEqual(self.post.call_args.kwargs["photo"].content, PNG)

    def test_scheduler_does_not_send_or_read_photos_when_notification_disabled(self):
        created = self._create_task(notify_telegram=False, telegram_photos=["missing.png"])
        with patch("app.deps._run_scheduled_agent", return_value="Completed") as agent:
            result = get_scheduler_service().execute_callback(self._stored_task(created["id"]))
        self.assertEqual(result, "Completed")
        agent.assert_called_once()
        self.post.assert_not_called()

    def test_scheduler_rejects_cross_user_local_photo_before_any_delivery(self):
        other_photo = self._photo(self.bob)
        created = self._create_task(telegram_photos=[PHOTO_URL, str(other_photo)])
        with (
            patch("app.deps._run_scheduled_agent", return_value="Completed") as agent,
            self.assertRaisesRegex(ValueError, "outside workspace"),
        ):
            get_scheduler_service().execute_callback(self._stored_task(created["id"]))
        agent.assert_called_once()
        self.post.assert_not_called()


if __name__ == "__main__":
    unittest.main()
