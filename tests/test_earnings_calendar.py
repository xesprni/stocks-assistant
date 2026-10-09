"""用 SDK 响应替身覆盖跨页遗漏、游标异常及已读取数据的保留。"""

from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace as NS
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlparse

import pytest

from app.config import Settings
from app.core.earnings.calendar import EarningsCalendarClient
from app.core.earnings.service import EarningsRadarService, _event_date
from app.core.market.errors import LongbridgeUnavailableError
from app.core.market.longbridge_context import create_http_client
from app.schemas.earnings import EarningsRadarRequest


def page(day, symbols, next_date="", *, count=None):
    return dict(
        list=[
            dict(
                date=day,
                count=len(symbols) if count is None else count,
                infos=[
                    dict(
                        id=f"{day}/{symbol}",
                        symbol=symbol,
                        date=f"Today {day.replace('-', '.')} (EST)",
                        financial_market_time="after",
                        counter_name=symbol,
                        content="Quarterly results",
                    )
                    for symbol in symbols
                ],
            )
        ],
        next_date=next_date,
    )


def test_calendar_finds_target_after_full_first_page_and_reads_inclusive_end():
    ctx = Mock()
    ctx.request.side_effect = [
        page("2026-10-09", [f"OTHER{i}.US" for i in range(100)], "2026-10-12"),
        page("2026-10-12", ["CRDO.US"], "2026-10-13"),
    ]
    events, names, issues = EarningsRadarService._calendar(
        EarningsCalendarClient(lambda: ctx, "en"),
        ["CRDO.US"],
        date(2026, 10, 9),
        date(2026, 10, 12),
        date(2026, 10, 9),
    )
    assert [event.date for event in events["CRDO.US"]] == [date(2026, 10, 12)]
    assert events["CRDO.US"][0].timing == "after_close"
    assert names["CRDO.US"] == "CRDO.US"
    assert issues == []
    queries = [parse_qs(urlparse(call.args[1]).query) for call in ctx.request.call_args_list]
    assert [q["date"] for q in queries] == [["2026-10-09"], ["2026-10-12"]]
    for query, call in zip(queries, ctx.request.call_args_list, strict=True):
        assert call.args[0] == "GET"
        assert urlparse(call.args[1]).path == "/v1/quote/finance_calendar"
        assert query["date_end"] == ["2026-10-12"]
        assert query["count"] == ["100"] and query["offset"] == ["0"]
        assert query["next"] == ["later"] and query["markets[]"] == ["US"]
        assert query["types[]"] == ["report"]
        assert call.kwargs == {"headers": {"Accept-Language": "en"}}


def test_same_date_pagination_uses_offset_and_combines_group_counts():
    ctx = Mock()
    ctx.request.side_effect = [
        page("2026-10-09", ["A.US"], "2026-10-09", count=2),
        page("2026-10-09", ["B.US"], count=2),
    ]
    pages = list(
        EarningsCalendarClient(lambda: ctx, "en").pages(date(2026, 10, 9), date(2026, 10, 10))
    )
    assert [info.symbol for p in pages for g in p.groups for info in g.infos] == ["A.US", "B.US"]
    assert parse_qs(urlparse(ctx.request.call_args.args[1]).query)["offset"] == ["1"]


@pytest.mark.parametrize("next_date", [None, "", "2026-10-11"])
def test_calendar_stops_at_empty_or_out_of_window_cursor(next_date):
    ctx = Mock()
    ctx.request.return_value = page("2026-10-09", ["A.US"], next_date)
    assert (
        len(
            list(
                EarningsCalendarClient(lambda: ctx, "en").pages(
                    date(2026, 10, 9), date(2026, 10, 10)
                )
            )
        )
        == 1
    )
    assert ctx.request.call_count == 1


@pytest.mark.parametrize(
    "response,message",
    [
        (page("2026-10-09", ["A.US"], "bad-date"), "Invalid"),
        (page("2026-10-09", ["A.US"], "2026-10-08"), "backwards"),
        (page("2026-10-09", [], "2026-10-09"), "empty"),
        (page("2026-10-09", ["A.US"], count=2), "incomplete"),
        (page("2026-10-09", ["A.US"], "2026-10-11", count=2), "incomplete"),
    ],
)
def test_bad_cursor_or_truncated_page_is_never_reported_as_complete(response, message):
    ctx = Mock()
    ctx.request.return_value = response
    pages = EarningsCalendarClient(lambda: ctx, "en").pages(date(2026, 10, 9), date(2026, 10, 10))
    assert next(pages).groups[0].date == "2026-10-09"
    with pytest.raises(LongbridgeUnavailableError, match=message):
        next(pages)


