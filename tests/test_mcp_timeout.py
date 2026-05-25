import asyncio
import unittest

from app.core.tools.mcp.mcp_tool import MCPManager


class SlowSession:
    async def call_tool(self, tool_name: str, params: dict):
        await asyncio.sleep(0.05)
        return "too late"


class FastSession:
    async def call_tool(self, tool_name: str, params: dict):
        return "ok"


class MCPToolTimeoutTest(unittest.TestCase):
    def test_call_tool_times_out(self):
        manager = MCPManager({}, tool_timeout_seconds=0.01)
        manager._sessions["demo"] = SlowSession()
        try:
            with self.assertRaisesRegex(RuntimeError, "timed out after"):
                manager.call_tool_sync("demo", "slow_tool", {})
        finally:
            manager.close_sync()

    def test_call_tool_uses_server_specific_timeout(self):
        manager = MCPManager({}, tool_timeout_seconds=0.01)
        manager.server_configs["demo"] = {"tool_timeout_seconds": 1}
        manager._sessions["demo"] = FastSession()
        try:
            self.assertEqual(manager.call_tool_sync("demo", "fast_tool", {}), "ok")
        finally:
            manager.close_sync()

    def test_formats_taskgroup_authorization_error(self):
        manager = MCPManager({})

        message = manager._format_connect_error(
            ExceptionGroup("unhandled errors in a TaskGroup", [RuntimeError("401 Unauthorized")])
        )

        self.assertIn("authorization failed", message)

    def test_formats_bare_taskgroup_error(self):
        manager = MCPManager({})

        message = manager._format_connect_error(RuntimeError("unhandled errors in a TaskGroup (1 sub-exception)"))

        self.assertIn("OAuth authorization URL", message)


if __name__ == "__main__":
    unittest.main()
