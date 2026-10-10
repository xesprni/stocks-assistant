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
from app.core.market.errors import LongbridgeTokenExpiredError, LongbridgeUnavailableError
from app.core.market.service import MarketService
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


def option_pair(
    price, call_symbol="C", put_symbol="P", *, expiry=date(2026, 10, 16), standard=True
):
    from longbridge.openapi import OptionDirection, OptionStandardAttr

    return [
        NS(
            symbol=symbol,
            strike_price=Decimal(price),
            expiry_date=expiry,
            direction=direction,
            standard_attr=OptionStandardAttr.Normal if standard else OptionStandardAttr.Old,
        )
        for symbol, direction in [
            (call_symbol, OptionDirection.Call),
            (put_symbol, OptionDirection.Put),
        ]
    ]


def test_options_skip_same_day_nonstandard_and_missing_atm_then_roll_forward():
    ctx = Mock()
    ctx.option_chain_expiry_date_list.return_value = [
        date(2026, 10, 9),
        date(2026, 10, 16),
        date(2026, 10, 23),
    ]
    ctx.option_chain_info_by_date.side_effect = lambda symbol, expiry, **kwargs: [
        *option_pair("100", "ADJC", "ADJP", expiry=expiry, standard=False),
        *option_pair("101", expiry=expiry),
        *option_pair("120", "OTMC", "OTMP", expiry=expiry),
    ]
    ctx.option_quote.side_effect = [
        [option_quote("C", "0"), option_quote("P", "5")],
        [option_quote("C", "4"), option_quote("P", "6")],
    ]
    pricing = EarningsRadarService._options(
        ctx, "AAPL.US", Decimal("100"), date(2026, 10, 9), date(2026, 10, 8)
    ).pricing
    assert pricing.expiry == date(2026, 10, 23)
    assert pricing.primary_expiry == date(2026, 10, 16)
    assert pricing.fallback is True
    assert pricing.implied_move_pct == 10
    assert pricing.iv_pct == 40
    assert pricing.dte == 15 and pricing.days_after_earnings == 14
    assert pricing.straddle == "10"
    assert all(call.args == (["C", "P"],) for call in ctx.option_quote.call_args_list)
    assert all(
        call.kwargs == {"standard_only": True}
        for call in ctx.option_chain_info_by_date.call_args_list
    )


def test_options_do_not_pair_different_strikes_or_expiries_or_skip_incomplete_atm():
    ctx = Mock()
    first, second = date(2026, 10, 16), date(2026, 10, 23)
    ctx.option_chain_expiry_date_list.return_value = [first, second]
    ctx.option_chain_info_by_date.side_effect = [
        [
            option_pair("100")[0],
            option_pair("100", expiry=second)[1],
            *option_pair("120", "FAR_C", "FAR_P"),
        ],
        option_pair("100", expiry=second),
    ]
    ctx.option_quote.return_value = [option_quote("C", "4"), option_quote("P", "6")]
    pricing = EarningsRadarService._options(
        ctx, "TSM.US", Decimal("100"), date(2026, 10, 15), date(2026, 10, 9)
    ).pricing
    assert pricing.expiry == second
    assert pricing.fallback is True
    ctx.option_quote.assert_called_once_with(["C", "P"])


