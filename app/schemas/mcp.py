"""MCP 服务器状态 API Schema。"""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class MCPToolInfo(BaseModel):
    """MCP 工具信息。"""

    name: str
    description: str = ""
    parameters: Dict[str, Any] = {}


class MCPServerStatus(BaseModel):
    """MCP 服务器状态。"""

    name: str
    transport: str = "sse"
    url: str = ""
    command: str = ""
    args: List[str] = []
    headers: Dict[str, str] = {}
    status: str = "disconnected"  # connected | error | disconnected
    error: Optional[str] = None
    tools_count: int = 0


class MCPStatusResponse(BaseModel):
    """MCP 状态列表响应。"""

    servers: List[MCPServerStatus]
    total: int


class MCPServerToolsResponse(BaseModel):
    """MCP 服务器工具列表响应。"""

    server_name: str
    tools: List[MCPToolInfo]
    total: int
