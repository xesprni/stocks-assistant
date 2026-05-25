import os
import tempfile
import unittest
from pathlib import Path

import app.config as config_module
import app.core.app_store as app_store_module
from app.core.app_store import APP_DB_ENV, reset_app_store_for_tests
from app.core.tools.scheduler.service import SchedulerService
from app.core.tools.scheduler.store import SQLiteRunStore, SQLiteTaskStore
from app.core.tools.scheduler.tool import SchedulerTool
from app.core.tools.tool_manager import ToolManager
from app.deps import get_scheduler_service


class SchedulerToolTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old_db_path = os.environ.get(APP_DB_ENV)
        self.db_path = Path(self.tmp.name) / "app.db"
        self.workspace = Path(self.tmp.name) / "workspace"
        os.environ[APP_DB_ENV] = str(self.db_path)
        self.store = reset_app_store_for_tests(self.db_path)
        self.store.set_config_values({"workspace_dir": str(self.workspace), "memory_enabled": False})
        self.user = self.store.create_user("admin", "password-hash", display_name="Admin", role_names=["admin"])
        config_module._config_instance = None
        get_scheduler_service.cache_clear()

    def tearDown(self):
        config_module._config_instance = None
        get_scheduler_service.cache_clear()
        app_store_module._app_store = None
        if self.old_db_path is None:
            os.environ.pop(APP_DB_ENV, None)
        else:
            os.environ[APP_DB_ENV] = self.old_db_path
        self.tmp.cleanup()

    def test_tool_manager_injects_scheduler_store(self):
        manager = ToolManager(workspace_dir=str(self.workspace), user_id=self.user["id"])
        manager.load_builtin_tools(memory_manager=None, user_id=self.user["id"])

        tool = manager.get_tool("scheduler")
        self.assertIsNotNone(tool)
        result = tool.execute_tool({"action": "list"})

        self.assertEqual(result.status, "success")
        self.assertEqual(result.result, {"tasks": [], "total": 0})

    def test_scheduler_tool_matches_api_task_lifecycle(self):
        service = SchedulerService(
            task_store=SQLiteTaskStore(),
            run_store=SQLiteRunStore(),
            execute_callback=lambda task: f"ran {task['name']}",
        )
        tool = SchedulerTool(scheduler_service=service, user_id=self.user["id"])

        created = tool.execute_tool(
            {
                "action": "create",
                "name": "Morning brief",
                "prompt": "Summarize the watchlist",
                "schedule": "every 5 minutes",
                "notify_telegram": True,
                "metadata": {"source": "test"},
            }
        )

        self.assertEqual(created.status, "success")
        task_id = created.result["id"]
        self.assertEqual(created.result["name"], "Morning brief")
        self.assertTrue(created.result["enabled"])
        self.assertEqual(created.result["metadata"]["source"], "test")
        self.assertTrue(created.result["metadata"]["notify_telegram"])

        updated = tool.execute_tool(
            {
                "action": "update",
                "task_id": task_id,
                "name": "Opening brief",
                "schedule": "every 10 minutes",
                "enabled": False,
            }
        )
        self.assertEqual(updated.status, "success")
        self.assertEqual(updated.result["name"], "Opening brief")
        self.assertFalse(updated.result["enabled"])

        listed = tool.execute_tool({"action": "list"})
        self.assertEqual(listed.status, "success")
        self.assertEqual(listed.result["total"], 1)

        toggled = tool.execute_tool({"action": "toggle", "task_id": task_id})
        self.assertEqual(toggled.status, "success")
        self.assertTrue(toggled.result["enabled"])

        run = tool.execute_tool({"action": "run", "task_id": task_id})
        self.assertEqual(run.status, "success")
        self.assertEqual(run.result["status"], "success")
        self.assertEqual(run.result["task_id"], task_id)
        self.assertIn("ran Opening brief", run.result["output_preview"])

        runs = tool.execute_tool({"action": "list_runs", "task_id": task_id})
        self.assertEqual(runs.status, "success")
        self.assertEqual(runs.result["total"], 1)
        self.assertEqual(runs.result["runs"][0]["task_id"], task_id)

        deleted = tool.execute_tool({"action": "delete", "task_id": task_id})
        self.assertEqual(deleted.status, "success")
        self.assertEqual(deleted.result, {"status": "ok"})


if __name__ == "__main__":
    unittest.main()
