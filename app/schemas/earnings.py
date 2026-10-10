"""财报雷达的请求、数据适配和固定响应契约。"""

from datetime import date as Date
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import AliasChoices, Field, field_validator

from app.constants.earnings import (
    DEFAULT_RADAR_DAYS,
    MAX_RADAR_DAYS,
    MAX_RADAR_SYMBOL_LENGTH,
    MAX_RADAR_SYMBOLS,
    RADAR_OPTION_DATE_PATTERN,
    RADAR_SOURCE,
    RADAR_SYMBOL_PATTERN,
    RADAR_TIMEZONE,
)
from app.schemas.base import AppModel

EarningsTiming = Literal["before_open", "after_close", "unknown"]
RadarValuation = Literal["high", "above", "normal", "below", "unavailable"]
EarningsOptionStage = Literal["expiry", "chain", "quote"]


class EarningsCalendarValue(AppModel):
    value_type: str = Field(validation_alias=AliasChoices("value_type", "type"))
    value: str


class EarningsCalendarInfo(AppModel):
    """在 SDK 适配边界解析日历事件，不透传第三方扩展字段。"""

    symbol: str = Field(validation_alias=AliasChoices("symbol", "counter_id"))
    id: str = ""
    date: str = ""
    date_type: str = ""
    financial_market_time: str = ""
    counter_name: str = ""
    content: str = ""
    currency: str = ""
    data_kv: list[EarningsCalendarValue] = Field(default_factory=list)

    @field_validator("symbol")
    @classmethod
    def normalize_symbol(cls, value: str) -> str:
        # 原始 HTTP 还可能返回旧式 ST/US/AAPL，SDK 的 symbol 字段已转换。
        parts = value.strip().upper().split("/")
        if len(parts) == 3:
            return f"{parts[2]}.{parts[1]}"
        return value.strip().upper()

    @field_validator("date_type", "financial_market_time", "currency", mode="before")
    @classmethod
    def normalize_optional_text(cls, value: object) -> object:
        return "" if value is None else value


class EarningsCalendarGroup(AppModel):
    date: str
    count: int = 0
    infos: list[EarningsCalendarInfo]


class EarningsCalendarPage(AppModel):
    groups: list[EarningsCalendarGroup] = Field(validation_alias=AliasChoices("groups", "list"))
    next_date: str | None = None


class EarningsOptionContract(AppModel):
    """在期权链 HTTP 边界解析单合约；未知方向及调整合约留给配对层过滤。"""

    symbol: str
    expiry_date: Date
    strike_price: Decimal
    direction: str
    standard_attr: str

    @field_validator("expiry_date", mode="before")
    @classmethod
    def parse_expiry_date(cls, value: object) -> Date:
        if isinstance(value, Date):
            return value
        # 上游协议使用 YYYYMMDD，不能让 Pydantic 把数字字符串当作 Unix 时间戳。
        if not isinstance(value, str) or not RADAR_OPTION_DATE_PATTERN.fullmatch(value):
            raise ValueError("Option expiry_date must use YYYYMMDD")
        return Date.fromisoformat(value)


class EarningsOptionChain(AppModel):
    contracts: list[EarningsOptionContract] = Field(
        validation_alias=AliasChoices("contracts", "list")
    )


class EarningsRadarRequest(AppModel):
    symbols: list[Annotated[str, Field(min_length=1, max_length=MAX_RADAR_SYMBOL_LENGTH)]] = Field(
        min_length=1, max_length=MAX_RADAR_SYMBOLS
    )
    days_ahead: int = Field(default=DEFAULT_RADAR_DAYS, ge=1, le=MAX_RADAR_DAYS)

    @field_validator("symbols")
    @classmethod
    def normalize_symbols(cls, symbols: list[str]) -> list[str]:
        result = []
        for value in symbols:
            symbol = value.strip().upper()
            if not symbol.endswith(".US"):
                # 裸代码按美股处理；明确的其他市场后缀不能被悄悄改写。
                if symbol.endswith((".HK", ".SH", ".SZ", ".CN", ".SG")):
                    raise ValueError("Earnings radar currently supports US stocks only")
                symbol += ".US"
            if len(symbol) > MAX_RADAR_SYMBOL_LENGTH or not RADAR_SYMBOL_PATTERN.fullmatch(symbol):
                raise ValueError("Invalid US stock symbol")
            if symbol not in result:
                result.append(symbol)
        return result


class EarningsEvent(AppModel):
    date: Date
    timing: EarningsTiming = "unknown"
    period: str = ""
    eps_estimate: str | None = None
    revenue_estimate: str | None = None
    currency: str = ""
    reported: bool = False


class EarningsMove(AppModel):
    date: Date
    timing: EarningsTiming
    period: str
    before_date: Date
    after_date: Date
    before_close: str
    after_close: str
    move_pct: float


class EarningsHistoryEntry(AppModel):
    """保留最近事件及未参与统计的原因，不用更旧的可计算样本填补缺口。"""

    date: Date
    timing: EarningsTiming
    period: str
    move: EarningsMove | None = None
    exclusion_reason: Literal["unknown_timing", "missing_prices"] | None = None


class EarningsOptionDiagnostic(AppModel):
    stage: EarningsOptionStage
    reason: Literal[
        "no_expiry",
        "empty_chain",
        "incomplete_pair",
        "missing_quote",
        "permission_denied",
        "upstream_error",
        "request_failed",
    ]
    expiry: Date | None = None
    error_code: int | None = None


class EarningsOptionPricing(AppModel):
    expiry: Date
    primary_expiry: Date
    fallback: bool
    dte: int
    days_after_earnings: int
    strike: str
    call_symbol: str
    put_symbol: str
    call_price: str
    put_price: str
    call_timestamp: str | None
    put_timestamp: str | None
    straddle: str
    implied_move_pct: float
    iv_pct: float | None


class EarningsOptionScan(AppModel):
    pricing: EarningsOptionPricing | None = None
    diagnostics: list[EarningsOptionDiagnostic] = Field(default_factory=list)


class EarningsRadarItem(AppModel):
    symbol: str
    name: str = ""
    status: Literal["ready", "partial", "unavailable"] = "unavailable"
    spot: str | None = None
    spot_timestamp: str | None = None
    next_event: EarningsEvent | None = None
    option: EarningsOptionPricing | None = None
    history: list[EarningsMove] = Field(default_factory=list)
    history_events: list[EarningsHistoryEntry] = Field(default_factory=list)
    option_diagnostics: list[EarningsOptionDiagnostic] = Field(default_factory=list)
    sample_count: int = 0
    historical_median_pct: float | None = None
    hv30_pct: float | None = None
    ratio: float | None = None
    valuation: RadarValuation = "unavailable"
    issues: list[str] = Field(default_factory=list)


class EarningsRadarResponse(AppModel):
    source: str = RADAR_SOURCE
    timezone: str = RADAR_TIMEZONE
    as_of: str
    window_start: Date
    window_end: Date
    history_start: Date
    items: list[EarningsRadarItem]
