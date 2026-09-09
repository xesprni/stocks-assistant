"""研究证据与引用协议。"""

from typing import Any

from pydantic import BaseModel, Field


class SourceReference(BaseModel):
    """可追溯的数据或文档来源。"""

    id: str
    source_type: str = "document"
    provider: str = ""
    title: str
    url: str | None = None
    published_at: str | None = None
    as_of: str | None = None
    fetched_at: str
    stale: bool = False
    symbol: str | None = None
    locator: str | None = None


class Evidence(BaseModel):
    """一段可用于支持研究结论的证据。"""

    id: str
    source: SourceReference
    excerpt: str | None = None
    data: dict[str, Any] = Field(default_factory=dict)


class ClaimCitation(BaseModel):
    """最终回答中的结论与证据之间的映射。"""

    claim_id: str
    claim: str = ""
    evidence_ids: list[str] = Field(default_factory=list)
    source_ids: list[str] = Field(default_factory=list)
