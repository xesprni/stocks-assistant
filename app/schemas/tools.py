"""工具系统 API Schema"""

from typing import Any, Dict, List

from pydantic import BaseModel


class ToolInfo(BaseModel):
    """工具信息"""
    name: str  # 工具名称
    description: str  # 工具描述
    parameters: Dict[str, Any]  # 参数 JSON Schema


class ToolListResponse(BaseModel):
    """工具列表响应"""
    tools: List[ToolInfo]  # 工具列表
    total: int  # 总数


class ToolExecuteRequest(BaseModel):
    """工具执行请求"""
    arguments: Dict[str, Any] = {}  # 工具参数


class ToolExecuteResponse(BaseModel):
    """工具执行响应"""
    status: str  # 执行状态（success/error）
    result: Any  # 执行结果
    execution_time: float = 0.0  # 执行耗时（秒）
