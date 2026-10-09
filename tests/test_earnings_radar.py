"""只使用 SDK 替身验证事件窗口、波动计算、隔离和失败降级。"""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace as NS
from unittest.mock import Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api import fundamentals
from app.core.earnings.calculations import (
    DailyClose,
    historical_volatility,
    positive_decimal,
    ratio_valuation,
    realized_moves,
)
from app.core.earnings.service import EarningsRadarService
from app.core.market.errors import LongbridgeUnavailableError
from app.core.security import CurrentUser, get_current_user
from app.schemas.earnings import EarningsEvent, EarningsRadarRequest, EarningsRadarResponse


def event(day, timing="after_close", **kwargs):
    return EarningsEvent(date=date.fromisoformat(day), timing=timing, **kwargs)


def bar(day, close):
    return DailyClose(date.fromisoformat(day), Decimal(str(close)))


def test_sessions_weekends_unknown_timing_and_missing_prices():
    bars = [bar("2026-04-02", 100), bar("2026-04-06", 110), bar("2026-04-07", 99)]
    assert realized_moves(bars, [event("2026-04-02")])[0].move_pct == pytest.approx(10)
    before_open = realized_moves(bars, [event("2026-04-06", "before_open")])[0]
    assert before_open.before_date == date(2026, 4, 2)
    assert before_open.move_pct == pytest.approx(10)
    assert realized_moves(bars, [event("2026-04-04", "before_open")])[0].move_pct == 10
    assert realized_moves(bars, [event("2026-04-04")])[0].move_pct == 10
    assert realized_moves(bars, [event("2026-04-06", "unknown")]) == []
    assert realized_moves(bars, [event("2026-04-07")]) == []
    assert realized_moves([bars[0], bar("2026-04-20", 120)], [event("2026-04-02")]) == []
    assert len(realized_moves(bars, [event("2026-04-02")] * 2)) == 1


def test_history_uses_latest_twelve_and_hv_needs_thirty_complete_returns():
    start = date(2026, 1, 1)
    bars = [DailyClose(start + timedelta(days=i), Decimal(100 + i)) for i in range(32)]
    events = [EarningsEvent(date=b.date, timing="after_close") for b in bars]
    history = realized_moves(list(reversed(bars)), events)
    assert len(history) == 12
    assert history[-1].after_date == bars[-1].date
    assert historical_volatility(bars[:30]) is None
    assert historical_volatility(bars[:31]) > 0
    assert historical_volatility([DailyClose(b.date, Decimal(100)) for b in bars]) == 0
    for invalid in (None, "NaN", "Infinity", "-1", "0", "n/a"):
        assert positive_decimal(invalid) is None


@pytest.mark.parametrize(
    "ratio,label",
    [(None, "unavailable"), (1.5, "high"), (1.15, "above"), (0.85, "normal"), (0.84, "below")],
)
def test_ratio_boundaries(ratio, label):
    assert ratio_valuation(ratio) == label


def test_symbol_validation_normalization_and_bounds():
    request = EarningsRadarRequest(symbols=[" aapl ", "AAPL.US", "brk.b"])
    assert request.symbols == ["AAPL.US", "BRK.B.US"]
    for symbols in ([], [""], ["../file"], ["700.HK"], ["AAPL"] * 21):
        with pytest.raises(ValidationError):
            EarningsRadarRequest(symbols=symbols)
    for days in (0, 91):
        with pytest.raises(ValidationError):
            EarningsRadarRequest(symbols=["AAPL"], days_ahead=days)


def option_quote(symbol, price, iv="0.4"):
    return NS(
        symbol=symbol,
        last_done=Decimal(price),
        implied_volatility=Decimal(iv),
        timestamp=datetime(2026, 10, 9, 15, tzinfo=UTC),
    )


