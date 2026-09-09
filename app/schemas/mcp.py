"""MCP 服务器状态 API Schema。"""

from typing import Any

from pydantic import BaseModel, Field


class MCPToolInfo(BaseModel):
    """MCP 工具信息。"""

    name: str
    description: str = ""
    parameters: dict[str, Any] = Field(default_factory=dict)


class MCPServerStatus(BaseModel):
    """MCP 服务器状态。"""

    name: str
    transport: str = "streamable_http"
    url: str = ""
    command: str = ""
    args: list[str] = Field(default_factory=list)
    headers: dict[str, str] = Field(default_factory=dict)
    enabled: bool = True
    status: str = (
        "disconnected"  # connecting | auth_required | connected | error | disconnected | disabled
    )
    error: str | None = None
    tools_count: int = 0
    oauth_authorization_url: str | None = None
    oauth_enabled: bool = False  # 配置中是否需要 OAuth 授权码流程


class MCPStatusResponse(BaseModel):
    """MCP 状态列表响应。"""

    servers: list[MCPServerStatus]
    total: int


class MCPOAuthAuthorizeResponse(BaseModel):
    """MCP OAuth 授权 URL 响应。"""

    authorization_url: str


class MCPServerToolsResponse(BaseModel):
    """MCP 服务器工具列表响应。"""

    server_name: str
    tools: list[MCPToolInfo]
    total: int
