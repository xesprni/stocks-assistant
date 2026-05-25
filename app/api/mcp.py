"""MCP 服务器状态和工具查询 API。"""

from html import escape
from urllib.parse import parse_qs, urlparse

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, RedirectResponse

from app.config import get_effective_settings
from app.core.tools.mcp.config import LEGACY_SSE_TRANSPORT, STANDARD_HTTP_TRANSPORT, mask_mcp_server_config, normalize_transport
from app.core.security import CurrentUser, require_permissions
from app.schemas.mcp import MCPOAuthAuthorizeResponse, MCPServerStatus, MCPStatusResponse, MCPServerToolsResponse, MCPToolInfo

router = APIRouter()
_PENDING_OAUTH_USERS: dict[tuple[str, str], str] = {}


def _oauth_pending_key(server_name: str, state: str | None = None) -> tuple[str, str]:
    return (server_name, state or "")


def _oauth_state_from_url(authorization_url: str) -> str:
    try:
        values = parse_qs(urlparse(authorization_url).query).get("state") or []
        return str(values[0] or "") if values else ""
    except Exception:
        return ""


def _remember_oauth_user(server_name: str, authorization_url: str, user_id: str) -> None:
    state = _oauth_state_from_url(authorization_url)
    _PENDING_OAUTH_USERS[_oauth_pending_key(server_name, state)] = user_id
    if state:
        # Some providers omit state on callback; keep a latest-user fallback so the
        # callback still reaches the user-scoped manager instead of the global one.
        _PENDING_OAUTH_USERS[_oauth_pending_key(server_name)] = user_id


async def _start_mcp_oauth_authorization(server_name: str, request: Request, current_user: CurrentUser) -> str:
    settings = get_effective_settings(current_user.id)
    if server_name not in settings.mcp_servers:
        raise HTTPException(status_code=404, detail=f"MCP server '{server_name}' not found")

    try:
        from app.deps import get_mcp_manager_for_user

        redirect_uri = str(request.url_for("mcp_oauth_callback", server_name=server_name))
        manager = get_mcp_manager_for_user(current_user.id)
        authorization_url = await run_in_threadpool(
            manager.start_oauth_authorization_sync,
            server_name,
            redirect_uri,
        )
        _remember_oauth_user(server_name, authorization_url, current_user.id)
        return authorization_url
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=409, detail=f"MCP OAuth authorization failed: {exc}") from exc


def _build_server_statuses(user: CurrentUser) -> list[MCPServerStatus]:
    """根据当前配置和已连接的 MCP sessions 构建状态列表。"""
    settings = get_effective_settings(user.id)
    statuses: list[MCPServerStatus] = []

    # 尝试获取 MCPManager 单例（可能尚未初始化）
    manager = None
    try:
        from app.deps import get_mcp_manager_for_user
        manager = get_mcp_manager_for_user(user.id)
    except Exception:
        pass

    for name, cfg in settings.mcp_servers.items():
        transport = normalize_transport(cfg.get("transport"), cfg)
        url = cfg.get("url", "")
        command = cfg.get("command", "")
        args = cfg.get("args", [])
        masked_cfg = mask_mcp_server_config(cfg)
        headers = masked_cfg.get("headers", {})

        server_status = "disconnected"
        error_msg = None
        tools_count = 0

        oauth_authorization_url = None
        if manager:
            server_status, error_msg, tools_count, oauth_authorization_url = manager.get_server_state(name)

        # 检查服务器是否需要/使用 OAuth 授权码流程
        # 1. 配置中显式声明了 OAuth auth type
        # 2. 运行时通过 MCP 协议层发现了 OAuth（connected 且有 token）
        # 3. 当前正处于 auth_required 状态
        auth = cfg.get("auth")
        oauth_enabled = False
        if isinstance(auth, dict):
            auth_type = str(auth.get("type", "")).lower()
            oauth_enabled = auth_type in {"oauth", "oauth2", "authorization_code", "oauth_browser", "oauth_authorization_code"}
        if not oauth_enabled and manager:
            # 协议层发现的 OAuth：检查是否有持久化 token 或当前需要授权
            if manager._token_store and manager._token_store.get_tokens(name):
                oauth_enabled = True
            elif manager._token_store and manager._token_store.get_client_info(name):
                oauth_enabled = True
            elif server_status == "auth_required":
                oauth_enabled = True
            elif transport in {STANDARD_HTTP_TRANSPORT, LEGACY_SSE_TRANSPORT}:
                error_lower = str(error_msg or "").lower()
                oauth_enabled = any(
                    marker in error_lower
                    for marker in ("oauth", "authorization", "unauthorized", "login", "token")
                )

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
                oauth_authorization_url=oauth_authorization_url,
                oauth_enabled=oauth_enabled,
            )
        )

    return statuses


