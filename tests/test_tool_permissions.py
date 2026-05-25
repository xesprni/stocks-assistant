import unittest
from types import SimpleNamespace

from app.core.tools.permissions import filter_agent_tools, is_tool_allowed_for_agent, mcp_server_name_from_tool


class ToolPermissionTest(unittest.TestCase):
    def test_filters_main_agent_tools_by_allowlist_and_all_mcp_flag(self):
        settings = SimpleNamespace(
            agent_tool_allowlist=["read_file", "mcp_demo_specific"],
            agent_allow_all_mcp_tools=False,
        )
        tools = [
            SimpleNamespace(name="read_file"),
            SimpleNamespace(name="write_file"),
            SimpleNamespace(name="mcp_demo_specific"),
            SimpleNamespace(name="mcp_demo_other"),
        ]

        self.assertEqual([tool.name for tool in filter_agent_tools(tools, settings)], ["read_file", "mcp_demo_specific"])
        self.assertTrue(is_tool_allowed_for_agent("read_file", settings))
        self.assertFalse(is_tool_allowed_for_agent("write_file", settings))

    def test_all_mcp_flag_allows_current_and_future_mcp_tools(self):
        settings = SimpleNamespace(agent_tool_allowlist=[], agent_allow_all_mcp_tools=True)

        self.assertTrue(is_tool_allowed_for_agent("mcp_market_quote", settings))
        self.assertFalse(is_tool_allowed_for_agent("read_file", settings))

    def test_delegate_agent_requires_multi_agent_enabled(self):
        enabled = SimpleNamespace(
            agent_tool_allowlist=["delegate_agent"],
            agent_allow_all_mcp_tools=False,
            multi_agent_enabled=True,
        )
        disabled = SimpleNamespace(
            agent_tool_allowlist=["delegate_agent"],
            agent_allow_all_mcp_tools=False,
            multi_agent_enabled=False,
        )

        self.assertTrue(is_tool_allowed_for_agent("delegate_agent", enabled))
        self.assertFalse(is_tool_allowed_for_agent("delegate_agent", disabled))

    def test_extracts_mcp_server_name_from_tool_name(self):
        self.assertEqual(mcp_server_name_from_tool("mcp_market_quote"), "market")
        self.assertIsNone(mcp_server_name_from_tool("read_file"))


if __name__ == "__main__":
    unittest.main()
