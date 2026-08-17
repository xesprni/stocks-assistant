"""Portfolio、估值/同业与大中华市场实验室协议。"""

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from app.schemas.portfolio import PortfolioMarket


class PortfolioLabRequest(BaseModel):
    markets: list[PortfolioMarket] = Field(default_factory=lambda: ["US", "A", "H"], min_length=1)
    benchmark_symbol: str = "SPY.US"
    lookback_days: int = Field(default=252, ge=30, le=1000)
    scenario_shocks: dict[str, float] = Field(default_factory=dict)
    target_weights: dict[str, float] = Field(default_factory=dict)

    @field_validator("markets")
    @classmethod
    def unique_markets(cls, value):
        return list(dict.fromkeys(value))


class ValuationModelCreate(BaseModel):
    model_id: Optional[str] = None
    model_type: Literal["dcf", "reverse_dcf", "relative"] = "dcf"
    title: str = Field(min_length=1, max_length=200)
    assumptions: dict[str, Any] = Field(default_factory=dict)
    peer_symbols: list[str] = Field(default_factory=list, max_length=50)
    source_ids: list[str] = Field(default_factory=list, max_length=100)
    thesis_snapshot_id: Optional[str] = None
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
    thesis_snapshot_id: Optional[str] = None
    reason: str = ""
    created_at: str


class PeerComparisonRequest(BaseModel):
    symbols: list[str] = Field(min_length=2, max_length=30)
    metrics: list[str] = Field(default_factory=lambda: ["pe_ttm_ratio", "pb_ratio", "ps_ttm_ratio", "market_cap"])


class GreaterChinaRequest(BaseModel):
    symbol: str = Field(min_length=1, max_length=40)
    paired_symbol: Optional[str] = Field(default=None, max_length=40)
    china_related_us_listing: bool = False

