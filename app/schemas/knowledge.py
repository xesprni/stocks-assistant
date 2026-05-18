"""知识库 API Schema"""

from typing import List, Optional

from pydantic import BaseModel


class KnowledgeTreeNode(BaseModel):
    """知识库目录树节点"""
    name: str  # 文件/目录名
    path: str  # 路径
    type: str  # 类型：file / dir
    children: Optional[List["KnowledgeTreeNode"]] = None  # 子节点


class KnowledgeTreeResponse(BaseModel):
    """知识库目录树响应"""
    tree: List[KnowledgeTreeNode]


class KnowledgeFileResponse(BaseModel):
    """知识文件内容响应"""
    path: str  # 文件路径
    content: str  # 文件内容
    size: int  # 文件大小


class KnowledgeGraphNode(BaseModel):
    """知识图谱节点"""
    id: str  # 节点 ID（文件相对路径）
    label: str  # 节点标签（标题）
    type: str  # 节点类型


class KnowledgeGraphEdge(BaseModel):
    """知识图谱边（Markdown 内部链接）"""
    source: str  # 源节点
    target: str  # 目标节点
    label: Optional[str] = None  # 链接文本


class KnowledgeGraphResponse(BaseModel):
    """知识图谱响应"""
    nodes: List[KnowledgeGraphNode]  # 节点列表
    edges: List[KnowledgeGraphEdge]  # 边列表
