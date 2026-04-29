"""调度系统 API Schema"""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class TaskCreateRequest(BaseModel):
    """创建定时任务请求"""
    name: str  # 任务名称
    prompt: str  # 任务提示词
    schedule: str  # 调度表达式（cron/间隔/"once"）
    enabled: bool = True  # 是否启用
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
    metadata: Optional[Dict[str, Any]] = None  # 额外元数据


class TaskListResponse(BaseModel):
    """定时任务列表响应"""
    tasks: List[TaskResponse]  # 任务列表
    total: int  # 总数
