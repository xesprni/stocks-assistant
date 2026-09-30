import asyncio
from datetime import UTC, date, datetime, timedelta
from functools import lru_cache
from threading import Event
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy import text

from app import deps
from app.config import Settings
from app.core.portfolio.close_schedule import market_close_at
from app.core.portfolio.service import PortfolioService
from app.core.portfolio.snapshot_scheduler import PortfolioSnapshotScheduler
from app.core.portfolio.snapshot_service import PortfolioSnapshotService
from app.schemas.market_data import Candle, HistoryCandlesticks, TradingDays
from app.schemas.portfolio import PortfolioItemCreate, PortfolioItemUpdate


class FakeMarket:
    def __init__(self):
        self.holiday = False
        self.half_day = False
        self.price = "123.45"
        self.day_offset = 0
        self.calendar_calls = []
        self.price_calls = []
        self.on_price = lambda: None

    def get_trading_days(self, market, begin, end, settings):
        self.calendar_calls.append((market, begin, settings))
        return TradingDays(
            source="fixture",
            market=market,
            begin=begin,
            end=end,
            trading_days=[] if self.holiday or self.half_day else [begin],
            half_trading_days=[begin] if self.half_day else [],
        )

    def get_history_candlesticks(self, symbol, **options):
        self.price_calls.append((symbol, options))
        self.on_price()
        timestamp = datetime.fromisoformat(options["start"] + "T14:30:00+00:00")
        timestamp += timedelta(days=self.day_offset)
        bars = (
            []
            if self.price is None
            else [
                Candle(
                    timestamp=int(timestamp.timestamp()),
                    open=self.price,
                    high=self.price,
                    low=self.price,
                    close=self.price,
                    volume="1",
                    turnover="1",
                )
            ]
        )
        return HistoryCandlesticks(
            source="fixture",
            symbol=symbol,
            period="1D",
            start=options["start"],
            end=options["end"],
            adjust_type="none",
            trade_sessions="intraday",
            bars=bars,
        )


def setup_portfolio(tmp_path, market="US", user="alice"):
    portfolio = PortfolioService(str(tmp_path))
    portfolio.save_settings(market, "100.12", user)
    symbol = {"US": "MSFT.US", "A": "600519.SH", "H": "700.HK"}[market]
    item = portfolio.add_item(
        PortfolioItemCreate(market=market, symbol=symbol, shares="2.5", cost_price="10"), user
    )
    quotes = FakeMarket()
    service = PortfolioSnapshotService(portfolio, quotes)
    settings = Settings(workspace_dir=str(tmp_path), longbridge_app_key="alice-key")
    return portfolio, quotes, service, settings, item


@pytest.mark.parametrize(
    "market,summer,winter,half",
    [
        ("US", "20:00", "21:00", "17:00"),
        ("H", "08:10", "08:10", "04:10"),
        ("A", "07:00", "07:00", "07:00"),
    ],
)
def test_close_schedule_uses_exchange_timezones_and_half_days(market, summer, winter, half):
    for day, partial, expected in [
        (date(2026, 7, 6), False, summer),
        (date(2026, 12, 7), False, winter),
        (date(2026, 7, 6), True, half),
    ]:
        assert (
            market_close_at(market, day, half_day=partial).astimezone(UTC).strftime("%H:%M")
            == expected
        )


@pytest.mark.parametrize(
    "market,now",
    [
        ("US", "2026-09-30T20:05:00+00:00"),
        ("H", "2026-09-30T08:15:00+00:00"),
        ("A", "2026-09-30T07:05:00+00:00"),
    ],
)
def test_closing_snapshots_persist_without_a_browser_and_do_not_overwrite(tmp_path, market, now):
    portfolio, quotes, service, settings, _ = setup_portfolio(tmp_path, market)
    moment = datetime.fromisoformat(now)
    assert service.capture_due("alice", settings, moment - timedelta(seconds=1)) == []
    (snapshot,) = service.capture_due("alice", settings, moment)
    assert snapshot.total_assets == "408.74"
    assert snapshot.total_capital == "100.12"
    assert snapshot.equity_value == "308.62"
    assert snapshot.date == "2026-09-30"
    assert quotes.price_calls[0][1]["adjust_type"] == "none"
    assert quotes.price_calls[0][1]["trade_sessions"] == "intraday"
    assert quotes.price_calls[0][1]["settings"] is settings
    quotes.price = "900"
    assert service.capture_due("alice", settings, moment) == []
    reopened = PortfolioService(str(tmp_path))
    restarted = PortfolioSnapshotService(reopened, quotes)
    assert restarted.capture_due("alice", settings, moment + timedelta(hours=1)) == []
    assert reopened.repository.list_asset_snapshots(market, "alice") == [snapshot]
    assert reopened.repository.list_asset_snapshots(market, "bob") == []
    assert len(quotes.price_calls) == 1


