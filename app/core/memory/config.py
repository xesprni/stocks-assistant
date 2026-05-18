"""记忆系统配置

定义记忆相关的所有配置项，包括：
- 工作空间路径
- 向量化模型参数
- 分块参数
- 混合搜索权重（向量搜索 + 关键词搜索）
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import List


@dataclass
class MemoryConfig:
    """记忆系统配置"""
    workspace_root: str = "~/stocks-assistant"  # 工作空间根目录
    embedding_provider: str = "openai"  # 向量化服务商标识
    embedding_model: str = "text-embedding-3-small"  # 向量化模型名称
    embedding_dim: int = 1536  # 向量维度
    chunk_max_tokens: int = 500  # 单个文本块最大 token 数
    chunk_overlap_tokens: int = 50  # 相邻块重叠 token 数
    max_results: int = 10  # 搜索最大返回结果数
    min_score: float = 0.1  # 搜索最低相关度阈值
    vector_weight: float = 0.7  # 向量搜索权重
    keyword_weight: float = 0.3  # 关键词搜索权重
    sources: List[str] = field(default_factory=lambda: ["memory", "session"])  # 记忆来源
    enable_auto_sync: bool = True  # 是否启用自动同步
    sync_on_search: bool = True  # 搜索前是否自动同步

    def get_workspace(self) -> Path:
        """获取工作空间路径"""
        return Path(self.workspace_root).expanduser()

    def get_memory_dir(self) -> Path:
        """获取记忆文件目录"""
        return self.get_workspace() / "memory"

    def get_db_path(self) -> Path:
        """获取 SQLite 索引数据库路径"""
        index_dir = self.get_memory_dir() / "long-term"
        index_dir.mkdir(parents=True, exist_ok=True)
        return index_dir / "index.db"
