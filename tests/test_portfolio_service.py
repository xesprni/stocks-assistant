import tempfile
import unittest
from types import SimpleNamespace

from pydantic import ValidationError

from app.core.portfolio.service import PortfolioService
from app.schemas.portfolio import PortfolioItemCreate, PortfolioItemUpdate, PortfolioSellRequest


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

    def test_partial_quote_response_uses_cost_basis_and_marks_valuation_incomplete(self):
        with tempfile.TemporaryDirectory() as tmp:
            service = PortfolioService(tmp)
            service.longbridge = FakeLongbridge(FakeQuoteContext())
            service.save_settings("US", "100")
            service.add_item(
                PortfolioItemCreate(market="US", symbol="MSFT.US", shares="10", cost_price="80")
            )
            service.add_item(
                PortfolioItemCreate(market="US", symbol="AAPL.US", shares="5", cost_price="80")
            )

            result = service.list_items("US")

        items = {item["symbol"]: item for item in result["items"]}
        self.assertEqual("1700.00", result["total_assets"])
        self.assertFalse(result["valuation_complete"])
        self.assertEqual(["AAPL.US"], result["unpriced_symbols"])
        self.assertIn("cost basis was used", result["quote_error"])
        self.assertEqual("cost", items["AAPL.US"]["valuation_price_source"])
        self.assertEqual("400.00", items["AAPL.US"]["stock_value"])
        self.assertIsNone(items["AAPL.US"]["pnl_ratio"])

    def test_invalid_numeric_and_market_symbol_updates_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            service = PortfolioService(tmp)
            with self.assertRaisesRegex(ValueError, "total_capital"):
                service.save_settings("US", "typo")
            with self.assertRaises(ValidationError):
                PortfolioItemCreate(market="US", symbol="AAPL.US", shares="oops", cost_price="100")
            with self.assertRaisesRegex(ValueError, "does not match market"):
                service.add_item(PortfolioItemCreate(market="H", symbol="AAPL.US", shares="1", cost_price="1"))

            item = service.add_item(
                PortfolioItemCreate(market="US", symbol="AAPL.US", shares="1", cost_price="100")
            )
            with self.assertRaisesRegex(ValueError, "explicit matching symbol"):
                service.update_item(item["id"], PortfolioItemUpdate(market="H"))

    def test_sell_item_reduces_shares_increases_cash_and_records_transaction(self):
        with tempfile.TemporaryDirectory() as tmp:
            service = PortfolioService(tmp)
            service.save_settings("US", "100")
            item = service.add_item(
                PortfolioItemCreate(
                    market="US",
                    symbol="msft.us",
                    name="Microsoft",
                    shares="10",
                    cost_price="80",
                    note="core",
                )
            )

            result = service.sell_item(item["id"], PortfolioSellRequest(shares="4", price="120", note=" trim "))
            transactions = service.list_transactions("US")["transactions"]

        self.assertEqual(result["item"]["shares"], "6")
        self.assertEqual(result["total_capital"], "580")
        self.assertEqual(len(transactions), 1)
        self.assertEqual(transactions[0]["side"], "sell")
        self.assertEqual(transactions[0]["symbol"], "MSFT.US")
        self.assertEqual(transactions[0]["shares"], "4")
        self.assertEqual(transactions[0]["price"], "120")
        self.assertEqual(transactions[0]["amount"], "480.00")
        self.assertEqual(transactions[0]["realized_pnl"], "160.00")
        self.assertEqual(transactions[0]["note"], "trim")


if __name__ == "__main__":
    unittest.main()
