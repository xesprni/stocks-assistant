"""调度系统 API Schema"""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class TaskCreateRequest(BaseModel):
    """创建定时任务请求"""
    name: str  # 任务名称
    prompt: str  # 任务提示词
    schedule: str  # 调度表达式（cron/间隔/"once"）
    enabled: bool = True  # 是否启用
    notify_telegram: bool = False  # 执行完成后是否发送 Telegram 消息
    metadata: Optional[Dict[str, Any]] = None  # 额外元数据


class TaskUpdateRequest(BaseModel):
    """更新定时任务请求"""
    name: Optional[str] = None  # 任务名称
    prompt: Optional[str] = None  # 任务提示词
    schedule: Optional[str] = None  # 调度表达式（cron/间隔/"once"）
    enabled: Optional[bool] = None  # 是否启用
    notify_telegram: Optional[bool] = None  # 执行完成后是否发送 Telegram 消息
    metadata: Optional[Dict[str, Any]] = None  # 额外元数据


class TaskResponse(BaseModel):
    """定时任务响应"""
    id: str  # 任务 ID
    name: str  # 任务名称
    prompt: str  # 任务提示词
    schedule: str  # 调度表达式
    enabled: bool  # 是否启用
    last_run: Optional[str] = None  # 上次执行时间
    next_run: Optional[str] = None  # 下次执行时间
    run_count: int = 0  # 已执行次数
    last_error: Optional[str] = None  # 上次执行错误
    metadata: Optional[Dict[str, Any]] = None  # 额外元数据


class TaskListResponse(BaseModel):
    """定时任务列表响应"""
    tasks: List[TaskResponse]  # 任务列表
    total: int  # 总数


class TaskRunResponse(BaseModel):
    """定时任务执行记录响应"""
    id: str
    task_id: str
    task_name: str = ""
    trigger: str = "schedule"
    status: str
    started_at: str
    ended_at: Optional[str] = None
    duration_ms: int = 0
    output_preview: str = ""
    error: Optional[str] = None


class TaskRunListResponse(BaseModel):
    """定时任务执行记录列表响应"""
    runs: List[TaskRunResponse]
    total: int