@router.get("/status", response_model=MCPStatusResponse)
async def get_mcp_status(current_user: CurrentUser = Depends(require_permissions("mcp:read"))):
    """获取所有 MCP 服务器的连接状态。"""
    servers = _build_server_statuses(current_user)
    return MCPStatusResponse(servers=servers, total=len(servers))


@router.post("/{server_name}/oauth/authorize", response_model=MCPOAuthAuthorizeResponse)
async def create_mcp_oauth_authorization(
    server_name: str,
    request: Request,
    current_user: CurrentUser = Depends(require_permissions("mcp:write")),
):
    """以当前用户身份启动 MCP OAuth 授权流程，返回外部授权 URL。"""
    authorization_url = await _start_mcp_oauth_authorization(server_name, request, current_user)
    return MCPOAuthAuthorizeResponse(authorization_url=authorization_url)


@router.get("/{server_name}/oauth/authorize")
async def authorize_mcp_server(
    server_name: str,
    request: Request,
    current_user: CurrentUser = Depends(require_permissions("mcp:write")),
):
    """启动需要浏览器登录的 MCP OAuth 授权流程。"""
    authorization_url = await _start_mcp_oauth_authorization(server_name, request, current_user)
    return RedirectResponse(authorization_url)


@router.get("/oauth/callback/{server_name}", name="mcp_oauth_callback", response_class=HTMLResponse)
async def mcp_oauth_callback(
    server_name: str,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
):
    """接收 MCP OAuth 授权码回调。"""
    try:
        from app.deps import get_mcp_manager, get_mcp_manager_for_user

        pending_key = _oauth_pending_key(server_name, state)
        user_id = _PENDING_OAUTH_USERS.get(pending_key)
        if not user_id and not state:
            user_id = _PENDING_OAUTH_USERS.get(_oauth_pending_key(server_name))
        manager = get_mcp_manager_for_user(user_id) if user_id else get_mcp_manager()
        await run_in_threadpool(manager.complete_oauth_callback_sync, server_name, code, state, error)
        _PENDING_OAUTH_USERS.pop(pending_key, None)
        if user_id:
            _PENDING_OAUTH_USERS.pop(_oauth_pending_key(server_name), None)
    except Exception as exc:
        detail = escape(str(exc))
        return HTMLResponse(
            f"""
            <!doctype html>
            <meta charset="utf-8" />
            <title>MCP OAuth Failed</title>
            <body style="font-family: system-ui, sans-serif; padding: 24px;">
              <h2>MCP OAuth 授权失败</h2>
              <p>{detail}</p>
            </body>
            """,
            status_code=400,
        )

    return HTMLResponse(
        """
        <!doctype html>
        <meta charset="utf-8" />
        <title>MCP OAuth Complete</title>
        <body style="font-family: system-ui, sans-serif; padding: 24px;">
          <h2>MCP OAuth 授权完成</h2>
          <p>可以回到 Stocks Assistant 查看 MCP 连接状态。</p>
        </body>
        """,
    )


@router.post("/reconnect", response_model=MCPStatusResponse)
async def reconnect_mcp_servers(current_user: CurrentUser = Depends(require_permissions("mcp:write"))):
    """重新连接所有已配置 MCP 服务器。"""
    settings = get_effective_settings(current_user.id)
    try:
        from app.deps import get_mcp_manager_for_user

        manager = get_mcp_manager_for_user(current_user.id)
        manager.reconnect_background(settings.mcp_servers)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"MCP reconnect failed: {exc}") from exc
    servers = _build_server_statuses(current_user)
    return MCPStatusResponse(servers=servers, total=len(servers))


@router.delete("/{server_name}/oauth")
async def delete_mcp_oauth(server_name: str, current_user: CurrentUser = Depends(require_permissions("mcp:write"))):
    """删除指定 MCP 服务器的 OAuth 令牌和客户端信息。"""
    settings = get_effective_settings(current_user.id)
    if server_name not in settings.mcp_servers:
        raise HTTPException(status_code=404, detail=f"MCP server '{server_name}' not found")

    try:
        from app.deps import get_mcp_manager_for_user
        manager = get_mcp_manager_for_user(current_user.id)
        await run_in_threadpool(manager.clear_oauth_credentials_sync, server_name)
    except Exception:
        pass

    return {"status": "ok", "message": f"OAuth tokens for '{server_name}' cleared"}


@router.get("/{server_name}/tools", response_model=MCPServerToolsResponse)
async def get_mcp_server_tools(server_name: str, current_user: CurrentUser = Depends(require_permissions("mcp:read"))):
    """获取指定 MCP 服务器的工具列表。"""
    settings = get_effective_settings(current_user.id)
    if server_name not in settings.mcp_servers:
        raise HTTPException(status_code=404, detail=f"MCP server '{server_name}' not found")

    tools: list[MCPToolInfo] = []
    manager = None
    try:
        from app.deps import get_mcp_manager_for_user
        manager = get_mcp_manager_for_user(current_user.id)
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