@pytest.mark.parametrize(
    "market,now",
    [
        ("US", "2026-11-27T18:05:00+00:00"),
        ("H", "2026-12-24T04:15:00+00:00"),
    ],
)
def test_half_day_calendar_and_market_local_date(tmp_path, market, now):
    _, quotes, service, settings, _ = setup_portfolio(tmp_path, market)
    quotes.half_day = True
    moment = datetime.fromisoformat(now)
    assert service.capture_due("alice", settings, moment - timedelta(minutes=1)) == []
    (snapshot,) = service.capture_due("alice", settings, moment)
    assert snapshot.date == now[:10]


def test_holidays_and_inactive_hours_never_record_a_snapshot(tmp_path):
    portfolio, quotes, service, settings, _ = setup_portfolio(tmp_path)
    quotes.holiday = True
    now = datetime.fromisoformat("2026-09-30T16:00:00+00:00")
    assert service.capture_due("alice", settings, now) == []
    assert quotes.calendar_calls == []
    now = datetime.fromisoformat("2026-09-30T21:00:00+00:00")
    assert service.capture_due("alice", settings, now) == []
    assert service.capture_due("alice", settings, now) == []
    assert len(quotes.calendar_calls) == 1
    assert not quotes.price_calls
    assert not portfolio.repository.list_asset_snapshots("US", "alice")


@pytest.mark.parametrize("price,day_offset", [(None, 0), ("NaN", 0), ("-1", 0), ("100", -1)])
def test_missing_invalid_or_stale_closes_retry_without_saving_cost_basis(
    tmp_path, price, day_offset
):
    portfolio, quotes, service, settings, _ = setup_portfolio(tmp_path)
    now = datetime.fromisoformat("2026-09-30T20:05:00+00:00")
    quotes.price, quotes.day_offset = price, day_offset
    assert service.capture_due("alice", settings, now) == []
    assert not portfolio.repository.list_asset_snapshots("US", "alice")
    quotes.price, quotes.day_offset = "123.45", 0
    (snapshot,) = service.capture_due("alice", settings, now + timedelta(minutes=1))
    assert snapshot.total_assets == "408.74"


def test_us_snapshot_uses_trading_date_even_after_midnight_in_hong_kong(tmp_path):
    _, _, service, settings, _ = setup_portfolio(tmp_path)
    (snapshot,) = service.capture_due(
        "alice", settings, datetime.fromisoformat("2026-10-01T04:05:00+08:00")
    )
    assert snapshot.date == "2026-09-30"


def test_user_settings_calendar_cache_and_cash_only_snapshots(tmp_path):
    portfolio, quotes, service, settings, _ = setup_portfolio(tmp_path)
    portfolio.save_settings("US", "25.01", "bob")
    now = datetime.fromisoformat("2026-09-30T20:05:00+00:00")
    (snapshot,) = service.capture_due("bob", settings, now)
    assert snapshot.total_assets == "25.01"
    assert snapshot.equity_value == "0.00"
    assert not quotes.price_calls
    assert not portfolio.repository.list_asset_snapshots("US", "alice")
    assert service.capture_due("nobody", settings, now) == []
    quotes.holiday = True
    assert service.capture_due("alice", settings, now) == []
    quotes.holiday = False
    replacement = settings.model_copy(update={"longbridge_app_key": "new-key"})
    assert len(service.capture_due("alice", replacement, now)) == 1
    assert quotes.calendar_calls[-1][2] is replacement


def test_portfolio_changes_during_price_lookup_are_retried_atomically(tmp_path):
    portfolio, quotes, service, settings, item = setup_portfolio(tmp_path)
    now = datetime.fromisoformat("2026-09-30T20:05:00+00:00")
    quotes.on_price = lambda: portfolio.update_item(
        item.id, PortfolioItemUpdate(shares="3"), "alice"
    )
    assert service.capture_due("alice", settings, now) == []
    assert not portfolio.repository.list_asset_snapshots("US", "alice")
    quotes.on_price = lambda: None
    (snapshot,) = service.capture_due("alice", settings, now)
    assert snapshot.total_assets == "470.47"
    # 快照表唯一键抵御多进程同时完成的重复采集，不覆盖首个成功值。
    portfolio.repository.save_asset_snapshot(
        snapshot.model_copy(update={"total_assets": "999"}),
        "alice",
        expected=portfolio.get_local_snapshot("US", "alice"),
    )
    assert portfolio.repository.list_asset_snapshots("US", "alice") == [snapshot]


