"""Agent 对话相关 Schema

定义 Agent 聊天请求、响应和流式事件的数据模型。
"""

from typing import Any

from pydantic import BaseModel, Field

from app.schemas.evidence import SourceReference


class ChatRequest(BaseModel):
    """聊天请求"""

    message: str  # 用户消息
    session_id: str | None = None  # 会话 ID；为空时创建新会话
    user_id: str | None = None  # 用户 ID
    clear_history: bool = False  # 是否清空历史记录
    thinking_enabled: bool = False  # 是否启用模型推理/思考模式
    skill_filter: list[str] | None = None  # 技能过滤列表
    history: list[dict[str, str]] | None = (
        None  # 前端传入的对话历史 [{"role": "user"/"assistant", "content": "..."}]
    )


class ChatResponse(BaseModel):
    """聊天响应"""

    response: str  # Agent 回复文本
    session_id: str  # 会话 ID
    message_id: str | None = None  # 助手回复消息 ID
    tool_calls: int = 0  # 工具调用次数
    steps: int = 0  # 执行步数
    sources: list[SourceReference] = Field(default_factory=list)


class ChatSessionCreateRequest(BaseModel):
    """创建聊天会话请求"""

    title: str | None = None
    user_id: str | None = None


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
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str


class ChatSessionSummary(BaseModel):
    """聊天会话摘要"""

    id: str
    user_id: str | None = None
    title: str
    created_at: str
    updated_at: str
    message_count: int = 0
    last_message: str | None = None


class ChatSessionDetail(ChatSessionSummary):
    """聊天会话详情"""

    messages: list[ChatSessionMessage] = Field(default_factory=list)


class ChatSessionListResponse(BaseModel):
    """聊天会话列表响应"""

    sessions: list[ChatSessionSummary]
    total: int


class StreamEvent(BaseModel):
    """SSE 流式事件"""

    type: str  # 事件类型
    timestamp: float  # 时间戳
    data: dict[str, Any] | None = None  # 事件数据
