"""公司研究工作区、Thesis、材料与提醒的数据协议。"""

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator


DocumentType = Literal["note", "pdf", "filing", "transcript", "slides", "article"]
AlertConditionType = Literal[
    "price", "volume", "valuation", "kpi", "technical", "news", "filing", "keyword", "rating", "corporate_action", "portfolio_risk"
]
AlertSeverity = Literal["info", "low", "medium", "high", "critical"]


class ThesisPayload(BaseModel):
    business_model: str = ""
    key_drivers: list[str] = Field(default_factory=list)
    kpis: list[dict[str, Any]] = Field(default_factory=list)
    bull_case: str = ""
    base_case: str = ""
    bear_case: str = ""
    valuation_assumptions: dict[str, Any] = Field(default_factory=dict)
    expected_range: dict[str, Any] = Field(default_factory=dict)
    catalysts: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    invalidation_conditions: list[str] = Field(default_factory=list)
    confidence: float = Field(default=0.5, ge=0, le=1)
    time_horizon: str = ""
    next_review_at: Optional[str] = None


class ThesisSnapshotCreate(BaseModel):
    payload: ThesisPayload
    reason: str = Field(min_length=1, max_length=1000)
    source_ids: list[str] = Field(default_factory=list, max_length=100)


class ThesisSnapshotResponse(BaseModel):
    id: str
    symbol: str
    version: int
    payload: ThesisPayload
    change_summary: dict[str, Any] = Field(default_factory=dict)
    reason: str
    source_ids: list[str] = Field(default_factory=list)
    created_at: str


class DecisionCreate(BaseModel):
    action: str = Field(min_length=1, max_length=120)
    rationale: str = Field(min_length=1, max_length=10000)
    evidence_ids: list[str] = Field(default_factory=list, max_length=100)
    thesis_snapshot_id: Optional[str] = None
    outcome: str = Field(default="", max_length=10000)


class DecisionUpdate(BaseModel):
    outcome: str = Field(max_length=10000)


class DecisionResponse(BaseModel):
    id: str
    symbol: str
    action: str
    rationale: str
    evidence_ids: list[str] = Field(default_factory=list)
    thesis_snapshot_id: Optional[str] = None
    outcome: str = ""
    created_at: str
    reviewed_at: Optional[str] = None


class ResearchEvidenceCreate(BaseModel):
    source_id: str = Field(min_length=1, max_length=200)
    source: dict[str, Any]
    relation: Literal["supports", "weakens", "neutral"] = "neutral"
    note: str = Field(default="", max_length=2000)


class ResearchEvidenceResponse(BaseModel):
    id: str
    symbol: str
    source_id: str
    source: dict[str, Any]
    relation: str
    note: str
    created_at: str


class ResearchDocumentCreate(BaseModel):
    document_id: Optional[str] = None
    title: str = Field(min_length=1, max_length=300)
    document_type: DocumentType = "note"
    content: str = Field(min_length=1, max_length=5_000_000)
    source_url: Optional[str] = Field(default=None, max_length=2000)
    published_at: Optional[str] = None
    page_texts: list[str] = Field(default_factory=list, max_length=2000)

    @field_validator("source_url")
    @classmethod
    def validate_source_url(cls, value):
        if value and not value.startswith(("http://", "https://")):
            raise ValueError("source_url must be an absolute HTTP(S) URL")
        return value


class ResearchDocumentVersionResponse(BaseModel):
    id: str
    document_id: str
    version: int
    published_at: Optional[str] = None
    content_hash: str
    content: Optional[str] = None
    locator: dict[str, Any] = Field(default_factory=dict)
    change_summary: dict[str, Any] = Field(default_factory=dict)
    fetched_at: str
    created_at: str


class ResearchDocumentResponse(BaseModel):
    id: str
    symbol: str
    title: str
    document_type: DocumentType
    source_url: Optional[str] = None
    latest_version: int = 0
    created_at: str
    updated_at: str
    versions: list[ResearchDocumentVersionResponse] = Field(default_factory=list)


class AlertRuleCreate(BaseModel):
    symbol: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=200)
    condition_type: AlertConditionType
    operator: Literal["gt", "gte", "lt", "lte", "eq", "contains", "changed"] = "gt"
    threshold: Any = None
    severity: AlertSeverity = "medium"
    thesis_snapshot_id: Optional[str] = None
    enabled: bool = True
    channels: list[Literal["in_app", "telegram"]] = Field(default_factory=lambda: ["in_app"])
    evaluation_interval_seconds: int = Field(default=300, ge=30, le=86400)
    metadata: dict[str, Any] = Field(default_factory=dict)


class AlertRuleUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    operator: Optional[Literal["gt", "gte", "lt", "lte", "eq", "contains", "changed"]] = None
    threshold: Any = None
    severity: Optional[AlertSeverity] = None
    thesis_snapshot_id: Optional[str] = None
    enabled: Optional[bool] = None
    channels: Optional[list[Literal["in_app", "telegram"]]] = None
    evaluation_interval_seconds: Optional[int] = Field(default=None, ge=30, le=86400)
    metadata: Optional[dict[str, Any]] = None


class AlertRuleResponse(BaseModel):
    id: str
    symbol: str
    name: str
    condition_type: AlertConditionType
    operator: str
    threshold: Any = None
    severity: AlertSeverity
    thesis_snapshot_id: Optional[str] = None
    enabled: bool
    channels: list[str] = Field(default_factory=list)
    evaluation_interval_seconds: int
    metadata: dict[str, Any] = Field(default_factory=dict)
    last_evaluated_at: Optional[str] = None
    next_evaluation_at: Optional[str] = None
    last_error: Optional[str] = None
    created_at: str
    updated_at: str


class AlertEvaluationRequest(BaseModel):
    observed_value: Any = None
    observed_at: Optional[datetime] = None
    event_key: Optional[str] = Field(default=None, max_length=500)
    title: Optional[str] = Field(default=None, max_length=500)
    source: dict[str, Any] = Field(default_factory=dict)


class AlertEventResponse(BaseModel):
    id: str
    rule_id: str
    symbol: str
    fingerprint: str
    severity: AlertSeverity
    title: str
    explanation: str
    source: dict[str, Any] = Field(default_factory=dict)
    portfolio_context: dict[str, Any] = Field(default_factory=dict)
    thesis_context: dict[str, Any] = Field(default_factory=dict)
    status: Literal["unread", "read", "dismissed"] = "unread"
    delivery_status: str = "not_requested"
    retry_count: int = 0
    last_error: Optional[str] = None
    occurred_at: str
    created_at: str
    read_at: Optional[str] = None


class SecurityWorkspaceSummary(BaseModel):
    symbol: str
    watchlisted: bool = False
    position: Optional[dict[str, Any]] = None
    latest_thesis: Optional[ThesisSnapshotResponse] = None
    thesis_versions: int = 0
    documents: int = 0
    unread_alerts: int = 0
    alert_rules: int = 0
    latest_decisions: list[DecisionResponse] = Field(default_factory=list)
    evidence_count: int = 0
