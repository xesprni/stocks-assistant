"""Behavioral regressions for domain transaction, policy and storage boundaries."""

from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier

import pytest
from sqlalchemy import event

from app.core.market.config_repository import MarketConfigError, MarketConfigRepository
from app.core.market.service import MarketService
from app.core.orm.models.portfolio import PortfolioTransaction
from app.core.portfolio.service import PortfolioService
from app.core.portfolio.valuation import (
    CostBasisValuation,
    HistoricalDisplayValuation,
    value_portfolio,
)
from app.schemas.portfolio import PortfolioItemCreate, PortfolioSellRequest


def holding(service, symbol="AAPL.US", shares="10"):
    return service.add_item(
        PortfolioItemCreate(market="US", symbol=symbol, shares=shares, cost_price="80"),
        user_id="reader",
    )


def test_concurrent_sales_recheck_available_shares_inside_transaction(tmp_path):
    first, second = PortfolioService(str(tmp_path)), PortfolioService(str(tmp_path))
    first.save_settings("US", "100", user_id="reader")
    item = holding(first)
    barrier = Barrier(2)

    def sell(service):
        barrier.wait(timeout=3)
        try:
            service.sell_item(item["id"], PortfolioSellRequest(shares="6", price="100"), "reader")
            return "sold"
        except ValueError as exc:
            return str(exc)

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(sell, (first, second)))
    assert sorted(results) == ["shares exceed current holding", "sold"]
    assert first.get_item(item["id"], "reader")["shares"] == "4"
    assert first.get_settings("US", "reader")["total_capital"] == "700"
    assert len(first.list_transactions("US", "reader")["transactions"]) == 1


def test_sales_of_different_holdings_accumulate_cash_across_instances(tmp_path):
    first, second = PortfolioService(str(tmp_path)), PortfolioService(str(tmp_path))
    first.save_settings("US", "100", user_id="reader")
    items = holding(first), holding(first, "MSFT.US")
    barrier = Barrier(2)

    def sell(pair):
        service, item = pair
        barrier.wait(timeout=3)
        return service.sell_item(
            item["id"], PortfolioSellRequest(shares="2", price="100"), "reader"
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        list(executor.map(sell, zip((first, second), items, strict=True)))
    assert first.get_settings("US", "reader")["total_capital"] == "500"
    assert len(first.list_transactions("US", "reader")["transactions"]) == 2
    assert [first.get_item(item["id"], "reader")["shares"] for item in items] == ["8", "8"]


def test_ledger_failure_rolls_back_holding_and_cash(tmp_path):
    service = PortfolioService(str(tmp_path))
    service.save_settings("US", "100", user_id="reader")
    item = holding(service)

    def fail_ledger(session, _context, _instances):
        if any(isinstance(row, PortfolioTransaction) for row in session.new):
            raise RuntimeError("ledger failed")

    event.listen(service.repository.session_factory, "before_flush", fail_ledger)
    try:
        with pytest.raises(RuntimeError, match="ledger failed"):
            service.sell_item(item["id"], PortfolioSellRequest(shares="2", price="100"), "reader")
    finally:
        event.remove(service.repository.session_factory, "before_flush", fail_ledger)
    assert service.get_item(item["id"], "reader")["shares"] == "10"
    assert service.get_settings("US", "reader")["total_capital"] == "100"
    assert service.list_transactions("US", "reader")["transactions"] == []


def test_local_snapshot_is_user_scoped_and_never_fetches_quotes(tmp_path, monkeypatch):
    service = PortfolioService(str(tmp_path))
    service.save_settings("US", "100", user_id="reader")
    holding(service)

    def no_quotes(*_args, **_kwargs):
        raise AssertionError("snapshot requested external quotes")

    monkeypatch.setattr(service, "_fetch_live_data", no_quotes)
    assert len(service.get_local_snapshot("US", "reader")["items"]) == 1
    assert service.get_local_snapshot("US", "other")["items"] == []


def test_explicit_policies_preserve_cost_and_historical_display_fallbacks():
    rows = [{"symbol": "AAPL.US", "shares": "10", "cost_price": "80"}]
    cost = value_portfolio(rows, {}, Decimal("100"), CostBasisValuation())
    display = value_portfolio(rows, {}, Decimal("100"), HistoricalDisplayValuation())
    assert cost.total_assets == 900
    assert cost.items[0].source == "cost"
    assert cost.items[0].pnl is None
    assert display.total_assets == 100
    assert display.items[0].stock_value is None

    history = [{**rows[0], "current_price": "90", "stock_value": "900", "pnl_ratio": "12.5%"}]
    display = value_portfolio(history, {}, Decimal("100"), HistoricalDisplayValuation())
    assert display.total_assets == 1000
    assert display.items[0].current_price == "90"
    assert display.items[0].pnl == Decimal("12.5")


@pytest.mark.parametrize("policy", [CostBasisValuation(), HistoricalDisplayValuation()])
def test_zero_quote_is_a_real_price_in_both_policies(policy):
    valuation = value_portfolio(
        [{"symbol": "AAPL.US", "shares": "10", "cost_price": "80", "current_price": "90"}],
        {"AAPL.US": {"last_done": "0"}},
        Decimal("100"),
        policy,
    )
    assert valuation.total_assets == 100
    assert valuation.items[0].stock_value == 0
    assert valuation.items[0].pnl == -100


class MemoryConfigStore:
    def __init__(self):
        self.values = {}
        self.failed = False

    def get_market_config(self, user_id):
        if self.failed:
            raise RuntimeError("storage failed")
        return self.values.get(user_id)

    def save_market_config(self, user_id, config):
        if self.failed:
            raise RuntimeError("storage failed")
        self.values[user_id] = config
        return config


def test_personal_market_storage_failures_do_not_write_global_config(tmp_path):
    store = MemoryConfigStore()
    repository = MarketConfigRepository(tmp_path / "market_config.json", lambda: store)
    service = MarketService(str(tmp_path), config_repository=repository)
    service.save_config({"refresh_interval": 42}, "reader")
    assert service.get_config("reader")["refresh_interval"] == 42
    assert service.get_config("other")["refresh_interval"] == 60
    assert not repository.legacy_path.exists()
    store.failed = True
    with pytest.raises(MarketConfigError, match="save"):
        service.save_config({"refresh_interval": 90}, "reader")
    with pytest.raises(MarketConfigError, match="read"):
        service.get_config("reader")
    assert not repository.legacy_path.exists()
    assert store.values["reader"]["refresh_interval"] == 42


def test_legacy_market_configuration_does_not_access_personal_store(tmp_path):
    def unavailable_store():
        raise AssertionError("legacy preferences accessed user store")

    repository = MarketConfigRepository(tmp_path / "market_config.json", unavailable_store)
    service = MarketService(str(tmp_path), config_repository=repository)
    service.save_config({"refresh_interval": 42})
    assert service.get_config()["refresh_interval"] == 42
    repository.legacy_path.write_text("invalid-json")
    with pytest.raises(MarketConfigError, match="read"):
        service.get_config()