def test_calendar_uses_sdk_value_type_language_independent_data_and_deduplicates():
    info = NS(
        symbol="AAPL.US",
        date="2026.10.09",
        date_type="Before Market Open",
        financial_market_time="",
        counter_name="Apple",
        content="Q3 results",
        currency="USD",
        data_kv=[
            NS(value_type="estimate_eps", value="1.25"),
            NS(value_type="actual_eps", value="0"),
        ],
    )
    ctx = Mock()
    ctx.pages.return_value = [NS(groups=[NS(date="2026-10-09", infos=[info, info])])]
    events, names, issues = EarningsRadarService._calendar(
        ctx, ["AAPL.US"], date(2026, 10, 1), date(2026, 10, 10), date(2026, 10, 9)
    )
    assert len(events["AAPL.US"]) == 1
    assert events["AAPL.US"][0].timing == "before_open"
    assert events["AAPL.US"][0].reported is True  # 实际 EPS 为零同样代表已披露。
    assert events["AAPL.US"][0].eps_estimate == "1.25"
    assert names["AAPL.US"] == "Apple"
    assert issues == []
    ctx.pages.side_effect = RuntimeError("private token must not be exposed")
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
    context.pages.return_value = [NS(groups=[])]
    monkeypatch.setattr(module, "EarningsCalendarClient", lambda *args: context)
    get_context = Mock(return_value=context)
    monkeypatch.setattr(module, "get_cached_context", get_context)
    market = Mock()
    market.get_realtime_quotes.return_value = NS(
        quotes=[NS(symbol="AAPL.US", last_done="100", timestamp=None)]
    )
    market.get_history_candlesticks.side_effect = RuntimeError("not entitled")
    settings = object()
    result = EarningsRadarService(market).scan(EarningsRadarRequest(symbols=["AAPL"]), settings)
    assert result.window_start == date(2026, 10, 9)
    assert result.items[0].status == "partial"
    assert all(call.kwargs["settings"] is settings for call in get_context.call_args_list)
    market.get_realtime_quotes.side_effect = RuntimeError("not entitled")
    with pytest.raises(LongbridgeUnavailableError, match="No earnings radar data"):
        EarningsRadarService(market).scan(EarningsRadarRequest(symbols=["AAPL"]), settings)
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
        service.scan.side_effect = LongbridgeTokenExpiredError("secret token")
        failed = client.post("/earnings-radar", json={"symbols": ["AAPL"]})
        assert failed.status_code == 503
        assert "凭据已过期" in failed.json()["detail"] and "secret" not in failed.text
        load_settings.return_value = NS(app_language="en")
        failed = client.post("/earnings-radar", json={"symbols": ["AAPL"]})
        assert "Longbridge token expired" in failed.json()["detail"]
        user.permissions.clear()
        assert client.post("/earnings-radar", json={"symbols": ["AAPL"]}).status_code == 403


def calendar_info(day, **kwargs):
    return NS(
        symbol="AAPL.US",
        date=day,
        date_type="",
        financial_market_time="after",
        counter_name="Apple",
        content="Quarterly results",
        currency="USD",
        data_kv=[],
        **kwargs,
    )


@pytest.mark.parametrize(
    "session,label,expected",
    [
        ("before", "Pre", "before_open"),
        ("after", "Post", "after_close"),
        ("", "Pre", "before_open"),
        ("", "Post", "after_close"),
        ("", "BMO", "before_open"),
        ("", "AMC", "after_close"),
        ("", "盘前", "before_open"),
        ("", "盤後", "after_close"),
        ("before_open", "", "before_open"),
        ("after-close", "", "after_close"),
        ("", "Pre-market", "before_open"),
        ("", "After Hours", "after_close"),
        ("during", "", "unknown"),
        ("", "", "unknown"),
        ("unknown", "TBD", "unknown"),
        ("after", "Pre", "after_close"),
    ],
)
def test_calendar_recognizes_longbridge_session_codes_and_localized_labels(
    session, label, expected
):
    # 使用长桥公开财报日历返回的 before/after 和 Pre/Post，覆盖此前全被排除的事件。
    info = calendar_info("2026-10-08")
    info.financial_market_time = session
    info.date_type = label
    ctx = Mock()
    ctx.pages.return_value = [NS(groups=[NS(date=info.date, infos=[info])])]
    events, _, issues = EarningsRadarService._calendar(
        ctx, ["AAPL.US"], date(2026, 10, 8), date(2026, 10, 8), date(2026, 10, 9)
    )
    assert events["AAPL.US"][0].timing == expected
    assert issues == []


@pytest.mark.parametrize("failed_window", ["history", "upcoming"])
def test_calendar_failure_does_not_skip_other_window(failed_window):
    today = date(2026, 10, 9)
    calls = []

    def calendar_pages(start, end):
        calls.append((start, end))
        history = end < today
        if history == (failed_window == "history"):
            raise RuntimeError("private upstream error")
        info = calendar_info("2026-10-08" if history else "2026-10-12")
        return [NS(groups=[NS(date=info.date, infos=[info])])]

    ctx = NS(pages=calendar_pages)
    events, _, issues = EarningsRadarService._calendar(
        ctx, ["AAPL.US"], date(2023, 10, 9), date(2027, 1, 7), today
    )
    expected_date = date(2026, 10, 12) if failed_window == "history" else date(2026, 10, 8)
    assert [event.date for event in events["AAPL.US"]] == [expected_date]
    assert events["AAPL.US"][0].timing == "after_close"
    assert issues == [f"{failed_window}_calendar_unavailable"]
    assert calls[0][0] == today
    history_calls = [(start, end) for start, end in calls if end < today]
    assert history_calls[0][1] == today - timedelta(days=1)
    assert all(start <= end and (end - start).days < 30 for start, end in calls)
    failed_calls = [call for call in calls if (call[1] < today) == (failed_window == "history")]
    assert len(failed_calls) == 3


def expired_token():
    from longbridge.openapi import ErrorKind, OpenApiException

    return OpenApiException(
        ErrorKind.OpenApi, 401003, "test-trace", "private upstream token must not be exposed"
    )


