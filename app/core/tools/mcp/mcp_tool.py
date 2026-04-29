"""MCP (Model Context Protocol) 工具适配器

通过 MCP 协议连接外部工具服务器，将 MCP 工具动态包装为 BaseTool 实例。
支持 SSE 和 stdio 两种传输方式。
"""
import json
from typing import Any, Dict, List, Optional

from app.core.tools.base_tool import BaseTool, ToolResult

import logging

logger = logging.getLogger("stocks-assistant.mcp")


class MCPToolAdapter(BaseTool):
    """Wraps an MCP server tool as a BaseTool instance."""

    name: str = "mcp_tool"
    description: str = "MCP tool adapter"
    params: dict = {"type": "object", "properties": {}}

    def __init__(self, server_name: str, tool_name: str, tool_description: str, tool_schema: dict, session=None):
        super().__init__()
        self.server_name = server_name
        self.tool_name = tool_name
        self.name = f"mcp_{server_name}_{tool_name}"
        self.description = tool_description
        self.params = tool_schema.get("inputSchema", {"type": "object", "properties": {}})
        self._session = session

    def execute(self, params: dict) -> ToolResult:
        try:
            result = asyncio.run(self._call_mcp(params))
            return ToolResult.success(result)
        except Exception as e:
            return ToolResult.fail(f"MCP tool error: {e}")

    async def _call_mcp(self, params: dict):
        if not self._session:
            raise RuntimeError("MCP session not connected")
        result = await self._session.call_tool(self.tool_name, params)
        if hasattr(result, 'content'):
            texts = [c.text for c in result.content if hasattr(c, 'text')]
            return "\n".join(texts) if texts else str(result.content)
        return str(result)


class MCPManager:
    """Manages connections to MCP servers and discovers tools."""

    def __init__(self, server_configs: Dict[str, Dict[str, Any]]):
        self.server_configs = server_configs
        self.tools: Dict[str, MCPToolAdapter] = {}
        self._sessions: Dict[str, Any] = {}

    async def connect_all(self):
        for server_name, config in self.server_configs.items():
            try:
                await self._connect_server(server_name, config)
            except Exception as e:
                logger.warning(f"Failed to connect MCP server '{server_name}': {e}")

    async def _connect_server(self, server_name: str, config: dict):
        transport = config.get("transport", "sse")
        try:
            from mcp import ClientSession
            if transport == "sse":
                from mcp.client.sse import sse_client
                url = config["url"]
                async with sse_client(url) as (read, write):
                    async with ClientSession(read, write) as session:
                        await session.initialize()
                        await self._discover_tools(server_name, session)
            elif transport == "stdio":
                from mcp.client.stdio import stdio_client
                command = config.get("command", "")
                args = config.get("args", [])
                import shutil
                server_params = {"command": shutil.which(command) or command, "args": args}
                async with stdio_client(server_params) as (read, write):
                    async with ClientSession(read, write) as session:
                        await session.initialize()
                        await self._discover_tools(server_name, session)
        except ImportError:
            logger.warning("MCP SDK not installed. Run: pip install mcp")
        except Exception as e:
            logger.error(f"MCP connect error for '{server_name}': {e}")

    async def _discover_tools(self, server_name: str, session):
        result = await session.list_tools()
        for tool in result.tools:
            adapter = MCPToolAdapter(
                server_name=server_name,
                tool_name=tool.name,
                tool_description=tool.description or "",
                tool_schema={"inputSchema": tool.inputSchema} if hasattr(tool, 'inputSchema') else {},
                session=session,
            )
            self.tools[adapter.name] = adapter
            logger.info(f"Discovered MCP tool: {adapter.name}")

    def get_tools(self) -> List[MCPToolAdapter]:
        return list(self.tools.values())
