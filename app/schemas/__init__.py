"""Agent 对话相关 Schema

定义 Agent 聊天请求、响应和流式事件的数据模型。
"""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    """聊天请求"""
    message: str  # 用户消息
    user_id: Optional[str] = None  # 用户 ID
    clear_history: bool = False  # 是否清空历史记录
    skill_filter: Optional[List[str]] = None  # 技能过滤列表


class ChatResponse(BaseModel):
    """聊天响应"""
    response: str  # Agent 回复文本
    tool_calls: int = 0  # 工具调用次数
    steps: int = 0  # 执行步数


class StreamEvent(BaseModel):
    """SSE 流式事件"""
    type: str  # 事件类型
    timestamp: float  # 时间戳
    data: Optional[Dict[str, Any]] = None  # 事件数据