def test_missing_shares_and_shutdown_never_save_partial_values(tmp_path):
    portfolio, quotes, service, settings, item = setup_portfolio(tmp_path)
    now = datetime.fromisoformat("2026-09-30T20:05:00+00:00")
    portfolio.update_item(item.id, PortfolioItemUpdate(shares=None), "alice")
    assert service.capture_due("alice", settings, now) == []
    portfolio.update_item(item.id, PortfolioItemUpdate(shares="3"), "alice")
    stop = Event()
    quotes.on_price = stop.set
    assert service.capture_due("alice", settings, now, stop) == []
    assert not portfolio.repository.list_asset_snapshots("US", "alice")


def test_schema_upgrade_preserves_holdings_and_api_response_contains_history(tmp_path, monkeypatch):
    portfolio, _, service, settings, item = setup_portfolio(tmp_path)
    with portfolio.repository.engine.begin() as connection:
        connection.execute(text("DROP TABLE portfolio_asset_snapshots"))
    portfolio = PortfolioService(str(tmp_path))
    assert portfolio.get_item(item.id, "alice").shares == "2.5"
    service.portfolio = portfolio
    service.capture_due("alice", settings, datetime.fromisoformat("2026-09-30T20:05:00+00:00"))
    monkeypatch.setattr(portfolio, "_fetch_live_data", lambda *args, **kwargs: ({}, {}))
    result = portfolio.list_items("US", "alice")
    assert result.valuation_complete is False
    assert len(result.asset_snapshots) == 1
    assert result.asset_snapshots[0].total_assets == "408.74"
    assert "user_id" not in result.asset_snapshots[0].model_dump()


def test_background_poll_uses_active_users_and_effective_settings(monkeypatch):
    from app.core import app_store

    records = [
        {"id": name, "username": name, "is_active": active, "permissions": permissions}
        for name, active, permissions in [
            ("alice", True, ["portfolio:read"]),
            ("bob", False, ["portfolio:read"]),
            ("charlie", True, []),
            ("dana", True, ["portfolio:read"]),
        ]
    ]
    monkeypatch.setattr(
        app_store, "get_app_store", lambda: SimpleNamespace(list_users=lambda: records)
    )
    service = Mock()
    monkeypatch.setattr(deps, "get_portfolio_snapshot_service", lambda: service)
    settings = {"alice": Settings(), "dana": Settings()}
    monkeypatch.setattr(deps, "get_effective_settings", settings.__getitem__)
    deps._capture_portfolio_snapshots(Event())
    assert [call.args[:2] for call in service.capture_due.call_args_list] == [
        ("alice", settings["alice"]),
        ("dana", settings["dana"]),
    ]


def test_scheduler_starts_once_and_signals_shutdown_during_capture():
    async def run():
        called = asyncio.Event()
        loop = asyncio.get_running_loop()
        received_stops = []

        def capture(stop):
            received_stops.append(stop)
            loop.call_soon_threadsafe(called.set)
            assert stop.wait(2)

        scheduler = PortfolioSnapshotScheduler(capture)
        await scheduler.start()
        await scheduler.start()
        await asyncio.wait_for(called.wait(), timeout=2)
        await scheduler.stop()
        assert len(received_stops) == 1
        assert received_stops[0].is_set()

    asyncio.run(run())


def test_lifespan_collects_snapshots_when_agent_scheduler_is_disabled(tmp_path, monkeypatch):
    from fastapi import FastAPI

    import app.core.agent.run_service as runs
    import app.main as main

    called = Event()
    scheduler = PortfolioSnapshotScheduler(lambda stop: called.set())

    @lru_cache
    def factory():
        return scheduler

    monkeypatch.setattr(deps, "get_portfolio_snapshot_scheduler", factory)
    monkeypatch.setattr(runs, "chat_runs", runs.ChatRunManager())
    monkeypatch.setattr(main, "setup_logging", lambda **kwargs: None)
    monkeypatch.setattr(
        main,
        "get_settings",
        lambda: Settings(workspace_dir=str(tmp_path), scheduler_enabled=False, mcp_servers={}),
    )

    async def run():
        async with main.lifespan(FastAPI()):
            assert await asyncio.to_thread(called.wait, 2)
        assert scheduler._task is None
        assert factory.cache_info().currsize == 0

    asyncio.run(run())
