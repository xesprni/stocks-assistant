"""Agent 对话相关 Schema

定义 Agent 聊天请求、响应和流式事件的数据模型。
"""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    """聊天请求"""
    message: str  # 用户消息
    session_id: Optional[str] = None  # 会话 ID；为空时创建新会话
    user_id: Optional[str] = None  # 用户 ID
    clear_history: bool = False  # 是否清空历史记录
    skill_filter: Optional[List[str]] = None  # 技能过滤列表
    history: Optional[List[Dict[str, str]]] = None  # 前端传入的对话历史 [{"role": "user"/"assistant", "content": "..."}]


class ChatResponse(BaseModel):
    """聊天响应"""
    response: str  # Agent 回复文本
    session_id: str  # 会话 ID
    message_id: Optional[str] = None  # 助手回复消息 ID
    tool_calls: int = 0  # 工具调用次数
    steps: int = 0  # 执行步数


class ChatSessionCreateRequest(BaseModel):
    """创建聊天会话请求"""
    title: Optional[str] = None
    user_id: Optional[str] = None


class ChatSessionUpdateRequest(BaseModel):
    """更新聊天会话请求"""
    title: str = Field(..., min_length=1, max_length=120)


class ChatSessionMessage(BaseModel):
    """聊天会话消息"""
    id: str
    session_id: str
    role: str
    content: str
    seq: int
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: str


class ChatSessionSummary(BaseModel):
    """聊天会话摘要"""
    id: str
    user_id: Optional[str] = None
    title: str
    created_at: str
    updated_at: str
    message_count: int = 0
    last_message: Optional[str] = None


class ChatSessionDetail(ChatSessionSummary):
    """聊天会话详情"""
    messages: List[ChatSessionMessage] = Field(default_factory=list)


class ChatSessionListResponse(BaseModel):
    """聊天会话列表响应"""
    sessions: List[ChatSessionSummary]
    total: int


class StreamEvent(BaseModel):
    """SSE 流式事件"""
    type: str  # 事件类型
    timestamp: float  # 时间戳
    data: Optional[Dict[str, Any]] = None  # 事件数据
