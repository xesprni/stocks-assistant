"""MCP 服务器状态和工具查询 API。"""

from fastapi import APIRouter, Depends, HTTPException

from app.config import get_settings
from app.schemas.mcp import MCPServerStatus, MCPStatusResponse, MCPServerToolsResponse, MCPToolInfo

router = APIRouter()


def _build_server_statuses() -> list[MCPServerStatus]:
    """根据当前配置和已连接的 MCP sessions 构建状态列表。"""
    settings = get_settings()
    statuses: list[MCPServerStatus] = []

    # 尝试获取 MCPManager 单例（可能尚未初始化）
    manager = None
    try:
        from app.deps import get_mcp_manager
        manager = get_mcp_manager()
    except Exception:
        pass

    for name, cfg in settings.mcp_servers.items():
        transport = cfg.get("transport", "sse")
        url = cfg.get("url", "")
        command = cfg.get("command", "")
        args = cfg.get("args", [])
        headers = cfg.get("headers", {})

        server_status = "disconnected"
        error_msg = None
        tools_count = 0

        if manager:
            # 统计该服务器的已发现工具数量
            prefix = f"mcp_{name}_"
            server_tools = [t for t in manager.tools if t.name.startswith(prefix)]
            tools_count = len(server_tools)
            if tools_count > 0:
                server_status = "connected"
            elif name in (manager._errors if hasattr(manager, "_errors") else {}):
                server_status = "error"
                error_msg = manager._errors[name]

        statuses.append(
            MCPServerStatus(
                name=name,
                transport=transport,
                url=url,
                command=command,
                args=args,
                headers=headers,
                status=server_status,
                error=error_msg,
                tools_count=tools_count,
            )
        )

    return statuses


@router.get("/status", response_model=MCPStatusResponse)
async def get_mcp_status():
    """获取所有 MCP 服务器的连接状态。"""
    servers = _build_server_statuses()
    return MCPStatusResponse(servers=servers, total=len(servers))


@router.get("/{server_name}/tools", response_model=MCPServerToolsResponse)
async def get_mcp_server_tools(server_name: str):
    """获取指定 MCP 服务器的工具列表。"""
    settings = get_settings()
    if server_name not in settings.mcp_servers:
        raise HTTPException(status_code=404, detail=f"MCP server '{server_name}' not found")

    tools: list[MCPToolInfo] = []
    manager = None
    try:
        from app.deps import get_mcp_manager
        manager = get_mcp_manager()
    except Exception:
        pass

    if manager:
        prefix = f"mcp_{server_name}_"
        for tool in manager.tools.values():
            if tool.name.startswith(prefix):
                tools.append(
                    MCPToolInfo(
                        name=tool.tool_name,
                        description=tool.description,
                        parameters=tool.params,
                    )
                )

    return MCPServerToolsResponse(server_name=server_name, tools=tools, total=len(tools))
