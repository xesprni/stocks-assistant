"""工具系统 API

提供工具列表和直接执行工具的接口。
"""

from fastapi import APIRouter, Depends, HTTPException

from app.schemas.tools import ToolListResponse, ToolExecuteRequest, ToolExecuteResponse
from app.config import get_settings
from app.deps import get_mcp_manager, get_tool_manager

router = APIRouter()


@router.get("", response_model=ToolListResponse)
async def list_tools():
    mgr = get_tool_manager()
    tools = mgr.get_all_tools()
    if get_settings().mcp_servers:
        tools.extend(get_mcp_manager().get_tools())
    return ToolListResponse(
        tools=[{"name": t.name, "description": t.description, "parameters": t.params} for t in tools],
        total=len(tools),
    )


@router.post("/{name}/execute", response_model=ToolExecuteResponse)
async def execute_tool(name: str, request: ToolExecuteRequest):
    mgr = get_tool_manager()
    tool = mgr.get_tool(name)
    if not tool and name.startswith("mcp_") and get_settings().mcp_servers:
        tool = next((item for item in get_mcp_manager().get_tools() if item.name == name), None)
    if not tool:
        raise HTTPException(status_code=404, detail=f"Tool '{name}' not found")

    import time
    start = time.time()
    result = tool.execute_tool(request.arguments)
    execution_time = time.time() - start

    return ToolExecuteResponse(
        status=result.status,
        result=result.result,
        execution_time=execution_time,
    )
