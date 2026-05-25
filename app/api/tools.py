"""工具系统 API

提供工具列表和直接执行工具的接口。
"""

from fastapi import APIRouter, Depends, HTTPException

from app.schemas.tools import ToolListResponse, ToolExecuteRequest, ToolExecuteResponse
from app.config import get_effective_settings
from app.core.tools.permissions import is_tool_allowed_for_agent, mcp_server_name_from_tool
from app.core.tools.tool_manager import ToolManager
from app.deps import get_mcp_manager_for_user, get_memory_manager_for_user
from app.core.security import CurrentUser, require_permissions, user_workspace_dir

router = APIRouter()


def _tool_manager_for_user(current_user: CurrentUser, settings) -> ToolManager:
    workspace_dir = user_workspace_dir(settings.workspace_dir, current_user.id)
    manager = ToolManager(workspace_dir=workspace_dir, user_id=current_user.id)
    memory_manager = get_memory_manager_for_user(current_user.id) if settings.memory_enabled else None
    manager.load_builtin_tools(memory_manager=memory_manager, user_id=current_user.id)
    return manager


@router.get("", response_model=ToolListResponse)
async def list_tools(current_user: CurrentUser = Depends(require_permissions("tools:read"))):
    settings = get_effective_settings(current_user.id)
    mgr = _tool_manager_for_user(current_user, settings)
    tools = mgr.get_all_tools()
    if settings.mcp_servers:
        tools.extend(get_mcp_manager_for_user(current_user.id).get_tools())
    return ToolListResponse(
        tools=[
            {
                "name": t.name,
                "description": t.description,
                "parameters": t.params,
                "source": "mcp" if t.name.startswith("mcp_") else "builtin",
                "server_name": getattr(t, "server_name", None) or mcp_server_name_from_tool(t.name),
                "enabled": is_tool_allowed_for_agent(t.name, settings),
            }
            for t in tools
        ],
        total=len(tools),
    )


@router.post("/{name}/execute", response_model=ToolExecuteResponse)
async def execute_tool(
    name: str,
    request: ToolExecuteRequest,
    current_user: CurrentUser = Depends(require_permissions("tools:execute")),
):
    settings = get_effective_settings(current_user.id)
    mgr = _tool_manager_for_user(current_user, settings)
    tool = mgr.get_tool(name)
    if not tool and name.startswith("mcp_") and settings.mcp_servers:
        tool = next((item for item in get_mcp_manager_for_user(current_user.id).get_tools() if item.name == name), None)
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
