"""调度系统 API Schema"""

from typing import Any

from pydantic import BaseModel

from app.schemas.notifications import TelegramPhotos


class TaskCreateRequest(BaseModel):
    """创建定时任务请求"""

    name: str  # 任务名称
    prompt: str  # 任务提示词
    schedule: str  # 调度表达式（cron/间隔/"once"）
    enabled: bool = True  # 是否启用
    notify_telegram: bool = False  # 执行完成后是否发送 Telegram 消息
    telegram_photos: TelegramPhotos | None = None  # 图片 URL 或用户工作空间内路径
    metadata: dict[str, Any] | None = None  # 额外元数据


class TaskUpdateRequest(BaseModel):
    """更新定时任务请求"""

    name: str | None = None  # 任务名称
    prompt: str | None = None  # 任务提示词
    schedule: str | None = None  # 调度表达式（cron/间隔/"once"）
    enabled: bool | None = None  # 是否启用
    notify_telegram: bool | None = None  # 执行完成后是否发送 Telegram 消息
    telegram_photos: TelegramPhotos | None = None  # 空列表清除图片，省略则保留
    metadata: dict[str, Any] | None = None  # 额外元数据


class TaskResponse(BaseModel):
    """定时任务响应"""

    id: str  # 任务 ID
    name: str  # 任务名称
    prompt: str  # 任务提示词
    schedule: str  # 调度表达式
    enabled: bool  # 是否启用
    last_run: str | None = None  # 上次执行时间
    next_run: str | None = None  # 下次执行时间
    run_count: int = 0  # 已执行次数
    last_error: str | None = None  # 上次执行错误
    metadata: dict[str, Any] | None = None  # 额外元数据


class TaskListResponse(BaseModel):
    """定时任务列表响应"""

    tasks: list[TaskResponse]  # 任务列表
    total: int  # 总数


class TaskRunResponse(BaseModel):
    """定时任务执行记录响应"""

    id: str
    task_id: str
    task_name: str = ""
    trigger: str = "schedule"
    status: str
    started_at: str
    ended_at: str | None = None
    duration_ms: int = 0
    output_preview: str = ""
    error: str | None = None


class TaskRunListResponse(BaseModel):
    """定时任务执行记录列表响应"""

    runs: list[TaskRunResponse]
    total: int
