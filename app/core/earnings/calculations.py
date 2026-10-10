"""不依赖 SDK 的财报日期与波动计算。"""

from bisect import bisect_left, bisect_right
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from math import log, sqrt
from statistics import stdev

from app.constants.earnings import (
    RADAR_HISTORY_SAMPLES,
    RADAR_HV_RETURNS,
    RADAR_MAX_SESSION_GAP_DAYS,
    RADAR_PERCENT,
    RADAR_RATIO_ABOVE,
    RADAR_RATIO_HIGH,
    RADAR_RATIO_NORMAL,
    RADAR_TRADING_DAYS,
)
from app.schemas.earnings import (
    EarningsEvent,
    EarningsHistoryEntry,
    EarningsMove,
    EarningsTiming,
    RadarValuation,
)


@dataclass(frozen=True)
class DailyClose:
    date: date
    close: Decimal


def positive_decimal(value: object) -> Decimal | None:
    try:
        number = Decimal(str(value))
        return number if number.is_finite() and number > 0 else None
    except (InvalidOperation, ValueError):
        return None


def realized_moves(bars: list[DailyClose], events: list[EarningsEvent]) -> list[EarningsMove]:
    ordered = sorted(
        {bar.date: bar for bar in bars if bar.close > 0}.values(), key=lambda b: b.date
    )
    dates = [bar.date for bar in ordered]
    result = []
    seen: set[date] = set()
    for event in sorted(events, key=lambda event: event.date):
        if event.timing == "unknown" or event.date in seen:
            continue
        # 盘后用披露日之后的收盘，盘前用披露日当天或之后首个交易日的收盘。
        # 非交易日披露时两种时段都落到下一交易日；不使用当前未收盘的 K 线。
        after = (bisect_right if event.timing == "after_close" else bisect_left)(dates, event.date)
        if after == 0 or after >= len(ordered):
            continue
        before_bar, after_bar = ordered[after - 1], ordered[after]
        if (after_bar.date - before_bar.date).days > RADAR_MAX_SESSION_GAP_DAYS:
            continue
        result.append(
            EarningsMove(
                date=event.date,
                timing=event.timing,
                period=event.period,
                before_date=before_bar.date,
                after_date=after_bar.date,
                before_close=str(before_bar.close),
                after_close=str(after_bar.close),
                move_pct=float((after_bar.close / before_bar.close - 1) * RADAR_PERCENT),
            )
        )
        seen.add(event.date)
    return result[-RADAR_HISTORY_SAMPLES:]


def earnings_history(
    bars: list[DailyClose], events: list[EarningsEvent]
) -> list[EarningsHistoryEntry]:
    by_date: dict[date, list[EarningsEvent]] = {}
    for event in events:
        by_date.setdefault(event.date, []).append(event)
    recent = []
    # 先确定最近十二个日期，再计算反应；未知时段仍占一个位置，不能被旧样本替换。
    for day in sorted(by_date)[-RADAR_HISTORY_SAMPLES:]:
        group = by_date[day]
        known = {event.timing for event in group if event.timing != "unknown"}
        timing: EarningsTiming = next(iter(known)) if len(known) == 1 else "unknown"
        # 同日季度/年度记录只计算一次；冲突时段保守保留未知，期间文案仍全部展示。
        recent.append(
            EarningsEvent(
                date=day,
                timing=timing,
                period=" / ".join(dict.fromkeys(event.period for event in group if event.period)),
            )
        )
    moves = {move.date: move for move in realized_moves(bars, recent)}
    return [
        EarningsHistoryEntry(
            date=event.date,
            timing=event.timing,
            period=event.period,
            move=moves.get(event.date),
            exclusion_reason=(
                "unknown_timing"
                if event.timing == "unknown"
                else "missing_prices"
                if event.date not in moves
                else None
            ),
        )
        for event in recent
    ]


def historical_volatility(bars: list[DailyClose]) -> float | None:
    ordered = sorted({bar.date: bar for bar in bars}.values(), key=lambda b: b.date)
    recent = ordered[-(RADAR_HV_RETURNS + 1) :]
    if len(recent) < RADAR_HV_RETURNS + 1 or any(bar.close <= 0 for bar in recent):
        return None
    if any(
        (b.date - a.date).days > RADAR_MAX_SESSION_GAP_DAYS
        for a, b in zip(recent, recent[1:], strict=False)
    ):
        return None
    returns = [log(float(b.close / a.close)) for a, b in zip(recent, recent[1:], strict=False)]
    return stdev(returns) * sqrt(RADAR_TRADING_DAYS) * RADAR_PERCENT


def ratio_valuation(ratio: float | None) -> RadarValuation:
    if ratio is None:
        return "unavailable"
    if ratio >= RADAR_RATIO_HIGH:
        return "high"
    if ratio >= RADAR_RATIO_ABOVE:
        return "above"
    if ratio >= RADAR_RATIO_NORMAL:
        return "normal"
    return "below"
