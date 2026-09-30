"""收盘后自动记录资产；不把浏览器访问时间或成本回退当成收盘行情。"""

import logging
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from threading import Event
from zoneinfo import ZoneInfo

from app.config import Settings
from app.constants.portfolio import (
    SNAPSHOT_MARKET_TIMEZONES,
    SNAPSHOT_PRICE_SOURCE,
    SNAPSHOT_QUOTE_MARKETS,
    SNAPSHOT_SETTLEMENT_DELAY,
)
from app.core.market.longbridge_context import credential_signature
from app.core.market.service import MarketService
from app.core.portfolio.close_schedule import market_close_at
from app.core.portfolio.service import PortfolioService
from app.core.portfolio.valuation import money
from app.schemas.market_data import TradingDays
from app.schemas.portfolio import PortfolioAssetSnapshot, PortfolioMarket

logger = logging.getLogger("stocks-assistant.portfolio.snapshots")


def _amount(value: str | None) -> Decimal:
    try:
        result = Decimal(value or "")
    except InvalidOperation as exc:
        raise ValueError("Missing portfolio amount or closing price") from exc
    if not result.is_finite() or result < 0:
        raise ValueError("Invalid portfolio amount or closing price")
    return result


class PortfolioSnapshotService:
    def __init__(self, portfolio: PortfolioService, market: MarketService):
        self.portfolio = portfolio
        self.market = market
        self._calendars: dict[tuple[str, PortfolioMarket], tuple[str, str, TradingDays]] = {}

    def capture_due(
        self, user_id: str, settings: Settings, now: datetime, stop: Event | None = None
    ) -> list[PortfolioAssetSnapshot]:
        if now.tzinfo is None:
            raise ValueError("Snapshot time must include a timezone")
        results = []
        for market in self.portfolio.repository.snapshot_markets(user_id):
            if stop is not None and stop.is_set():
                break
            try:
                result = self._capture_market(user_id, market, settings, now, stop)
                if result is not None:
                    results.append(result)
            except Exception:
                # 单个市场行情缺失不能影响其他市场；下次轮询重试，不写入不完整估值。
                logger.warning(
                    "Asset snapshot deferred: user=%s market=%s", user_id, market, exc_info=True
                )
        return results

    def _capture_market(
        self,
        user_id: str,
        market: PortfolioMarket,
        settings: Settings,
        now: datetime,
        stop: Event | None,
    ) -> PortfolioAssetSnapshot | None:
        zone = ZoneInfo(SNAPSHOT_MARKET_TIMEZONES[market])
        day = now.astimezone(zone).date()
        day_key = day.isoformat()
        if now < market_close_at(market, day, half_day=True) + SNAPSHOT_SETTLEMENT_DELAY:
            return None
        repository = self.portfolio.repository
        if repository.has_asset_snapshot(market, day_key, user_id):
            return None
        key = (user_id, market)
        signature = credential_signature(settings)
        cached = self._calendars.get(key)
        if cached is None or cached[:2] != (day_key, signature):
            calendar = self.market.get_trading_days(
                SNAPSHOT_QUOTE_MARKETS[market], day_key, day_key, settings=settings
            )
            self._calendars[key] = (day_key, signature, calendar)
        else:
            calendar = cached[2]
        half_day = day_key in calendar.half_trading_days
        if day_key not in calendar.trading_days and not half_day:
            return None
        close_at = market_close_at(market, day, half_day=half_day)
        if now < close_at + SNAPSHOT_SETTLEMENT_DELAY:
            return None

        local = self.portfolio.get_local_snapshot(market, user_id)
        cash = _amount(local.total_capital)
        equity = Decimal(0)
        for item in local.items:
            if stop is not None and stop.is_set():
                return None
            shares = _amount(item.shares)
            if shares == 0:
                continue
            # 按当日未复权、常规交易时段的日线收盘价估值，排除盘后价和旧行情。
            history = self.market.get_history_candlesticks(
                item.symbol,
                period="1D",
                start=day_key,
                end=day_key,
                adjust_type="none",
                trade_sessions="intraday",
                settings=settings,
            )
            bars = [
                bar
                for bar in history.bars
                if datetime.fromtimestamp(bar.timestamp, zone).date() == day
            ]
            if len(bars) != 1:
                raise ValueError(f"Closing price unavailable for {item.symbol} on {day_key}")
            equity += shares * _amount(bars[0].close)

        if stop is not None and stop.is_set():
            return None
        snapshot = PortfolioAssetSnapshot(
            market=market,
            date=day_key,
            total_assets=money(cash + equity) or "0.00",
            total_capital=money(cash) or "0.00",
            equity_value=money(equity) or "0.00",
            scheduled_at=close_at.isoformat(),
            captured_at=now.astimezone(UTC).isoformat(),
            source=SNAPSHOT_PRICE_SOURCE,
        )
        repository.save_asset_snapshot(snapshot, user_id, expected=local)
        return snapshot
