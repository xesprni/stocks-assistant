"""复现服务器 TSM 日历时段缺失和期权报价 500，不连接外部服务。"""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace as NS
from unittest.mock import Mock, patch

import pytest

from app.core.earnings.calculations import DailyClose, earnings_history
from app.core.earnings.options import OptionStrike, fetch_option_quotes
from app.core.earnings.service import EarningsRadarService
from app.core.market.errors import LongbridgeTokenExpiredError
from app.schemas.earnings import EarningsEvent


class ApiError(Exception):
    def __init__(self, code):
        super().__init__("private token must not be exposed")
        self.code = code


def test_recent_unknown_dates_do_not_disappear_or_get_replaced_by_old_reactions():
    start = date(2025, 1, 1)
    events = [EarningsEvent(date=start, timing="after_close")]
    events += [EarningsEvent(date=start + timedelta(days=i)) for i in range(1, 13)]
    bars = [DailyClose(start + timedelta(days=i), Decimal(100 + i)) for i in range(14)]
    history = earnings_history(bars, events)
    assert [entry.date for entry in history] == [event.date for event in events[1:]]
    assert all(
        entry.move is None and entry.exclusion_reason == "unknown_timing" for entry in history
    )


def test_same_day_periods_count_once_and_conflicting_times_are_not_guessed():
    day = date(2025, 1, 16)
    events = [
        EarningsEvent(date=day, timing="unknown", period="FY2024 Q4"),
        EarningsEvent(date=day, timing="after_close", period="FY2024 Annual"),
    ]
    bars = [DailyClose(day, Decimal(100)), DailyClose(day + timedelta(days=1), Decimal(110))]
    history = earnings_history(bars, events)
    assert len(history) == 1 and history[0].move.move_pct == 10
    assert history[0].period == "FY2024 Q4 / FY2024 Annual"
    events.append(EarningsEvent(date=day, timing="before_open"))
    assert earnings_history(bars, events)[0].exclusion_reason == "unknown_timing"


def test_server_tsm_recent_events_survive_missing_timing_and_failed_price_requests():
    events = [
        EarningsEvent(date=date(2025, 1, 14), timing="after_close", period="FY2024 Q4"),
        EarningsEvent(date=date(2025, 1, 16), timing="after_close", period="FY2024 Annual"),
        EarningsEvent(date=date(2025, 4, 17), period="FY2025 Q1"),
        EarningsEvent(date=date(2025, 7, 17), period="FY2025 Q2"),
        EarningsEvent(date=date(2025, 10, 16), period="FY2025 Q3"),
        EarningsEvent(date=date(2026, 1, 15), period="FY2025 Q4"),
        EarningsEvent(date=date(2026, 7, 15), period="FY2026 Q2"),
    ]
    market = Mock()
    market.get_realtime_quotes.side_effect = ApiError(500)
    market.get_history_candlesticks.side_effect = ApiError(500)
    item = EarningsRadarService(market)._analyze(
        "TSM.US",
        "",
        events,
        [],
        Mock(),
        datetime(2026, 10, 10, tzinfo=UTC),
        date(2023, 10, 9),
        date(2026, 11, 23),
        None,
    )
    assert item.status == "partial"
    assert len(item.history_events) == 7
    assert [entry.period for entry in item.history_events[:2]] == ["FY2024 Q4", "FY2024 Annual"]
    assert item.history_events[-1].date == date(2026, 7, 15)
    assert item.history_events[-1].exclusion_reason == "unknown_timing"
    assert item.history_events[0].exclusion_reason == "missing_prices"
    assert item.history == [] and item.sample_count == 0 and item.historical_median_pct is None
    assert "unknown_history_timing" in item.issues
    assert "private token" not in item.model_dump_json()


def test_quote_500_retries_same_contracts_and_keeps_success():
    ctx = Mock()
    quotes = [NS(symbol="C", last_done=Decimal(4)), NS(symbol="P", last_done=Decimal(6))]
    ctx.option_quote.side_effect = [ApiError(500), quotes]
    assert fetch_option_quotes(ctx, ["C", "P"]) == quotes
    assert ctx.option_quote.call_count == 2
    assert all(call.args == (["C", "P"],) for call in ctx.option_quote.call_args_list)


@pytest.mark.parametrize("code,calls", [(500, 2), (301604, 1), (401003, 1), (404000, 1)])
def test_quote_retries_are_bounded_and_auth_errors_keep_their_meaning(code, calls):
    ctx = Mock()
    ctx.option_quote.side_effect = ApiError(code)
    with pytest.raises(LongbridgeTokenExpiredError if code == 401003 else ApiError):
        fetch_option_quotes(ctx, ["C", "P"])
    assert ctx.option_quote.call_count == calls


@pytest.mark.parametrize("stage", ["expiry", "chain", "quote"])
def test_failed_options_keep_stage_and_code_without_exposing_exception(stage, caplog):
    ctx = Mock()
    ctx.option_chain_expiry_date_list.return_value = [date(2026, 10, 16)]
    chain = Mock(return_value=[OptionStrike(Decimal(450), "C", "P")])
    target = {
        "expiry": ctx.option_chain_expiry_date_list,
        "chain": chain,
        "quote": ctx.option_quote,
    }[stage]
    target.side_effect = ApiError(500)
    with patch("app.core.earnings.service.fetch_option_strikes", chain):
        result = EarningsRadarService._options(
            ctx,
            "TSM.US",
            Decimal("453.31"),
            date(2026, 10, 14),
            date(2026, 10, 10),
        )
    assert result.pricing is None
    assert len(result.diagnostics) == 1
    diagnostic = result.diagnostics[0]
    assert diagnostic.stage == stage and diagnostic.error_code == 500
    assert diagnostic.reason == "upstream_error"
    assert "private token" not in result.model_dump_json() + caplog.text


@pytest.mark.parametrize(
    "code,issue", [(500, "options_request_failed"), (301604, "options_permission_denied")]
)
def test_scan_does_not_describe_server_errors_as_missing_permissions(code, issue):
    market = Mock()
    market.get_realtime_quotes.return_value = NS(
        quotes=[NS(symbol="TSM.US", last_done="453.31", timestamp=None)]
    )
    market.get_history_candlesticks.return_value = NS(bars=[])
    ctx = Mock()
    ctx.option_chain_expiry_date_list.return_value = [date(2026, 10, 16), date(2026, 10, 23)]
    ctx.option_quote.side_effect = ApiError(code)
    with patch(
        "app.core.earnings.service.fetch_option_strikes",
        return_value=[OptionStrike(Decimal(450), "C", "P")],
    ):
        item = EarningsRadarService(market)._analyze(
            "TSM.US",
            "",
            [EarningsEvent(date=date(2026, 10, 14))],
            [],
            ctx,
            datetime(2026, 10, 10, tzinfo=UTC),
            date(2023, 10, 9),
            date(2026, 11, 23),
            None,
        )
    assert issue in item.issues and "options_unavailable" not in item.issues
    assert all(diagnostic.error_code == code for diagnostic in item.option_diagnostics)
    assert ctx.option_quote.call_count == (4 if code == 500 else 1)


def test_no_expiry_is_not_a_failed_request():
    ctx = Mock()
    ctx.option_chain_expiry_date_list.return_value = []
    result = EarningsRadarService._options(
        ctx,
        "TSM.US",
        Decimal(450),
        date(2026, 10, 14),
        date(2026, 10, 10),
    )
    assert result.pricing is None
    assert result.diagnostics[0].reason == "no_expiry"
    assert result.diagnostics[0].error_code is None
    ctx.option_quote.assert_not_called()
