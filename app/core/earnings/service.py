"""组合共享长桥连接、市场服务和纯计算，保留每个数据板块的缺失状态。"""

import logging
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from statistics import median
from typing import Any
from zoneinfo import ZoneInfo

from app.constants.earnings import (
    RADAR_AFTER_CODES,
    RADAR_AFTER_LABELS,
    RADAR_BEFORE_CODES,
    RADAR_BEFORE_LABELS,
    RADAR_CALENDAR_CHUNK_DAYS,
    RADAR_CALENDAR_FAILURE_LIMIT,
    RADAR_EXPIRY_PROBES,
    RADAR_HISTORY_DAYS,
    RADAR_HISTORY_SAMPLES,
    RADAR_MISSING_VALUES,
    RADAR_PERCENT,
    RADAR_STALE_QUOTE_DAYS,
    RADAR_TIMEZONE,
)
from app.core.earnings.calculations import (
    DailyClose,
    historical_volatility,
    positive_decimal,
    ratio_valuation,
    realized_moves,
)
from app.core.market.errors import (
    LongbridgeUnavailableError,
    longbridge_error_code,
    raise_if_token_expired,
)
from app.core.market.longbridge_context import get_cached_context
from app.core.market.service import MarketService
from app.schemas.earnings import (
    EarningsEvent,
    EarningsOptionPricing,
    EarningsRadarItem,
    EarningsRadarRequest,
    EarningsRadarResponse,
    EarningsTiming,
)

logger = logging.getLogger("stocks-assistant.earnings")


def _event_date(value: str) -> date | None:
    try:
        return date.fromisoformat(value.strip().replace(".", "-")[:10])
    except ValueError:
        return None


def _timing(value: str) -> EarningsTiming:
    # 长桥独立字段使用 before/after，英文展示标签则为 Pre/Post，不能只匹配长文案。
    label = " ".join(value.strip().lower().replace("_", " ").replace("-", " ").split())
    if label in RADAR_BEFORE_CODES or any(part in label for part in RADAR_BEFORE_LABELS):
        return "before_open"
    if label in RADAR_AFTER_CODES or any(part in label for part in RADAR_AFTER_LABELS):
        return "after_close"
    return "unknown"


def _present(value: str) -> bool:
    return value.strip().lower() not in RADAR_MISSING_VALUES


def _timestamp(value: Any) -> str | None:
    if isinstance(value, datetime):
        return value.isoformat() if value.tzinfo else value.replace(tzinfo=UTC).isoformat()
    return None


def _stale(timestamp: str | None, now: datetime) -> bool:
    return timestamp is None or now - datetime.fromisoformat(timestamp) > timedelta(
        days=RADAR_STALE_QUOTE_DAYS
    )


