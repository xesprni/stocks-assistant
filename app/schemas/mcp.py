"""MCP 服务器状态 API Schema。"""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class MCPToolInfo(BaseModel):
    """MCP 工具信息。"""

    name: str
    description: str = ""
    parameters: Dict[str, Any] = Field(default_factory=dict)


class MCPServerStatus(BaseModel):
    """MCP 服务器状态。"""

    name: str
    transport: str = "streamable_http"
    url: str = ""
    command: str = ""
    args: List[str] = Field(default_factory=list)
    headers: Dict[str, str] = Field(default_factory=dict)
    status: str = "disconnected"  # connecting | auth_required | connected | error | disconnected
    error: Optional[str] = None
    tools_count: int = 0
    oauth_authorization_url: Optional[str] = None
    oauth_enabled: bool = False  # 配置中是否需要 OAuth 授权码流程


class MCPStatusResponse(BaseModel):
    """MCP 状态列表响应。"""

    servers: List[MCPServerStatus]
    total: int


class MCPServerToolsResponse(BaseModel):
    """MCP 服务器工具列表响应。"""

    server_name: str
    tools: List[MCPToolInfo]
    total: int