def test_calendar_expired_token_stops_immediately():
    ctx = Mock()
    ctx.pages.side_effect = expired_token()
    with pytest.raises(LongbridgeTokenExpiredError, match="Longbridge token expired"):
        EarningsRadarService._calendar(
            ctx, ["AAPL.US"], date(2023, 10, 9), date(2026, 11, 30), date(2026, 10, 9)
        )
    assert ctx.pages.call_count == 1


@pytest.mark.parametrize("stage", ["context", "quote", "history", "expiry", "chain", "option"])
def test_scan_propagates_expired_tokens_instead_of_returning_empty_cards(
    monkeypatch, tmp_path, stage
):
    import app.core.earnings.service as module

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 10, 9, 15, tzinfo=UTC)

    monkeypatch.setattr(module, "datetime", Clock)
    ctx = Mock()
    ctx.pages.return_value = [
        NS(groups=[NS(date="2026-10-09", infos=[calendar_info("2026-10-12")])])
    ]
    ctx.quote.return_value = [NS(symbol="AAPL.US", last_done=Decimal("100"), timestamp=None)]
    ctx.history_candlesticks_by_date.return_value = []
    ctx.option_chain_expiry_date_list.return_value = [date(2026, 10, 16)]
    ctx.option_chain_info_by_date.return_value = option_pair("100")
    monkeypatch.setattr(module, "EarningsCalendarClient", lambda *args: ctx)
    get_context = Mock(return_value=ctx)
    monkeypatch.setattr(module, "get_cached_context", get_context)
    market = MarketService(str(tmp_path))
    monkeypatch.setattr(market, "_quote_context", lambda settings=None: ctx)
    method = {
        "context": get_context,
        "quote": ctx.quote,
        "history": ctx.history_candlesticks_by_date,
        "expiry": ctx.option_chain_expiry_date_list,
        "chain": ctx.option_chain_info_by_date,
        "option": ctx.option_quote,
    }[stage]
    method.side_effect = expired_token()
    with pytest.raises(LongbridgeTokenExpiredError):
        EarningsRadarService(market).scan(EarningsRadarRequest(symbols=["AAPL"]), object())


@pytest.mark.parametrize("upcoming_day", ["2026-10-12", "2026-11-30"])
def test_scan_from_sdk_fields_preserves_history_with_or_without_upcoming_earnings(
    monkeypatch, tmp_path, upcoming_day
):
    import app.core.earnings.service as module

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 10, 9, 15, tzinfo=UTC)

    monkeypatch.setattr(module, "datetime", Clock)
    ctx = Mock()
    ctx.pages.return_value = [
        NS(
            groups=[
                NS(date=day, infos=[calendar_info(day)]) for day in ("2026-10-05", upcoming_day)
            ]
        )
    ]
    monkeypatch.setattr(module, "EarningsCalendarClient", lambda *args: ctx)
    monkeypatch.setattr(module, "get_cached_context", lambda *args, **kwargs: ctx)
    ctx.quote.return_value = [NS(symbol="AAPL.US", last_done=Decimal("100"), timestamp=Clock.now())]
    ctx.history_candlesticks_by_date.return_value = [
        NS(timestamp=datetime(2026, 10, day, 14, tzinfo=UTC), close=Decimal(price))
        for day, price in [(5, "100"), (6, "110")]
    ]
    ctx.option_chain_expiry_date_list.return_value = [date(2026, 10, 16)]
    ctx.option_chain_info_by_date.return_value = option_pair("100")
    ctx.option_quote.return_value = [option_quote("C", "4"), option_quote("P", "6")]
    market = MarketService(str(tmp_path))
    monkeypatch.setattr(market, "_quote_context", lambda settings=None: ctx)
    result = EarningsRadarService(market).scan(EarningsRadarRequest(symbols=["AAPL"]), object())
    item = result.items[0]
    assert item.spot == "100"
    assert item.sample_count == 1
    assert item.historical_median_pct == 10
    assert "unknown_history_timing" not in item.issues
    if upcoming_day == "2026-10-12":
        assert item.next_event.date == date(2026, 10, 12)
        assert item.next_event.timing == "after_close"
        assert item.option.implied_move_pct == 10
        assert item.ratio == 1
        assert item.valuation == "normal"
    else:
        # 对应截图：45 天内没有下一次财报，也必须显示已知时段的历史波动。
        assert item.next_event is None
        assert item.option is None
        assert item.ratio is None
        assert "no_upcoming_event" in item.issues
        ctx.option_chain_expiry_date_list.assert_not_called()
