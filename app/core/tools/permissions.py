"""Tool permission helpers for the main Agent."""

from __future__ import annotations

from typing import Iterable

from app.core.tools.base_tool import BaseTool


def is_mcp_tool_name(name: str) -> bool:
    return str(name).startswith("mcp_")


def mcp_server_name_from_tool(name: str) -> str | None:
    if not is_mcp_tool_name(name):
        return None
    remainder = name.removeprefix("mcp_")
    if "_" not in remainder:
        return None
    return remainder.split("_", 1)[0]


def is_tool_allowed_for_agent(name: str, settings) -> bool:
    if name == "delegate_agent" and not bool(getattr(settings, "multi_agent_enabled", False)):
        return False
    allowlist = set(str(item) for item in (getattr(settings, "agent_tool_allowlist", []) or []))
    return name in allowlist or (bool(getattr(settings, "agent_allow_all_mcp_tools", False)) and is_mcp_tool_name(name))


def filter_agent_tools(tools: Iterable[BaseTool], settings) -> list[BaseTool]:
    return [tool for tool in tools if is_tool_allowed_for_agent(tool.name, settings)]
