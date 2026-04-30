"""Market dashboard API schemas."""

from typing import List, Optional

from pydantic import BaseModel, Field


class IndexConfig(BaseModel):
    """单个指数监控配置。"""

    symbol: str
    name: str
    enabled: bool = True


class MarketDashboardConfig(BaseModel):
    """行情监控仪表盘配置。"""

    indices: List[IndexConfig] = Field(default_factory=list)
    refresh_interval: int = Field(default=60, ge=10, le=3600)


class QuoteItem(BaseModel):
    """单条行情数据。"""

    symbol: str
    name: str = ""
    category: str = ""
    last_done: Optional[str] = None
    prev_close: Optional[str] = None
    open: Optional[str] = None
    high: Optional[str] = None
    low: Optional[str] = None
    volume: Optional[str] = None
    turnover: Optional[str] = None
    change_value: Optional[str] = None
    change_rate: Optional[str] = None


class MarketQuotesResponse(BaseModel):
    """行情数据响应。"""

    quotes: List[QuoteItem]
    total: int
