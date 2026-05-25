import unittest
from types import SimpleNamespace

from app.core.tools.portfolio_positions import GetPortfolioPositionsTool


class FakePortfolioService:
    def __init__(self):
        self.calls = []

    def list_items(self, market, user_id=None, settings=None):
        self.calls.append((market, user_id, settings))
        return {
            "market": market,
            "total_capital": "1000",
            "total_assets": "1250.00",
            "cash_ratio": "20.00%",
            "items": [
                {
                    "id": 1,
                    "user_id": user_id,
                    "market": market,
                    "symbol": "MSFT.US" if market == "US" else "600519.SH",
                    "name": "Test Holding",
                    "shares": "10",
                    "cost_price": "100",
                    "current_price": "125",
                    "stock_value": "1250.00",
                    "position_ratio": "80.00%",
                    "pnl_ratio": "25.00%",
                    "note": "core",
                    "created_at": "2026-01-01T00:00:00",
                    "updated_at": "2026-01-01T00:00:00",
                }
            ],
            "total": 1,
            "quote_error": "quote unavailable" if market == "A" else None,
        }


class PortfolioPositionsToolTest(unittest.TestCase):
    def test_reads_all_markets_with_current_user_scope(self):
        service = FakePortfolioService()
        settings = SimpleNamespace(longbridge_app_key="demo")
        tool = GetPortfolioPositionsTool(portfolio_service=service, user_id="user-1", settings=settings)

        result = tool.execute({"market": "ALL"})

        self.assertEqual(result.status, "success")
        self.assertEqual(service.calls, [("US", "user-1", settings), ("A", "user-1", settings)])
        self.assertEqual(result.result["source"], "portfolio")
        self.assertEqual(result.result["total_positions"], 2)
        self.assertEqual(result.result["quote_errors"], [{"market": "A", "error": "quote unavailable"}])
        first_item = result.result["markets"][0]["items"][0]
        self.assertEqual(first_item["symbol"], "MSFT.US")
        self.assertNotIn("user_id", first_item)

    def test_rejects_unknown_market(self):
        tool = GetPortfolioPositionsTool(portfolio_service=FakePortfolioService())

        result = tool.execute({"market": "HK"})

        self.assertEqual(result.status, "error")
        self.assertIn("market must be one of", result.result)


if __name__ == "__main__":
    unittest.main()