def test_repeated_page_does_not_loop_forever():
    ctx = Mock()
    ctx.request.return_value = page("2026-10-09", ["A.US"], "2026-10-09")
    with pytest.raises(LongbridgeUnavailableError, match="did not advance"):
        list(EarningsCalendarClient(lambda: ctx, "en").pages(date(2026, 10, 9), date(2026, 10, 10)))
    assert ctx.request.call_count == 2


def test_overlapping_boundary_page_can_finish_without_a_false_failure():
    ctx = Mock()
    ctx.request.side_effect = [
        page("2026-10-10", ["CRDO.US"], "2026-10-10"),
        page("2026-10-10", ["CRDO.US"]),
    ]
    events, _, issues = EarningsRadarService._calendar(
        EarningsCalendarClient(lambda: ctx, "en"),
        ["CRDO.US"],
        date(2026, 10, 9),
        date(2026, 10, 10),
        date(2026, 10, 9),
    )
    assert len(events["CRDO.US"]) == 1
    assert issues == []


def test_pagination_limit_does_not_silently_truncate(monkeypatch):
    monkeypatch.setattr("app.core.earnings.calendar.RADAR_CALENDAR_MAX_PAGES", 1)
    ctx = Mock()
    ctx.request.return_value = page("2026-10-09", ["A.US"], "2026-10-10")
    with pytest.raises(LongbridgeUnavailableError, match="limit reached"):
        list(EarningsCalendarClient(lambda: ctx, "en").pages(date(2026, 10, 9), date(2026, 10, 10)))


@pytest.mark.parametrize("today", [date(2026, 10, 9), date(2026, 10, 12)])
def test_failure_on_later_page_preserves_events_and_marks_the_affected_window(today):
    ctx = Mock()
    ctx.request.side_effect = [
        page("2026-10-09", ["CRDO.US"], "2026-10-10"),
        RuntimeError("private upstream failure"),
    ]
    events, _, issues = EarningsRadarService._calendar(
        EarningsCalendarClient(lambda: ctx, "en"),
        ["CRDO.US"],
        date(2026, 10, 9),
        date(2026, 10, 10),
        today,
    )
    assert len(events["CRDO.US"]) == 1
    assert issues == [
        "upcoming_calendar_unavailable" if today.day == 9 else "history_calendar_unavailable"
    ]


@pytest.mark.parametrize(
    "label,expected",
    [
        ("Today 2026.10.09 (EST)", date(2026, 10, 9)),
        ("今天 2026.10.09 (美东)", date(2026, 10, 9)),
        ("2026-10-09", date(2026, 10, 9)),
        ("2026.02.30", None),
        ("Unknown", None),
    ],
)
def test_localized_event_dates(label, expected):
    assert _event_date(label) == expected


def test_raw_calendar_parses_legacy_symbols_estimates_and_null_optional_fields():
    ctx = Mock()
    response = page("2026-10-09", ["CRDO.US"])
    info = response["list"][0]["infos"][0]
    info["counter_id"] = "ST/US/CRDO"
    del info["symbol"]
    info.update(date_type=None, currency=None, data_kv=[{"type": "estimate_eps", "value": "1.2"}])
    ctx.request.return_value = response
    result = list(
        EarningsCalendarClient(lambda: ctx, "zh").pages(date(2026, 10, 9), date(2026, 10, 9))
    )
    event = result[0].groups[0].infos[0]
    assert event.symbol == "CRDO.US"
    assert event.currency == event.date_type == ""
    assert event.data_kv[0].value_type == "estimate_eps"
    assert ctx.request.call_args.kwargs["headers"] == {"Accept-Language": "zh-CN"}


