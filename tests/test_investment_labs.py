import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from zoneinfo import ZoneInfo

from app.core.labs.service import InvestmentLabService, _number
from app.core.portfolio.service import PortfolioService
from app.core.research.service import ResearchService
from app.schemas.labs import GreaterChinaRequest, PeerComparisonRequest, PortfolioLabRequest, ValuationModelCreate
from app.schemas.portfolio import PortfolioItemCreate
from app.schemas.research import ThesisPayload, ThesisSnapshotCreate


class FakePortfolio:
    def list_items(self, market, user_id=None, settings=None):
        if market != "US":
            return {"market": market, "total_capital": "0", "items": [], "quote_error": None}
        return {
            "market": market,
            "total_capital": "100",
            "quote_error": None,
            "items": [
                {"symbol": "AAA.US", "market": "US", "shares": "10", "cost_price": "10", "current_price": "12", "stock_value": "120", "currency": "USD"},
                {"symbol": "BBB.US", "market": "US", "shares": "5", "cost_price": "20", "current_price": "18", "stock_value": "90", "currency": "USD"},
            ],
        }


class FakeMarket:
    def get_candlesticks(self, symbol, period, count, settings=None):
        values, price = [], 100.0
        for index in range(40):
            base = 1.01 if symbol != "BBB.US" else 0.995
            multiplier = base + (0.003 if index % 2 else -0.002)
            price *= multiplier
            values.append({"timestamp": 1_700_000_000 + index * 86_400, "close": str(price)})
        return {"bars": values}

    def get_security_static_info(self, symbols, settings=None):
        return [{"symbol": symbols[0], "name_cn": "腾讯控股", "currency": "HKD", "lot_size": "100", "board": "MainBoard"}]


class FakeFundamentals:
    def get_security_insights(self, symbol, settings=None):
        value = 20 if symbol.startswith("AAA") or symbol.startswith("00700") else 30
        return {
            "symbol": symbol,
            "source": "Longbridge",
            "fetched_at": "2026-08-17T00:00:00Z",
            "valuation": {"pe_ttm_ratio": value, "pb_ratio": value / 10, "market_cap": value * 100},
            "company": {"name": symbol},
            "filings": {"items": []},
            "dividends": {"items": []},
            "institution_rating": {"items": []},
            "corporate_actions": {"items": []},
        }


class SingleHoldingPortfolio:
    def list_items(self, market, user_id=None, settings=None):
        if market != "US":
            return {"market": market, "total_capital": "0", "items": [], "quote_error": None}
        return {
            "market": "US",
            "total_capital": "100",
            "quote_error": None,
            "items": [
                {
                    "symbol": "AAA.US",
                    "market": "US",
                    "shares": "1",
                    "cost_price": "100",
                    "current_price": "100",
                    "stock_value": "100",
                    "currency": "USD",
                }
            ],
        }


class TwoBarMarket:
    def get_candlesticks(self, symbol, period, count, settings=None):
        second = "110" if symbol == "AAA.US" else "100"
        return {
            "bars": [
                {"timestamp": 1_700_000_000, "close": "100"},
                {"timestamp": 1_700_086_400, "close": second},
            ]
        }


class CrossCurrencyPortfolio:
    def list_items(self, market, user_id=None, settings=None):
        if market == "US":
            return {
                "market": market,
                "total_capital": "0",
                "quote_error": None,
                "items": [{"symbol": "AAA.US", "shares": "1", "current_price": "100", "stock_value": "100", "currency": "USD"}],
            }
        if market == "H":
            return {
                "market": market,
                "total_capital": "0",
                "quote_error": None,
                "items": [{"symbol": "700.HK", "shares": "1", "current_price": "780", "stock_value": "780", "currency": "HKD"}],
            }
        return {"market": market, "total_capital": "0", "quote_error": None, "items": []}


class NestedMetricFundamentals:
    def get_security_insights(self, symbol, settings=None):
        value = 20 if symbol == "AAA.US" else 30
        return {
            "source": "Longbridge",
            "fetched_at": "2026-08-17T00:00:00Z",
            "valuation": {
                "data": {
                    "metrics": {
                        "pe": [{"date": "2025-01-01", "value": value - 1}, {"date": "2026-01-01", "value": value}],
                        "pb": {"2026-01-01": {"value": value / 10}},
                        "ps": [{"value": value / 5}],
                    }
                }
            },
            "company": {"data": {"name": symbol}},
        }


class InvestmentLabsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.research = ResearchService(self.tmp.name)
        self.research.create_thesis(
            "user-1",
            "AAA.US",
            ThesisSnapshotCreate(payload=ThesisPayload(confidence=0.7, risks=["Demand"]), reason="Baseline"),
        )
        self.service = InvestmentLabService(
            self.tmp.name,
            portfolio_service=FakePortfolio(),
            market_service=FakeMarket(),
            fundamental_service=FakeFundamentals(),
            research_service=self.research,
        )

    def tearDown(self):
        self.tmp.cleanup()

    def test_portfolio_lab_calculates_risk_contribution_scenario_and_thesis_links(self):
        result = self.service.analyze_portfolio(
            "user-1",
            PortfolioLabRequest(
                markets=["US"],
                benchmark_symbol="SPY.US",
                lookback_days=60,
                scenario_shocks={"AAA.US": -0.1, "market:US": -0.05},
                target_weights={"AAA.US": 0.4},
                cash_flows=[{"date": "2025-01-01T00:00:00+00:00", "amount": -200}],
            ),
        )
        self.assertGreater(result["metrics"]["annualized_volatility"], 0)
        self.assertIsNotNone(result["metrics"]["money_weighted_irr"])
        self.assertEqual(2, result["coverage"]["history_available"])
        self.assertLess(result["scenario"]["estimated_return"], 0)
        self.assertEqual("AAA.US", result["contribution"][0]["symbol"])
        self.assertIsNotNone(result["thesis_links"][0]["thesis_snapshot_id"])
        self.assertEqual("current_weight_historical_replay", result["methodology"])

    def test_portfolio_return_keeps_cash_as_zero_return_weight(self):
        service = InvestmentLabService(
            self.tmp.name,
            portfolio_service=SingleHoldingPortfolio(),
            market_service=TwoBarMarket(),
            fundamental_service=FakeFundamentals(),
            research_service=self.research,
        )
        result = service.analyze_portfolio(
            "user-1",
            PortfolioLabRequest(markets=["US"], benchmark_symbol="SPY.US", lookback_days=30),
        )

        self.assertAlmostEqual(0.5, result["metrics"]["cash_weight"])
        self.assertAlmostEqual(0.05, result["metrics"]["simulated_twr"])
        self.assertAlmostEqual(
            result["metrics"]["simulated_twr"],
            sum(item["return_contribution"] for item in result["contribution"]),
        )

    def test_cross_market_daily_returns_align_by_local_trading_date(self):
        us = ZoneInfo("America/New_York")
        hk = ZoneInfo("Asia/Hong_Kong")
        us_bars = [
            {"timestamp": int(datetime(2026, 1, 2, 16, tzinfo=us).timestamp()), "close": "100"},
            {"timestamp": int(datetime(2026, 1, 5, 16, tzinfo=us).timestamp()), "close": "110"},
        ]
        hk_bars = [
            {"timestamp": int(datetime(2026, 1, 2, 16, tzinfo=hk).timestamp()), "close": "200"},
            {"timestamp": int(datetime(2026, 1, 5, 16, tzinfo=hk).timestamp()), "close": "220"},
        ]

        us_returns = self.service._returns_from_bars(us_bars, "AAA.US")
        hk_returns = self.service._returns_from_bars(hk_bars, "700.HK")

        self.assertEqual(set(us_returns), set(hk_returns))
        self.assertEqual(1, len(us_returns))

    def test_cross_currency_values_require_and_apply_explicit_fx_rates(self):
        service = InvestmentLabService(
            self.tmp.name,
            portfolio_service=CrossCurrencyPortfolio(),
            market_service=TwoBarMarket(),
            fundamental_service=FakeFundamentals(),
            research_service=self.research,
        )
        with self.assertRaisesRegex(ValueError, "Missing FX rates for HKD"):
            service.analyze_portfolio(
                "user-1",
                PortfolioLabRequest(markets=["US", "H"], benchmark_symbol="SPY.US", lookback_days=30),
            )

        result = service.analyze_portfolio(
            "user-1",
            PortfolioLabRequest(
                markets=["US", "H"],
                benchmark_symbol="SPY.US",
                lookback_days=30,
                fx_rates={"HKD": 1 / 7.8},
            ),
        )
        self.assertAlmostEqual(200, result["total_value"])
        self.assertAlmostEqual(0.5, result["exposures"]["currency"]["USD"])
        self.assertAlmostEqual(0.5, result["exposures"]["currency"]["HKD"])

    def test_dcf_and_reverse_dcf_models_are_versioned(self):
        assumptions = {
            "revenue": 1000,
            "fcf_margin": 0.2,
            "revenue_growth": 0.08,
            "wacc": 0.1,
            "terminal_growth": 0.03,
            "shares_outstanding": 100,
            "cash": 50,
            "debt": 20,
            "years": 5,
        }
        first = self.service.create_valuation_model(
            "user-1", "AAA.US", ValuationModelCreate(title="Base DCF", assumptions=assumptions, reason="Initial")
        )
        second = self.service.create_valuation_model(
            "user-1",
            "AAA.US",
            ValuationModelCreate(model_id=first["id"], title="Base DCF", assumptions={**assumptions, "revenue_growth": 0.1}, reason="Update"),
        )
        reverse = self.service.create_valuation_model(
            "user-1",
            "AAA.US",
            ValuationModelCreate(title="Reverse", model_type="reverse_dcf", assumptions={**assumptions, "target_price": 30}),
        )
        self.assertGreater(first["result"]["value_per_share"], 0)
        self.assertEqual(2, second["version"])
        self.assertIn("implied_revenue_growth", reverse["result"])

    def test_valuation_rejects_unreachable_reverse_dcf_and_cross_symbol_thesis(self):
        assumptions = {
            "revenue": 1000,
            "fcf_margin": "20%",
            "revenue_growth": "8%",
            "wacc": "10%",
            "terminal_growth": "3%",
            "shares_outstanding": 100,
            "years": 5,
        }
        self.assertEqual(0.1, _number("10%"))
        with self.assertRaisesRegex(ValueError, "outside the solvable growth range"):
            self.service._calculate_valuation("reverse_dcf", {**assumptions, "target_price": 1_000_000_000})
        with self.assertRaisesRegex(ValueError, "finite non-negative"):
            self.service._calculate_valuation("dcf", {**assumptions, "cash": float("nan")})
        with self.assertRaisesRegex(ValueError, "whole number"):
            self.service._calculate_valuation("dcf", {**assumptions, "years": 5.5})

        other_thesis = self.research.create_thesis(
            "user-1",
            "BBB.US",
            ThesisSnapshotCreate(payload=ThesisPayload(confidence=0.5), reason="Other company"),
        )
        with self.assertRaisesRegex(ValueError, "different symbol"):
            self.service.create_valuation_model(
                "user-1",
                "AAA.US",
                ValuationModelCreate(title="Bad link", assumptions=assumptions, thesis_snapshot_id=other_thesis["id"]),
            )

    def test_concurrent_valuation_versions_are_allocated_atomically(self):
        assumptions = {
            "revenue": 1000,
            "fcf_margin": 0.2,
            "revenue_growth": 0.08,
            "wacc": 0.1,
            "terminal_growth": 0.03,
            "shares_outstanding": 100,
            "years": 5,
        }
        first = self.service.create_valuation_model(
            "user-1", "AAA.US", ValuationModelCreate(title="Concurrent", assumptions=assumptions)
        )

        def save_version(index):
            return self.service.create_valuation_model(
                "user-1",
                "AAA.US",
                ValuationModelCreate(
                    model_id=first["id"],
                    title=f"Concurrent {index}",
                    assumptions={**assumptions, "revenue_growth": 0.08 + index / 1000},
                ),
            )["version"]

        with ThreadPoolExecutor(max_workers=5) as executor:
            versions = sorted(executor.map(save_version, range(5)))
        self.assertEqual([2, 3, 4, 5, 6], versions)

    def test_peer_comparison_and_greater_china_context_keep_sources(self):
        peers = self.service.compare_peers(PeerComparisonRequest(symbols=["AAA.US", "BBB.US"]))
        context = self.service.greater_china_context(GreaterChinaRequest(symbol="00700.HK", paired_symbol="AAA.US"))
        self.assertEqual(25, peers["medians"]["pe_ttm_ratio"])
        self.assertTrue(all(row["fetched_at"] for row in peers["rows"]))
        self.assertEqual("HK", context["market"])
        self.assertEqual("700.HK", context["symbol"])
        self.assertEqual("HKD", context["currency"])
        self.assertIsNotNone(context["paired_comparison"])

    def test_peer_comparison_reads_longbridge_nested_metric_series(self):
        self.service.fundamentals = NestedMetricFundamentals()
        peers = self.service.compare_peers(PeerComparisonRequest(symbols=["AAA.US", "BBB.US"]))

        self.assertEqual(25, peers["medians"]["pe_ttm_ratio"])
        self.assertEqual(2.5, peers["medians"]["pb_ratio"])
        self.assertEqual(5, peers["medians"]["ps_ttm_ratio"])
        self.assertTrue(all(row["available"] for row in peers["rows"]))
        with self.assertRaisesRegex(ValueError, "distinct canonical symbols"):
            self.service.compare_peers(PeerComparisonRequest(symbols=["700.HK", "00700.HK"]))

    def test_hong_kong_portfolio_market_is_persisted(self):
        service = PortfolioService(self.tmp.name)
        item = service.add_item(
            PortfolioItemCreate(market="H", symbol="700", name="Tencent", shares="10", cost_price="300"), user_id="user-1"
        )
        self.assertEqual("700.HK", item["symbol"])
        updated = service.add_item(
            PortfolioItemCreate(market="H", symbol="00700.HK", name="腾讯控股", shares="20", cost_price="310"),
            user_id="user-1",
        )
        self.assertEqual(item["id"], updated["id"])
        self.assertEqual("700.HK", updated["symbol"])
        self.assertEqual(1, len(service.repository.list_items("H", user_id="user-1")))


if __name__ == "__main__":
    unittest.main()
