"""行情服务与工具共用的完整结果模型；API 可使用较窄的展示模型。"""

from pydantic import Field

from app.schemas.base import AppModel as BaseModel
from app.schemas.market import CandlestickItem, IntradayItem


class SecurityStaticInfo(BaseModel):
    symbol: str
    name: str
    name_cn: str = ""
    name_en: str = ""
    name_hk: str = ""
    exchange: str = ""
    currency: str = ""
    lot_size: str = ""
    board: str = ""
    security_type: str = ""


class SessionQuote(BaseModel):
    timestamp: int | None
    last_done: str | None
    prev_close: str | None
    high: str | None
    low: str | None
    volume: str | None
    turnover: str | None
    change_value: str | None
    change_rate: str | None


class RealtimeQuote(SessionQuote):
    symbol: str
    open: str | None
    trade_status: str | None
    pre_market_quote: SessionQuote | None
    post_market_quote: SessionQuote | None
    overnight_quote: SessionQuote | None


class RealtimeQuotes(BaseModel):
    source: str
    symbols: list[str] = Field(default_factory=list)
    quotes: list[RealtimeQuote]
    total: int


class Candle(CandlestickItem):
    trade_session: str | None = None


class Candlesticks(BaseModel):
    source: str
    symbol: str
    period: str
    adjust_type: str
    trade_sessions: str | None
    bars: list[Candle]


class HistoryCandlesticks(Candlesticks):
    start: str | None
    end: str | None


class Intraday(BaseModel):
    source: str
    symbol: str
    trade_sessions: str | None
    prev_close: str | None
    bars: list[IntradayItem]


class Trade(BaseModel):
    timestamp: int | None
    price: str | None
    volume: str | None
    direction: str | None
    trade_type: str | None
    trade_session: str | None


class Trades(BaseModel):
    source: str
    symbol: str
    trades: list[Trade]
    total: int


class DepthLevel(BaseModel):
    position: str | None
    price: str | None
    volume: str | None
    order_num: str | None


class Depth(BaseModel):
    source: str
    symbol: str
    bids: list[DepthLevel]
    asks: list[DepthLevel]


class MarketTime(BaseModel):
    market: str | None
    trade_status: str | None
    timestamp: int | None
    delay_trade_status: str | None
    delay_timestamp: int | None
    sub_status: str | None
    delay_sub_status: str | None


class MarketStatus(BaseModel):
    source: str
    market_time: list[MarketTime]
    total: int


class TradingDays(BaseModel):
    source: str
    market: str
    begin: str
    end: str
    trading_days: list[str | None]
    half_trading_days: list[str | None]


class QuoteIndicators(BaseModel):
    source: str
    symbols: list[str] = Field(default_factory=list)
    requested_indexes: list[str] = Field(default_factory=list)
    # SDK 返回的指标由请求指定，字段集合随 SDK 扩展，属于动态映射。
    indicators: list[dict[str, str | None]]
    total: int


class TechnicalCalculation(BaseModel):
    requested_indicators: list[str]
    available_indicators: list[str]
    params: dict[str, int | float | list[int]]
    bars_count: int
    latest_timestamp: int | None
    series_limit: int
    series_timestamps: list[int | None]
    latest: dict[str, dict[str, float | None]]
    series: dict[str, dict[str, list[float | None]]]


class TechnicalIndicators(TechnicalCalculation):
    source: str
    symbol: str
    period: str
    adjust_type: str
    trade_sessions: str | None