def test_options_skip_same_day_nonstandard_and_missing_atm_then_roll_forward():
    ctx = Mock()
    ctx.option_chain_expiry_date_list.return_value = [
        date(2026, 10, 9),
        date(2026, 10, 16),
        date(2026, 10, 23),
    ]
    ctx.option_chain_info_by_date.return_value = [
        NS(price=Decimal("100"), standard=False, call_symbol="ADJC", put_symbol="ADJP"),
        NS(price=Decimal("101"), standard=True, call_symbol="C", put_symbol="P"),
        NS(price=Decimal("120"), standard=True, call_symbol="OTMC", put_symbol="OTMP"),
    ]
    ctx.option_quote.side_effect = [
        [option_quote("C", "0"), option_quote("P", "5")],
        [option_quote("C", "4"), option_quote("P", "6")],
    ]
    pricing = EarningsRadarService._options(
        ctx, "AAPL.US", Decimal("100"), date(2026, 10, 9), date(2026, 10, 8)
    )
    assert pricing.expiry == date(2026, 10, 23)
    assert pricing.primary_expiry == date(2026, 10, 16)
    assert pricing.fallback is True
    assert pricing.implied_move_pct == 10
    assert pricing.iv_pct == 40
    assert pricing.dte == 15 and pricing.days_after_earnings == 14
    assert pricing.straddle == "10"
    assert all(call.args == (["C", "P"],) for call in ctx.option_quote.call_args_list)


def test_calendar_uses_sdk_value_type_language_independent_data_and_deduplicates():
    info = NS(
        symbol="AAPL.US",
        date="2026.10.09",
        date_type="Before Market Open",
        counter_name="Apple",
        content="Q3 results",
        currency="USD",
        data_kv=[
            NS(value_type="estimate_eps", value="1.25"),
            NS(value_type="actual_eps", value="0"),
        ],
    )
    ctx = Mock()
    ctx.finance_calendar.return_value = NS(list=[NS(date="2026-10-09", infos=[info, info])])
    events, names, issues = EarningsRadarService._calendar(
        ctx, ["AAPL.US"], date(2026, 10, 1), date(2026, 10, 10), date(2026, 10, 9)
    )
    assert len(events["AAPL.US"]) == 1
    assert events["AAPL.US"][0].timing == "before_open"
    assert events["AAPL.US"][0].reported is True  # 实际 EPS 为零同样代表已披露。
    assert events["AAPL.US"][0].eps_estimate == "1.25"
    assert names["AAPL.US"] == "Apple"
    assert issues == []
    ctx.finance_calendar.side_effect = RuntimeError("private token must not be exposed")
    _, _, issues = EarningsRadarService._calendar(
        ctx, ["AAPL.US"], date(2026, 8, 1), date(2026, 10, 10), date(2026, 10, 9)
    )
    assert set(issues) == {"history_calendar_unavailable", "upcoming_calendar_unavailable"}


