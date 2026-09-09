"""工具系统 API

提供工具列表和直接执行工具的接口。
"""

from contextlib import ExitStack

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from app.config import get_effective_settings
from app.core.security import CurrentUser, require_permissions, user_workspace_dir
from app.core.tools.call_context import ToolCallContext
from app.core.tools.permissions import is_tool_allowed_for_agent, mcp_server_name_from_tool
from app.core.tools.render_artifacts import rendered_image_path
from app.core.tools.result_metadata import normalize_tool_metadata
from app.core.tools.tool_manager import ToolManager
from app.deps import get_mcp_manager_for_user, get_memory_manager_for_user
from app.schemas.tools import ToolExecuteRequest, ToolExecuteResponse, ToolListResponse

router = APIRouter()


@router.get("/render-image/{artifact_id}/{filename}", response_class=FileResponse)
def get_rendered_image(
    artifact_id: str,
    filename: str,
    current_user: CurrentUser = Depends(require_permissions("chat:read")),
):
    settings = get_effective_settings(current_user.id)
    try:
        workspace = user_workspace_dir(settings.workspace_dir, current_user.id)
        path = rendered_image_path(workspace, artifact_id, filename)
    except (OSError, RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=404, detail="Rendered image not found") from exc
    return FileResponse(
        path,
        media_type="image/png",
        filename=f"{artifact_id}-{filename}",
        content_disposition_type="inline",
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )


def _tool_manager_for_user(current_user: CurrentUser, settings, memory_manager=None) -> ToolManager:
    workspace_dir = user_workspace_dir(settings.workspace_dir, current_user.id)
    manager = ToolManager(workspace_dir=workspace_dir, user_id=current_user.id)
    if memory_manager is None and settings.memory_enabled:
        memory_manager = get_memory_manager_for_user(current_user.id)
    manager.load_builtin_tools(
        memory_manager=memory_manager, user_id=current_user.id, settings=settings
    )
    return manager


@router.get("", response_model=ToolListResponse)
def list_tools(current_user: CurrentUser = Depends(require_permissions("tools:read"))):
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
def execute_tool(
    name: str,
    request: ToolExecuteRequest,
    current_user: CurrentUser = Depends(require_permissions("tools:execute")),
):
    import time

    from app import deps

    settings = get_effective_settings(current_user.id)
    with ExitStack() as resources:
        memory = (
            resources.enter_context(
                deps.lease_memory_manager_for_user(current_user.id, settings=settings)
            )
            if settings.memory_enabled
            else None
        )
        mgr = _tool_manager_for_user(current_user, settings, memory_manager=memory)
        tool = mgr.get_tool(name)
        if not tool and name.startswith("mcp_") and settings.mcp_servers:
            manager = resources.enter_context(
                deps.lease_mcp_manager_for_user(current_user.id, settings=settings)
            )
            tool = next((item for item in manager.get_tools() if item.name == name), None)
        if not tool:
            raise HTTPException(status_code=404, detail=f"Tool '{name}' not found")

        context = ToolCallContext(
            tool_name=name,
            user_id=current_user.id,
            settings=settings,
            memory_manager=memory,
            skill_manager=deps.get_skill_manager(),
            workspace_dir=user_workspace_dir(settings.workspace_dir, current_user.id),
        )
        start = time.monotonic()
        result = tool.execute_tool(request.arguments, context)
        execution_time = time.monotonic() - start
        metadata = normalize_tool_metadata(
            status=result.status,
            result=result.result,
            metadata=result.ext_data,
            tool_name=name,
        )
        return ToolExecuteResponse(
            status=result.status,
            result=result.result,
            evidence=metadata["evidence"],
            sources=metadata["sources"],
            execution_time=execution_time,
        )
