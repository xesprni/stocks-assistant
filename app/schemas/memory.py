"""记忆系统 API Schema"""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class MemorySearchRequest(BaseModel):
    """记忆搜索请求"""
    query: str  # 搜索查询
    user_id: Optional[str] = None  # 用户 ID
    limit: Optional[int] = None  # 最大结果数
    min_score: Optional[float] = None  # 最低相关度
    include_shared: bool = True  # 是否包含共享记忆


class MemorySearchResult(BaseModel):
    """记忆搜索结果"""
    path: str  # 文件路径
    start_line: int  # 起始行号
    end_line: int  # 结束行号
    score: float  # 相关度分数
    snippet: str  # 内容摘要
    source: str  # 来源标识
    user_id: Optional[str] = None  # 用户 ID


class MemoryAddRequest(BaseModel):
    """添加记忆请求"""
    content: str  # 记忆内容
    user_id: Optional[str] = None  # 用户 ID
    scope: str = "shared"  # 作用域：shared / user
    source: str = "memory"  # 来源标识
    path: Optional[str] = None  # 文件路径（自动生成）
    metadata: Optional[Dict[str, Any]] = None  # 额外元数据


class MemoryStatusResponse(BaseModel):
    """记忆系统状态"""
    chunks: int  # 索引块数
    files: int  # 已索引文件数
    workspace: str  # 工作空间路径
    dirty: bool  # 是否有待同步内容
    embedding_enabled: bool  # 是否启用向量搜索
    embedding_provider: str  # 向量化服务商
    embedding_model: str  # 向量化模型
    search_mode: str  # 搜索模式
