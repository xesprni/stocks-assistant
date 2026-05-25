import asyncio
import unittest
from types import SimpleNamespace

from mcp.shared.exceptions import McpError
from mcp.types import ErrorData

from app.core.agent.executor import AgentStreamExecutor
from app.core.tools.base_tool import BaseTool, ToolResult
from app.core.tools.mcp.mcp_tool import MCPManager, MCPToolAdapter


class SlowSession:
    async def call_tool(self, tool_name: str, params: dict):
        await asyncio.sleep(0.05)
        return "too late"


class FastSession:
    async def call_tool(self, tool_name: str, params: dict):
        return "ok"


class ErrorResultSession:
    async def call_tool(self, tool_name: str, params: dict):
        return SimpleNamespace(
            content=[SimpleNamespace(text="invalid symbol")],
            structuredContent={"reason": "symbol is required"},
            isError=True,
        )


class McpErrorManager:
    def call_tool_sync(self, server_name: str, tool_name: str, params: dict):
        raise McpError(
            ErrorData(
                code=1,
                message="openapi error: code=1: internal server error",
                data={
                    "detail": "upstream said missing quote permission",
                    "Authorization": "Bearer should-not-leak",
                },
            )
        )

    def _format_tool_error(self, exc: BaseException) -> str:
        return MCPManager({})._format_tool_error(exc)


class FailingMCPTool(BaseTool):
    name = "mcp_demo_quote"
    description = "failing MCP quote tool"
    params = {"type": "object", "properties": {}}

    def execute(self, params: dict) -> ToolResult:
        return ToolResult.fail("MCP tool error: missing quote permission")


class InspectingAgentExecutor(AgentStreamExecutor):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.llm_calls = 0

    def _trim_messages(self):
        return None

    def _call_llm_stream(self, *args, **kwargs):
        self.llm_calls += 1
        if self.llm_calls == 1:
            return "", [
                {
                    "id": "call_1",
                    "name": "mcp_demo_quote",
                    "arguments": {"symbol": "BAD"},
                }
            ]

        block = self.messages[-1]["content"][0]
        if block.get("type") != "tool_result":
            raise AssertionError("expected a tool_result message before next LLM call")
        if block.get("is_error") is not True:
            raise AssertionError("expected failed tool_result to be marked as error")
        if "missing quote permission" not in block.get("content", ""):
            raise AssertionError("expected concrete MCP error detail to be returned to the model")
        return "handled tool error", []


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

    def test_formats_mcp_json_rpc_error_data(self):
        manager = MCPManager({})

        message = manager._format_tool_error(
            McpError(
                ErrorData(
                    code=1,
                    message="openapi error: code=1: internal server error",
                    data={
                        "detail": "upstream said missing quote permission",
                        "nested": {"reason": "invalid request"},
                        "access_token": "should-not-leak",
                    },
                )
            )
        )

        self.assertIn("MCP JSON-RPC error code=1", message)
        self.assertIn("missing quote permission", message)
        self.assertIn("invalid request", message)
        self.assertNotIn("should-not-leak", message)

    def test_adapter_returns_mcp_error_details(self):
        adapter = MCPToolAdapter(
            server_name="demo",
            tool_name="quote",
            tool_description="",
            tool_schema={},
            manager=McpErrorManager(),
        )

        with self.assertLogs("stocks-assistant.mcp", level="WARNING"):
            result = adapter.execute({})

        self.assertEqual(result.status, "error")
        self.assertIn("missing quote permission", result.result)
        self.assertNotIn("should-not-leak", result.result)

    def test_call_tool_treats_mcp_is_error_as_failure(self):
        manager = MCPManager({})
        manager._sessions["demo"] = ErrorResultSession()
        try:
            with self.assertRaisesRegex(RuntimeError, "invalid symbol"):
                manager.call_tool_sync("demo", "quote", {})
        finally:
            manager.close_sync()

    def test_agent_returns_mcp_tool_error_to_next_model_turn(self):
        executor = InspectingAgentExecutor(
            agent=None,
            model=None,
            system_prompt="",
            tools=[FailingMCPTool()],
        )

        response = executor.run_stream("query quote")

        self.assertEqual(response, "handled tool error")


if __name__ == "__main__":
    unittest.main()
