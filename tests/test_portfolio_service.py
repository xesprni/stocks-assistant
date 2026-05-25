import tempfile
import unittest
from types import SimpleNamespace

from app.core.portfolio.service import PortfolioService
from app.schemas.portfolio import PortfolioItemCreate


class FakeLongbridge:
    def __init__(self, ctx):
        self.ctx = ctx

    def _quote_context(self, settings=None):
        return self.ctx


class FakeQuoteContext:
    def quote(self, symbols):
        self.symbols = symbols
        return [
            SimpleNamespace(
                symbol="MSFT.US",
                last_done="120",
                prev_close="100",
                currency="USD",
            )
        ]

    def calc_indexes(self, symbols, indexes):
        self.calc_symbols = symbols
        return [SimpleNamespace(symbol="MSFT.US", pe_ttm_ratio="31.5")]


class PortfolioServiceTest(unittest.TestCase):
    def test_list_items_enriches_market_value_position_and_pnl(self):
        with tempfile.TemporaryDirectory() as tmp:
            ctx = FakeQuoteContext()
            service = PortfolioService(tmp)
            service.longbridge = FakeLongbridge(ctx)
            service.save_settings("US", "10000")
            service.add_item(
                PortfolioItemCreate(
                    market="US",
                    symbol="msft.us",
                    name="Microsoft",
                    shares="10",
                    cost_price="80",
                    note="core",
                )
            )

            result = service.list_items("US")

        self.assertEqual(ctx.symbols, ["MSFT.US"])
        item = result["items"][0]
        self.assertEqual(item["current_price"], "120")
        self.assertEqual(item["stock_value"], "1200.00")
        self.assertEqual(item["position_ratio"], "10.71%")
        self.assertEqual(item["pnl_ratio"], "50.00%")
        self.assertEqual(item["pe_ttm_ratio"], "31.5")
        self.assertEqual(item["change_rate"], "20.00%")
        self.assertEqual(result["total_assets"], "11200.00")
        self.assertEqual(result["cash_ratio"], "89.29%")


if __name__ == "__main__":
    unittest.main()
