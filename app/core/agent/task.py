"""任务定义

定义了任务（Task）的完整生命周期数据结构，
支持多种内容类型（文本、图片、视频、音频、文件）。
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List


class TaskType(Enum):
    """任务内容类型"""
    TEXT = "text"      # 纯文本
    IMAGE = "image"    # 图片
    VIDEO = "video"    # 视频
    AUDIO = "audio"    # 音频
    FILE = "file"      # 文件
    MIXED = "mixed"    # 混合类型


class TaskStatus(Enum):
    """任务状态"""
    INIT = "init"              # 初始化
    PROCESSING = "processing"  # 处理中
    COMPLETED = "completed"    # 已完成
    FAILED = "failed"          # 已失败


@dataclass
class Task:
    """任务数据结构

    封装了 Agent 需要处理的一次请求，包含内容、类型、状态和附件信息。
    """
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    content: str = ""  # 任务文本内容
    type: TaskType = TaskType.TEXT  # 内容类型
    status: TaskStatus = TaskStatus.INIT  # 当前状态
    created_at: float = field(default_factory=time.time)  # 创建时间
    updated_at: float = field(default_factory=time.time)  # 更新时间
    metadata: Dict[str, Any] = field(default_factory=dict)  # 额外元数据
    images: List[str] = field(default_factory=list)  # 图片附件列表
    videos: List[str] = field(default_factory=list)  # 视频附件列表
    audios: List[str] = field(default_factory=list)  # 音频附件列表
    files: List[str] = field(default_factory=list)  # 文件附件列表

    def __init__(self, content: str = "", **kwargs):
        self.id = kwargs.get("id", str(uuid.uuid4()))
        self.content = content
        self.type = kwargs.get("type", TaskType.TEXT)
        self.status = kwargs.get("status", TaskStatus.INIT)
        self.created_at = kwargs.get("created_at", time.time())
        self.updated_at = kwargs.get("updated_at", time.time())
        self.metadata = kwargs.get("metadata", {})
        self.images = kwargs.get("images", [])
        self.videos = kwargs.get("videos", [])
        self.audios = kwargs.get("audios", [])
        self.files = kwargs.get("files", [])

    def update_status(self, status: TaskStatus) -> None:
        """更新任务状态"""
        self.status = status
        self.updated_at = time.time()
