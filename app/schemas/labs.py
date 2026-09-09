"""Portfolio、估值/同业与大中华市场实验室协议。"""

import math
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.portfolio import PortfolioMarket


class PortfolioCashFlow(BaseModel):
    date: datetime
    amount: float
    currency: str | None = Field(default=None, min_length=3, max_length=3)

    @field_validator("date")
    @classmethod
    def valid_date(cls, value: datetime) -> datetime:
        normalized = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
        if normalized > datetime.now(UTC):
            raise ValueError("cash-flow date cannot be in the future")
        return normalized

    @field_validator("amount")
    @classmethod
    def finite_amount(cls, value: float) -> float:
        if not math.isfinite(value) or value == 0:
            raise ValueError("cash-flow amount must be finite and non-zero")
        return value

    @field_validator("currency")
    @classmethod
    def normalize_currency(cls, value: str | None) -> str | None:
        return value.strip().upper() if value else None


class PortfolioLabRequest(BaseModel):
    markets: list[PortfolioMarket] = Field(default_factory=lambda: ["US", "A", "H"], min_length=1)
    benchmark_symbol: str = "SPY.US"
    lookback_days: int = Field(default=252, ge=30, le=1000)
    scenario_shocks: dict[str, float] = Field(default_factory=dict)
    target_weights: dict[str, float] = Field(default_factory=dict)
    cash_flows: list[PortfolioCashFlow] = Field(default_factory=list, max_length=5000)
    base_currency: str = Field(default="USD", min_length=3, max_length=3)
    fx_rates: dict[str, float] = Field(default_factory=dict)

    @field_validator("markets")
    @classmethod
    def unique_markets(cls, value):
        return list(dict.fromkeys(value))

    @field_validator("base_currency")
    @classmethod
    def normalize_base_currency(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not normalized.isalpha():
            raise ValueError("base_currency must be a three-letter currency code")
        return normalized

    @field_validator("scenario_shocks")
    @classmethod
    def valid_scenario_shocks(cls, value: dict[str, float]) -> dict[str, float]:
        for key, shock in value.items():
            if not key.strip() or not math.isfinite(shock) or shock < -1:
                raise ValueError("scenario shocks must be finite and cannot be below -100%")
        return value

    @field_validator("target_weights")
    @classmethod
    def valid_target_weights(cls, value: dict[str, float]) -> dict[str, float]:
        for key, weight in value.items():
            if not key.strip() or not math.isfinite(weight) or weight < 0 or weight > 1:
                raise ValueError("target weights must be finite values between 0 and 1")
        if sum(value.values()) > 1.000001:
            raise ValueError("target weights cannot sum to more than 1")
        return value

    @field_validator("fx_rates")
    @classmethod
    def valid_fx_rates(cls, value: dict[str, float]) -> dict[str, float]:
        normalized: dict[str, float] = {}
        for currency, rate in value.items():
            key = currency.strip().upper()
            if len(key) != 3 or not key.isalpha() or not math.isfinite(rate) or rate <= 0:
                raise ValueError(
                    "FX rates must map three-letter currencies to finite positive rates"
                )
            normalized[key] = rate
        return normalized

    @model_validator(mode="after")
    def base_rate_is_one(self):
        if self.base_currency in self.fx_rates and not math.isclose(
            self.fx_rates[self.base_currency], 1.0
        ):
            raise ValueError("base currency FX rate must equal 1")
        return self


class ValuationModelCreate(BaseModel):
    model_id: str | None = None
    model_type: Literal["dcf", "reverse_dcf", "relative"] = "dcf"
    title: str = Field(min_length=1, max_length=200)
    assumptions: dict[str, Any] = Field(default_factory=dict)
    peer_symbols: list[str] = Field(default_factory=list, max_length=50)
    source_ids: list[str] = Field(default_factory=list, max_length=100)
    thesis_snapshot_id: str | None = None
    reason: str = Field(default="", max_length=1000)


class ValuationModelResponse(BaseModel):
    id: str
    model_key: str
    symbol: str
    version: int
    model_type: str
    title: str
    assumptions: dict[str, Any]
    peer_symbols: list[str]
    result: dict[str, Any]
    source_ids: list[str]
    thesis_snapshot_id: str | None = None
    reason: str = ""
    created_at: str


class PeerComparisonRequest(BaseModel):
    symbols: list[str] = Field(min_length=2, max_length=30)
    metrics: list[str] = Field(
        default_factory=lambda: ["pe_ttm_ratio", "pb_ratio", "ps_ttm_ratio"],
        min_length=1,
        max_length=20,
    )

    @field_validator("symbols")
    @classmethod
    def unique_symbols(cls, value: list[str]) -> list[str]:
        normalized = list(dict.fromkeys(item.strip().upper() for item in value if item.strip()))
        if len(normalized) < 2:
            raise ValueError("at least two distinct symbols are required")
        return normalized

    @field_validator("metrics")
    @classmethod
    def unique_metrics(cls, value: list[str]) -> list[str]:
        normalized = list(dict.fromkeys(item.strip() for item in value if item.strip()))
        if not normalized or any(len(item) > 80 for item in normalized):
            raise ValueError("metrics must contain short non-empty names")
        return normalized


class GreaterChinaRequest(BaseModel):
    symbol: str = Field(min_length=1, max_length=40)
    paired_symbol: str | None = Field(default=None, max_length=40)
    china_related_us_listing: bool = False


LabKind = Literal["portfolio", "valuation", "greater_china"]


class LabAIRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lab: LabKind
    objective: str = Field(min_length=1, max_length=4000)
    symbols: list[str] = Field(default_factory=list, max_length=10)
    locale: Literal["zh-CN", "en-US"] = "zh-CN"

    @field_validator("objective")
    @classmethod
    def nonempty_objective(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("objective is required")
        return value.strip()

    @field_validator("symbols")
    @classmethod
    def canonical_symbols(cls, value: list[str]) -> list[str]:
        from app.core.research.service import ResearchService

        return list(dict.fromkeys(ResearchService.normalize_symbol(symbol) for symbol in value))


class LabAIArtifact(BaseModel):
    id: str
    kind: str
    title: str
    data: dict[str, Any]
    created_at: str


class LabAIRun(BaseModel):
    id: str
    lab: LabKind
    title: str
    objective: str
    symbols: list[str]
    status: Literal["running", "completed", "failed", "canceled"]
    report: str = ""
    artifacts: list[LabAIArtifact] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    steps: int = 0
    created_at: str
    completed_at: str | None = None
    error: str | None = None


class LabDataRequest(BaseModel):
    """AI 只能提供查询条件，身份与配置始终由后端绑定。"""

    model_config = ConfigDict(extra="forbid")
    action: Literal[
        "portfolio",
        "financial_reports",
        "security_insights",
        "quotes",
        "peers",
        "greater_china",
        "valuation_models",
    ]
    symbol: str = Field(default="", max_length=40)
    symbols: list[str] = Field(default_factory=list, max_length=10)
    market: PortfolioMarket = "US"
    benchmark_symbol: str = Field(default="SPY.US", min_length=1, max_length=40)
    lookback_days: int = Field(default=252, ge=30, le=500)
    paired_symbol: str | None = Field(default=None, max_length=40)
    china_related_us_listing: bool = False
    scenario_shocks: dict[str, float] = Field(default_factory=dict, max_length=100)
    scenario_note: str = Field(
        default="",
        max_length=1000,
        description="Describe these hypothetical stress assumptions; they are not a market forecast",
    )

    @model_validator(mode="after")
    def validate_scenario(self):
        PortfolioLabRequest.valid_scenario_shocks(self.scenario_shocks)
        if self.scenario_shocks and not self.scenario_note.strip():
            raise ValueError("Stress scenarios require an explicit assumption note")
        if any(abs(value) > 5 for value in self.scenario_shocks.values()):
            raise ValueError("Stress shocks must be decimal fractions between -1 and 5")
        return self


class LabValuationEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["source", "assumption"]
    note: str = Field(min_length=1, max_length=1000)
    artifact_id: str | None = None
    path: str | None = Field(
        default=None,
        max_length=500,
        description="JSON Pointer into the source artifact's data, e.g. /statements/0/rows/0/values/0/value",
    )
    scale: float = Field(
        default=1,
        description="Explicit unit conversion only: 1, 1000, 1e6, 1e9 or their reciprocals",
    )
    denominator_artifact_id: str | None = None
    denominator_path: str | None = Field(default=None, max_length=500)


class LabAIValuationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    symbol: str = Field(min_length=1, max_length=40)
    title: str = Field(min_length=1, max_length=200)
    model_type: Literal["dcf", "reverse_dcf", "relative"] = "dcf"
    currency: str = Field(min_length=3, max_length=3)
    assumptions: dict[str, Any]
    evidence: dict[str, LabValuationEvidence]
    peer_symbols: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("peer_symbols")
    @classmethod
    def valid_peers(cls, value: list[str]) -> list[str]:
        return LabAIRequest.canonical_symbols(value)

    @field_validator("currency")
    @classmethod
    def valid_currency(cls, value: str) -> str:
        normalized = value.upper()
        if not normalized.isascii() or not normalized.isalpha():
            raise ValueError("currency must be a three-letter currency code")
        return normalized
