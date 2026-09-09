"""Market dashboard API schemas."""

from pydantic import BaseModel, Field


class IndexConfig(BaseModel):
    """单个指数监控配置。"""

    symbol: str
    name: str
    enabled: bool = True


class MarketDashboardConfig(BaseModel):
    """行情监控仪表盘配置。"""

    indices: list[IndexConfig] = Field(default_factory=list)
    refresh_interval: int = Field(default=60, ge=1, le=3600)


class QuoteItem(BaseModel):
    """单条行情数据。"""

    symbol: str
    name: str = ""
    category: str = ""
    last_done: str | None = None
    prev_close: str | None = None
    open: str | None = None
    high: str | None = None
    low: str | None = None
    volume: str | None = None
    turnover: str | None = None
    change_value: str | None = None
    change_rate: str | None = None


class MarketQuotesResponse(BaseModel):
    """行情数据响应。"""

    quotes: list[QuoteItem]
    total: int


class CandlestickItem(BaseModel):
    """单根 K 线数据。"""

    timestamp: int
    open: str
    high: str
    low: str
    close: str
    volume: str
    turnover: str


class CandlesticksResponse(BaseModel):
    """K 线数据响应。"""

    symbol: str
    period: str
    bars: list[CandlestickItem]


class IntradayItem(BaseModel):
    """单条分时数据。"""

    timestamp: int
    price: str
    volume: str
    turnover: str
    avg_price: str


class IntradayResponse(BaseModel):
    """分时数据响应。"""

    symbol: str
    prev_close: str | None = None
    bars: list[IntradayItem]


class CapitalFlowItem(BaseModel):
    """单条资金流向时序数据。"""

    timestamp: int
    inflow: str


class CapitalFlowResponse(BaseModel):
    """资金流向时序响应。"""

    source: str = ""
    symbol: str
    lines: list[CapitalFlowItem]
    total: int = 0


class MarketTemperatureResponse(BaseModel):
    """市场温度响应。"""

    market: str
    temperature: int | None = None
    description: str = ""
    valuation: int | None = None
    sentiment: int | None = None
    updated_at: int | None = None
