import os
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

import app.config as config_module
import app.core.app_store as app_store_module
from app.core.app_store import APP_DB_ENV, reset_app_store_for_tests
from app.core.security import user_workspace_dir
from app.core.tools.bash import BashTool
from app.deps import get_mcp_manager_for_user, get_memory_manager_for_user
from app.main import app


class UserWorkspaceTest(unittest.TestCase):
    def test_user_workspace_dir_creates_bash_workdir(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = user_workspace_dir(tmp, "user-123")
            workspace_path = Path(workspace)

            self.assertTrue(workspace_path.is_dir())
            self.assertTrue((workspace_path / "memory").is_dir())
            self.assertTrue((workspace_path / "knowledge").is_dir())
            self.assertTrue((workspace_path / "skills").is_dir())
            self.assertTrue((workspace_path / "MEMORY.md").is_file())

            result = BashTool(config={"cwd": workspace}).execute({"command": "pwd"})

            self.assertEqual(result.status, "success")
            self.assertIn(str(workspace_path), result.result["output"])

    def test_user_workspace_dir_rejects_path_like_user_id(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                user_workspace_dir(tmp, "../outside")


class ToolApiWorkspaceIsolationTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old_db_path = os.environ.get(APP_DB_ENV)
        self.db_path = Path(self.tmp.name) / "app.db"
        self.workspace = Path(self.tmp.name) / "workspace"
        os.environ[APP_DB_ENV] = str(self.db_path)
        self.store = reset_app_store_for_tests(self.db_path)
        self.store.set_config_values({"workspace_dir": str(self.workspace), "memory_enabled": False})
        config_module._config_instance = None
        get_memory_manager_for_user.cache_clear()
        get_mcp_manager_for_user.cache_clear()
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        config_module._config_instance = None
        get_memory_manager_for_user.cache_clear()
        get_mcp_manager_for_user.cache_clear()
        app_store_module._app_store = None
        if self.old_db_path is None:
            os.environ.pop(APP_DB_ENV, None)
        else:
            os.environ[APP_DB_ENV] = self.old_db_path
        self.tmp.cleanup()

    def _setup_admin(self):
        response = self.client.post(
            "/api/v1/auth/setup",
            json={"username": "admin", "password": "Password123!", "display_name": "Admin"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        return data["user"], {"Authorization": f"Bearer {data['access_token']}"}

    def test_direct_tool_execution_uses_user_workspace(self):
        user, headers = self._setup_admin()
        user_workspace = self.workspace / "users" / user["id"]

        pwd = self.client.post(
            "/api/v1/tools/bash/execute",
            json={"arguments": {"command": "pwd"}},
            headers=headers,
        )
        self.assertEqual(pwd.status_code, 200, pwd.text)
        self.assertEqual(pwd.json()["status"], "success")
        self.assertIn(str(user_workspace), pwd.json()["result"]["output"])

        written = self.client.post(
            "/api/v1/tools/write_file/execute",
            json={"arguments": {"path": "direct-tool-marker.txt", "content": "owned by user workspace"}},
            headers=headers,
        )
        self.assertEqual(written.status_code, 200, written.text)
        self.assertEqual(written.json()["status"], "success")
        self.assertEqual((user_workspace / "direct-tool-marker.txt").read_text(encoding="utf-8"), "owned by user workspace")


if __name__ == "__main__":
    unittest.main()
