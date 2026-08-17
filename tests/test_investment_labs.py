import tempfile
import unittest

from app.core.labs.service import InvestmentLabService
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

    def test_peer_comparison_and_greater_china_context_keep_sources(self):
        peers = self.service.compare_peers(PeerComparisonRequest(symbols=["AAA.US", "BBB.US"]))
        context = self.service.greater_china_context(GreaterChinaRequest(symbol="00700.HK", paired_symbol="AAA.US"))
        self.assertEqual(25, peers["medians"]["pe_ttm_ratio"])
        self.assertTrue(all(row["fetched_at"] for row in peers["rows"]))
        self.assertEqual("HK", context["market"])
        self.assertEqual("HKD", context["currency"])
        self.assertIsNotNone(context["paired_comparison"])

    def test_hong_kong_portfolio_market_is_persisted(self):
        service = PortfolioService(self.tmp.name)
        item = service.add_item(
            PortfolioItemCreate(market="H", symbol="700", name="Tencent", shares="10", cost_price="300"), user_id="user-1"
        )
        self.assertEqual("00700.HK", item["symbol"])
        self.assertEqual(1, len(service.repository.list_items("H", user_id="user-1")))


if __name__ == "__main__":
    unittest.main()