def test_scan_collects_latest_twelve_historical_reactions_from_later_pages(monkeypatch):
    import app.core.earnings.service as module

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 10, 9, 15, tzinfo=UTC)

    # 合成财报日期及价格仅用于回归；每段第一页均被其他股票占满。
    past = [date(2025, 1, 1) + timedelta(days=35 * i) for i in range(13)]
    future = date(2026, 10, 12)
    http = Mock()

    def response(method, path, *, headers):
        query = parse_qs(urlparse(path).query)
        start, end = (date.fromisoformat(query[key][0]) for key in ("date", "date_end"))
        targets = [day for day in [*past, future] if start <= day <= end]
        if not targets:
            return {"list": [], "next_date": ""}
        target = min(targets)
        if start == target:
            return page(target.isoformat(), ["CRDO.US"])
        return page(start.isoformat(), [f"OTHER{i}.US" for i in range(100)], target.isoformat())

    http.request.side_effect = response
    factory = Mock(return_value=http)
    monkeypatch.setattr(module, "create_http_client", factory)
    monkeypatch.setattr(module, "datetime", Clock)
    quote = Mock()
    quote.option_chain_expiry_date_list.return_value = []
    get_context = Mock(return_value=quote)
    monkeypatch.setattr(module, "get_cached_context", get_context)
    market = Mock()
    market.get_realtime_quotes.return_value = NS(
        quotes=[NS(symbol="CRDO.US", last_done="100", timestamp=Clock.now().timestamp())]
    )
    market.get_history_candlesticks.return_value = NS(
        bars=[
            NS(
                timestamp=datetime.combine(day + timedelta(days=offset), datetime.min.time(), UTC)
                .replace(hour=20)
                .timestamp(),
                close=close,
            )
            for day in past
            for offset, close in [(0, "100"), (1, "110")]
        ]
    )
    settings = Settings(app_language="en")
    result = EarningsRadarService(market).scan(EarningsRadarRequest(symbols=["CRDO"]), settings)
    item = result.items[0]
    assert item.sample_count == 12
    assert [move.date for move in item.history] == past[-12:]
    assert item.historical_median_pct == 10
    assert item.next_event.date == future
    assert item.name == "CRDO.US"
    assert not {
        "history_calendar_unavailable",
        "upcoming_calendar_unavailable",
        "insufficient_history",
    } & set(item.issues)
    assert all(call.kwargs["settings"] is settings for call in factory.call_args_list)
    get_context.assert_called_once_with("QuoteContext", settings=settings)


def test_http_client_uses_effective_apikey_credentials_and_endpoint():
    settings = Settings(
        longbridge_app_key="user-key",
        longbridge_app_secret="user-secret",
        longbridge_access_token="user-token",
        longbridge_http_url="https://fixture.invalid",
    )
    with patch("longbridge.openapi.HttpClient") as sdk:
        assert create_http_client(settings) is sdk.from_apikey.return_value
        sdk.from_apikey.assert_called_once_with(
            "user-key", "user-secret", "user-token", http_url="https://fixture.invalid"
        )
        sdk.from_apikey_env.assert_not_called()


def test_http_client_reuses_oauth_and_never_falls_back_to_other_account():
    settings = Settings(longbridge_auth_mode="oauth", longbridge_oauth_client_id="user-client")
    handle = object()
    with (
        patch("app.core.market.longbridge_oauth.get_oauth", return_value=handle) as oauth,
        patch("longbridge.openapi.HttpClient") as sdk,
    ):
        assert create_http_client(settings) is sdk.from_oauth.return_value
        sdk.from_oauth.assert_called_once_with(handle, http_url=None)
        oauth.assert_called_once_with(settings)
        oauth.side_effect = LongbridgeUnavailableError("please authorize")
        with pytest.raises(LongbridgeUnavailableError):
            create_http_client(settings)
        sdk.from_apikey.assert_not_called()
        sdk.from_apikey_env.assert_not_called()


def test_http_client_environment_fallback_hides_upstream_secrets():
    with patch("longbridge.openapi.HttpClient") as sdk:
        assert create_http_client(Settings()) is sdk.from_apikey_env.return_value
        sdk.from_apikey_env.side_effect = RuntimeError("private token")
        with pytest.raises(LongbridgeUnavailableError, match="not configured") as error:
            create_http_client(Settings())
        assert "private token" not in str(error.value)