class EarningsRadarService:
    def __init__(self, market_service: MarketService):
        self.market = market_service

    def scan(self, request: EarningsRadarRequest, settings: Any = None) -> EarningsRadarResponse:
        now = datetime.now(UTC)
        today = now.astimezone(ZoneInfo(RADAR_TIMEZONE)).date()
        start = today - timedelta(days=RADAR_HISTORY_DAYS)
        end = today + timedelta(days=request.days_ahead)
        # 凭据与内容语言隔离沿用共享 Context；不创建第二条行情长连接。
        try:
            calendar = get_cached_context("CalendarContext", settings=settings)
            quote = get_cached_context("QuoteContext", settings=settings)
        except Exception as exc:
            raise_if_token_expired(exc)
            raise LongbridgeUnavailableError("Longbridge connection unavailable") from exc
        events, names, calendar_issues = self._calendar(
            calendar, request.symbols, start, end, today
        )
        items = [
            self._analyze(
                symbol,
                names.get(symbol, ""),
                events[symbol],
                calendar_issues,
                quote,
                now,
                start,
                end,
                settings,
            )
            for symbol in request.symbols
        ]
        # 全部板块失败时不能以“成功扫描”的空卡片掩盖连接或行情权限问题。
        if all(item.status == "unavailable" for item in items):
            raise LongbridgeUnavailableError("No earnings radar data available")
        return EarningsRadarResponse(
            as_of=now.isoformat(),
            window_start=today,
            window_end=end,
            history_start=start,
            items=items,
        )

    @staticmethod
    def _calendar(
        ctx: Any,
        symbols: list[str],
        start: date,
        end: date,
        today: date,
    ) -> tuple[dict[str, list[EarningsEvent]], dict[str, str], list[str]]:
        from longbridge.openapi import CalendarCategory

        events: dict[str, list[EarningsEvent]] = {symbol: [] for symbol in symbols}
        names: dict[str, str] = {}
        issues: list[str] = []
        # 先取未来，再从最近历史回溯；两个窗口分别熔断，旧日历不可用不影响未来财报。
        windows = [
            (max(start, today), end, "upcoming_calendar_unavailable"),
            (start, min(end, today - timedelta(days=1)), "history_calendar_unavailable"),
        ]
        for window_start, window_end, issue in windows:
            ranges = [
                (
                    window_start + timedelta(days=offset),
                    min(
                        window_start + timedelta(days=offset + RADAR_CALENDAR_CHUNK_DAYS - 1),
                        window_end,
                    ),
                )
                for offset in range(
                    0, (window_end - window_start).days + 1, RADAR_CALENDAR_CHUNK_DAYS
                )
            ]
            if window_end < today:
                ranges.reverse()
            consecutive_failures = 0
            # SDK 4.1 仅支持按市场筛选，所有标的共用分段请求。
            for cursor, chunk_end in ranges:
                try:
                    response = ctx.finance_calendar(
                        CalendarCategory.Report, cursor.isoformat(), chunk_end.isoformat(), "US"
                    )
                    for group in response.list:
                        for info in group.infos:
                            symbol = info.symbol.upper()
                            if symbol not in events:
                                continue
                            event_date = _event_date(info.date) or _event_date(group.date)
                            if event_date is None or not cursor <= event_date <= chunk_end:
                                continue
                            values = {item.value_type: item.value for item in info.data_kv}
                            names[symbol] = info.counter_name
                            # SDK 提供独立披露时段字段；日期标签为空时仍可识别盘前/盘后。
                            timing = _timing(getattr(info, "financial_market_time", ""))
                            if timing == "unknown":
                                timing = _timing(info.date_type)
                            event = EarningsEvent(
                                date=event_date,
                                timing=timing,
                                period=info.content,
                                currency=info.currency,
                                eps_estimate=values.get("estimate_eps"),
                                revenue_estimate=values.get("estimate_revenue"),
                                reported=any(
                                    _present(values.get(key, ""))
                                    for key in ("actual_eps", "actual_revenue")
                                ),
                            )
                            if not any(
                                (e.date, e.period) == (event.date, event.period)
                                for e in events[symbol]
                            ):
                                events[symbol].append(event)
                    consecutive_failures = 0
                except Exception as exc:
                    raise_if_token_expired(exc)
                    logger.warning(
                        "Earnings calendar segment unavailable: %s to %s (%s, code=%s)",
                        cursor,
                        chunk_end,
                        type(exc).__name__,
                        longbridge_error_code(exc),
                    )
                    issues.append(issue)
                    consecutive_failures += 1
                    if consecutive_failures >= RADAR_CALENDAR_FAILURE_LIMIT:
                        break
        return events, names, list(dict.fromkeys(issues))

    def _analyze(
        self,
        symbol: str,
        name: str,
        events: list[EarningsEvent],
        calendar_issues: list[str],
        quote: Any,
        now: datetime,
        start: date,
        end: date,
        settings: Any,
    ) -> EarningsRadarItem:
        today = now.astimezone(ZoneInfo(RADAR_TIMEZONE)).date()
        item = EarningsRadarItem(symbol=symbol, name=name, issues=list(calendar_issues))
        upcoming = sorted(
            (e for e in events if today <= e.date <= end and not e.reported),
            key=lambda event: event.date,
        )
        item.next_event = upcoming[0] if upcoming else None
        if item.next_event is None:
            if "upcoming_calendar_unavailable" not in item.issues:
                item.issues.append("no_upcoming_event")
        elif item.next_event.timing == "unknown":
            item.issues.append("unknown_timing")
        try:
            quotes = self.market.get_realtime_quotes([symbol], settings=settings).quotes
            current = next((q for q in quotes if q.symbol == symbol), None)
            if current is not None and positive_decimal(current.last_done) is not None:
                item.spot = current.last_done
                item.spot_timestamp = (
                    datetime.fromtimestamp(current.timestamp, UTC).isoformat()
                    if current.timestamp
                    else None
                )
                if _stale(item.spot_timestamp, now):
                    item.issues.append("stale_quote")
            else:
                item.issues.append("quote_unavailable")
        except Exception as exc:
            raise_if_token_expired(exc)
            item.issues.append("quote_unavailable")
        try:
            response = self.market.get_history_candlesticks(
                symbol,
                start=start.isoformat(),
                end=(today - timedelta(days=1)).isoformat(),
                adjust_type="forward",
                trade_sessions="intraday",
                settings=settings,
            )
            bars = []
            for bar in response.bars:
                close = positive_decimal(bar.close)
                if bar.timestamp is None or close is None:
                    continue
                bar_date = datetime.fromtimestamp(bar.timestamp, ZoneInfo(RADAR_TIMEZONE)).date()
                if start <= bar_date < today:
                    bars.append(DailyClose(bar_date, close))
            past = [event for event in events if event.date < today]
            item.history = realized_moves(bars, past)
            item.sample_count = len(item.history)
            item.hv30_pct = historical_volatility(bars)
            if item.history:
                item.historical_median_pct = median(abs(move.move_pct) for move in item.history)
            if any(event.timing == "unknown" for event in past):
                item.issues.append("unknown_history_timing")
        except Exception as exc:
            raise_if_token_expired(exc)
            item.issues.append("history_prices_unavailable")
        if item.sample_count < RADAR_HISTORY_SAMPLES:
            item.issues.append("insufficient_history")
        if item.hv30_pct is None:
            item.issues.append("hv_unavailable")
        spot = positive_decimal(item.spot)
        if item.next_event and spot is not None:
            try:
                item.option = self._options(quote, symbol, spot, item.next_event.date, today)
            except Exception as exc:
                raise_if_token_expired(exc)
                item.option = None
            if item.option is None:
                item.issues.append("options_unavailable")
            elif _stale(item.option.call_timestamp, now) or _stale(item.option.put_timestamp, now):
                item.issues.append("stale_option")
        if item.option and item.historical_median_pct:
            item.ratio = item.option.implied_move_pct / item.historical_median_pct
        item.valuation = ratio_valuation(item.ratio)
        item.status = (
            "ready"
            if item.ratio is not None and not item.issues
            else ("partial" if item.next_event or item.history or item.spot else "unavailable")
        )
        return item

    @staticmethod
    def _options(
        ctx: Any,
        symbol: str,
        spot: Decimal,
        earnings_date: date,
        today: date,
    ) -> EarningsOptionPricing | None:
        # 严格使用财报日之后的到期日，避免周五盘后事件误选当天已到期合约。
        expiries = sorted(
            set(e for e in ctx.option_chain_expiry_date_list(symbol) if e > earnings_date)
        )[:RADAR_EXPIRY_PROBES]
        for expiry in expiries:
            try:
                chain = [
                    row
                    for row in ctx.option_chain_info_by_date(symbol, expiry)
                    if row.standard
                    and positive_decimal(row.price) is not None
                    and row.call_symbol
                    and row.put_symbol
                ]
                if not chain:
                    continue
                # 固定选最近的标准行权价；ATM 缺价就顺延，不拿远价外合约冒充 ATM。
                strike = min(chain, key=lambda row: (abs(row.price - spot), row.price))
                quotes = {
                    q.symbol: q for q in ctx.option_quote([strike.call_symbol, strike.put_symbol])
                }
                call, put = quotes.get(strike.call_symbol), quotes.get(strike.put_symbol)
                call_price = positive_decimal(getattr(call, "last_done", None))
                put_price = positive_decimal(getattr(put, "last_done", None))
                if call_price is None or put_price is None:
                    continue
                call_iv = positive_decimal(getattr(call, "implied_volatility", None))
                put_iv = positive_decimal(getattr(put, "implied_volatility", None))
                return EarningsOptionPricing(
                    expiry=expiry,
                    primary_expiry=expiries[0],
                    fallback=expiry != expiries[0],
                    dte=(expiry - today).days,
                    days_after_earnings=(expiry - earnings_date).days,
                    strike=str(strike.price),
                    call_symbol=strike.call_symbol,
                    put_symbol=strike.put_symbol,
                    call_price=str(call_price),
                    put_price=str(put_price),
                    call_timestamp=_timestamp(getattr(call, "timestamp", None)),
                    put_timestamp=_timestamp(getattr(put, "timestamp", None)),
                    straddle=str(call_price + put_price),
                    implied_move_pct=float((call_price + put_price) / spot * RADAR_PERCENT),
                    iv_pct=float((call_iv + put_iv) / 2 * RADAR_PERCENT)
                    if call_iv and put_iv
                    else None,
                )
            except Exception as exc:
                raise_if_token_expired(exc)
                continue
        return None