def test_analyze_uses_true_even_median_excludes_today_and_preserves_partial_data():
    market = Mock()
    now = datetime(2026, 10, 9, 15, tzinfo=UTC)
    market.get_realtime_quotes.return_value = NS(
        quotes=[NS(symbol="AAPL.US", last_done="100", timestamp=int(now.timestamp()))]
    )
    prices = [
        ("2026-10-05", "100"),
        ("2026-10-06", "110"),
        ("2026-10-07", "88"),
        ("2026-10-09", "999"),
    ]
    market.get_history_candlesticks.return_value = NS(
        bars=[
            NS(
                timestamp=int(datetime.fromisoformat(day + "T14:00:00+00:00").timestamp()),
                close=price,
            )
            for day, price in prices
        ]
    )
    service = EarningsRadarService(market)
    settings = object()
    result = service._analyze(
        "AAPL.US",
        "Apple",
        [event("2026-10-05"), event("2026-10-06"), event("2026-10-09", reported=True)],
        [],
        Mock(),
        now,
        date(2023, 10, 9),
        date(2026, 11, 30),
        settings,
    )
    assert result.historical_median_pct == 15  # (10 + 20) / 2，不取上中位。
    assert result.sample_count == 2
    assert result.next_event is None
    assert result.status == "partial"
    assert market.get_history_candlesticks.call_args.kwargs["settings"] is settings
    assert market.get_history_candlesticks.call_args.kwargs["end"] == "2026-10-08"
    market.get_realtime_quotes.side_effect = RuntimeError("secret")
    market.get_history_candlesticks.side_effect = RuntimeError("secret")
    failed = service._analyze(
        "AAPL.US", "", [], [], Mock(), now, date(2023, 10, 9), date(2026, 11, 30), settings
    )
    assert failed.status == "unavailable"
    assert failed.spot is None and failed.historical_median_pct is None
    assert "secret" not in failed.model_dump_json()
    unknown = service._analyze(
        "AAPL.US",
        "",
        [],
        ["upcoming_calendar_unavailable"],
        Mock(),
        now,
        date(2023, 10, 9),
        date(2026, 11, 30),
        settings,
    )
    assert "no_upcoming_event" not in unknown.issues


def test_scan_reuses_contexts_with_effective_settings_and_eastern_date(monkeypatch):
    import app.core.earnings.service as module

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 10, 10, 1, tzinfo=UTC)

    monkeypatch.setattr(module, "datetime", Clock)
    context = Mock()
    context.finance_calendar.return_value = NS(list=[])
    get_context = Mock(return_value=context)
    monkeypatch.setattr(module, "get_cached_context", get_context)
    market = Mock()
    market.get_realtime_quotes.side_effect = RuntimeError("not entitled")
    market.get_history_candlesticks.side_effect = RuntimeError("not entitled")
    settings = object()
    result = EarningsRadarService(market).scan(EarningsRadarRequest(symbols=["AAPL"]), settings)
    assert result.window_start == date(2026, 10, 9)
    assert result.items[0].status == "unavailable"
    assert all(call.kwargs["settings"] is settings for call in get_context.call_args_list)
    get_context.side_effect = RuntimeError("secret")
    with pytest.raises(LongbridgeUnavailableError, match="connection unavailable"):
        EarningsRadarService(market).scan(EarningsRadarRequest(symbols=["AAPL"]), settings)


def test_api_permission_validation_user_settings_and_safe_failure(monkeypatch):
    api = FastAPI()
    api.include_router(fundamentals.router)
    user = CurrentUser(
        id="alice",
        username="alice",
        display_name="Alice",
        roles=[],
        is_active=True,
        permissions=["fundamentals:read"],
    )
    api.dependency_overrides[get_current_user] = lambda: user
    service = Mock()
    response = EarningsRadarResponse(
        as_of="2026-10-09T12:00:00Z",
        window_start=date(2026, 10, 9),
        window_end=date(2026, 11, 23),
        history_start=date(2023, 10, 9),
        items=[],
    )
    service.scan.return_value = response
    monkeypatch.setattr(fundamentals, "get_earnings_radar_service", lambda: service)
    settings = object()
    load_settings = Mock(return_value=settings)
    monkeypatch.setattr(fundamentals, "get_effective_settings", load_settings)
    with TestClient(api) as client:
        assert client.post("/earnings-radar", json={"symbols": ["AAPL"]}).status_code == 200
        load_settings.assert_called_once_with("alice")
        assert service.scan.call_args.kwargs["settings"] is settings
        assert client.post("/earnings-radar", json={"symbols": ["700.HK"]}).status_code == 422
        service.scan.side_effect = LongbridgeUnavailableError("secret token")
        failed = client.post("/earnings-radar", json={"symbols": ["AAPL"]})
        assert failed.status_code == 503 and "secret" not in failed.text
        user.permissions.clear()
        assert client.post("/earnings-radar", json={"symbols": ["AAPL"]}).status_code == 403
