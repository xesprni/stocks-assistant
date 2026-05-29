import unittest

from app.api.watchlist import _strip_watchlist_quote_payload
from app.core.dashboard.service import DashboardService
from app.core.watchlist.service import LongbridgeUnavailableError


class FakeUser:
    id = "user-1"

    def __init__(self, permissions=None):
        self.permissions = set(permissions or {"config:read", "market:read", "watchlist:read", "portfolio:read"})

    def can(self, permission):
        return permission in self.permissions


class FakeWatchlistService:
    def __init__(self, items):
        self.items = items

    def list_items(self, category=None, user_id=None):
        if category:
            return [item for item in self.items if item["category"] == category]
        return self.items


class FakeMarketService:
    def __init__(self, quotes=None, static_infos=None, fail_quotes=False):
        self.quotes = quotes or []
        self.static_infos = static_infos or []
        self.fail_quotes = fail_quotes
        self.quote_calls = 0
        self.static_info_calls = 0

    def get_config(self, user_id=None):
        return {"indices": [{"symbol": ".SPX.US", "name": "S&P 500", "enabled": True}], "refresh_interval": 60}

    def get_index_quotes(self, user_id=None, settings=None):
        return [{"symbol": ".SPX.US", "name": "S&P 500", "category": "US", "last_done": "5000"}]

    def get_watchlist_quotes(self, items, settings=None):
        if self.fail_quotes:
            raise LongbridgeUnavailableError("Longbridge credentials are not configured")
        return self.quotes

    def _fetch_quotes(self, symbols, name_map=None, category_map=None, settings=None):
        self.quote_calls += 1
        if self.fail_quotes:
            raise LongbridgeUnavailableError("Longbridge credentials are not configured")
        wanted = set(symbols)
        return [quote for quote in self.quotes if quote["symbol"] in wanted]

    def get_security_static_info(self, symbols, settings=None):
        self.static_info_calls += 1
        if self.fail_quotes:
            raise LongbridgeUnavailableError("Longbridge credentials are not configured")
        wanted = set(symbols)
        return [info for info in self.static_infos if info["symbol"] in wanted]


class FakePortfolioService:
    def __init__(self, payloads=None):
        self.payloads = payloads or {}

    def list_items(self, market, user_id=None, settings=None):
        return self.payloads.get(
            market,
            {
                "market": market,
                "total_capital": "0",
                "total_assets": "0",
                "cash_ratio": None,
                "items": [],
                "total": 0,
                "quote_error": None,
            },
        )


def watchlist_item(index, category="US"):
    return {
        "id": index,
        "category": category,
        "symbol": f"SYM{index}.US",
        "name": f"Symbol {index}",
        "name_cn": "",
        "name_en": f"Symbol {index}",
        "name_hk": "",
        "exchange": "NASDAQ",
        "currency": "USD",
        "lot_size": "",
        "board": "",
        "security_type": "",
        "last_done": None,
        "change_value": None,
        "change_rate": None,
        "note": "",
        "created_at": "2026-01-01T00:00:00",
        "updated_at": "2026-01-01T00:00:00",
    }


def portfolio_item(symbol, shares, cost, price, change, stock_value, position_ratio):
    return {
        "id": len(symbol),
        "market": "US",
        "symbol": symbol,
        "name": symbol,
        "shares": shares,
        "cost_price": cost,
        "note": "",
        "currency": "USD",
        "pe_ttm_ratio": None,
        "current_price": price,
        "change_value": change,
        "change_rate": None,
        "stock_value": stock_value,
        "position_ratio": position_ratio,
        "pnl_ratio": None,
        "created_at": "2026-01-01T00:00:00",
        "updated_at": "2026-01-01T00:00:00",
    }


class DashboardServiceTest(unittest.TestCase):
    def test_watchlist_views_keep_all_rows_and_sort(self):
        items = [watchlist_item(index, "A" if index % 3 == 0 else "US") for index in range(10)]
        quotes = [
            {
                "symbol": f"SYM{index}.US",
                "name": f"Quote {index}",
                "category": "A" if index % 3 == 0 else "US",
                "last_done": str(100 + index),
                "change_rate": rate,
                "change_value": "1",
                "turnover": str(turnover),
                "volume": str(1000 + index),
            }
            for index, rate, turnover in [
                (0, "1.00%", 100),
                (1, "-7.00%", 200),
                (2, "3.00%", 300),
                (3, "11.00%", 50),
                (4, "-2.00%", 9000),
                (5, "0.50%", 500),
                (6, "-12.00%", 1000),
                (7, "4.00%", 700),
                (8, "2.50%", 600),
                (9, "-1.00%", 800),
            ]
        ]
        service = DashboardService(FakeMarketService(quotes), FakeWatchlistService(items), FakePortfolioService())

        payload = service.build(user=FakeUser(), settings=None)
        watchlist = payload["watchlist"]

        self.assertEqual(watchlist["total"], 10)
        self.assertEqual(len(watchlist["views"]["movers"]), 10)
        self.assertEqual(watchlist["counts_by_category"], {"US": 6, "A": 4, "H": 0})
        self.assertEqual(watchlist["views"]["movers"][0]["symbol"], "SYM6.US")
        self.assertEqual(watchlist["views"]["gainers"][0]["symbol"], "SYM3.US")
        self.assertEqual(watchlist["views"]["losers"][0]["symbol"], "SYM6.US")
        self.assertEqual(watchlist["views"]["active"][0]["symbol"], "SYM4.US")

    def test_watchlist_quote_failure_keeps_static_rows(self):
        items = [watchlist_item(index) for index in range(3)]
        service = DashboardService(FakeMarketService(fail_quotes=True), FakeWatchlistService(items), FakePortfolioService())

        payload = service.build(user=FakeUser(), settings=None)
        watchlist = payload["watchlist"]

        self.assertEqual(watchlist["total"], 3)
        self.assertIn("Longbridge credentials", watchlist["quote_error"])
        self.assertEqual([row["symbol"] for row in watchlist["items"]], ["SYM0.US", "SYM1.US", "SYM2.US"])

    def test_watchlist_rows_preserve_management_metadata_for_overview(self):
        items = [watchlist_item(1)]
        items[0]["note"] = "track earnings"
        items[0]["name_cn"] = "测试股票"
        service = DashboardService(FakeMarketService(), FakeWatchlistService(items), FakePortfolioService())

        payload = service.watchlist(user=FakeUser(), settings=None, mode="bootstrap")
        row = payload["items"][0]

        self.assertEqual(row["id"], 1)
        self.assertEqual(row["name_cn"], "测试股票")
        self.assertEqual(row["note"], "track earnings")
        self.assertEqual(row["created_at"], "2026-01-01T00:00:00")

    def test_watchlist_company_profile_uses_longbridge_static_info(self):
        items = [watchlist_item(1)]
        items[0]["name_cn"] = ""
        market_service = FakeMarketService(
            static_infos=[
                {
                    "symbol": "SYM1.US",
                    "name": "Static Name",
                    "name_cn": "静态名称",
                    "name_en": "Static Name",
                    "name_hk": "",
                    "exchange": "NYSE",
                    "currency": "USD",
                    "lot_size": "1",
                    "board": "USMain",
                    "security_type": "Stock",
                }
            ]
        )
        service = DashboardService(market_service, FakeWatchlistService(items), FakePortfolioService())

        payload = service.watchlist(user=FakeUser(), settings=None)
        row = payload["items"][0]

        self.assertEqual(market_service.static_info_calls, 1)
        self.assertEqual(row["name"], "Static Name")
        self.assertEqual(row["name_cn"], "静态名称")
        self.assertEqual(row["exchange"], "NYSE")
        self.assertEqual(row["lot_size"], "1")
        self.assertEqual(row["security_type"], "Stock")

    def test_watchlist_overview_permission_strip_removes_quote_fields(self):
        row = {
            **watchlist_item(1),
            "prev_close": "99",
            "open": "100",
            "high": "120",
            "low": "90",
            "volume": "1000",
            "turnover": "9000",
            "last_done": "110",
            "change_value": "10",
            "change_rate": "10.10%",
        }

        payload = _strip_watchlist_quote_payload(
            {
                "items": [row],
                "views": {"movers": [row], "gainers": [row], "losers": [row], "active": [row]},
                "source": "cache",
                "stale": True,
            }
        )

        self.assertEqual(payload["source"], "local")
        self.assertFalse(payload["stale"])
        self.assertIsNone(payload["items"][0]["last_done"])
        self.assertIsNone(payload["views"]["movers"][0]["turnover"])
        self.assertEqual(payload["items"][0]["id"], 1)

    def test_portfolio_summary_calculates_per_market_values(self):
        service = DashboardService(
            FakeMarketService(),
            FakeWatchlistService([]),
            FakePortfolioService(
                {
                    "US": {
                        "market": "US",
                        "total_capital": "1000",
                        "total_assets": "2650.00",
                        "cash_ratio": "37.74%",
                        "items": [
                            portfolio_item("MSFT.US", "10", "80", "120", "20", "1200", "60%"),
                            portfolio_item("AAPL.US", "5", "100", "90", "-2", "450", "20%"),
                        ],
                        "total": 2,
                        "quote_error": None,
                    }
                }
            ),
        )

        payload = service.build(user=FakeUser(), settings=None)
        us = payload["portfolio"]["markets"][0]

        self.assertEqual(us["market"], "US")
        self.assertEqual(us["market_value"], "1650.00")
        self.assertEqual(us["cost_value"], "1300.00")
        self.assertEqual(us["unrealized_pnl_value"], "350.00")
        self.assertEqual(us["unrealized_pnl_ratio"], "26.92%")
        self.assertEqual(us["day_change_value"], "190.00")
        self.assertEqual(us["day_change_rate"], "13.01%")
        self.assertEqual(us["top_positions"][0]["symbol"], "MSFT.US")

    def test_missing_module_permission_marks_module_unavailable(self):
        service = DashboardService(FakeMarketService(), FakeWatchlistService([]), FakePortfolioService())
        user = FakeUser({"config:read", "market:read"})

        payload = service.build(user=user, settings=None)

        self.assertFalse(payload["watchlist"]["available"])
        self.assertFalse(payload["portfolio"]["available"])
        self.assertTrue(payload["market"]["available"])

    def test_bootstrap_does_not_call_longbridge_quotes(self):
        items = [watchlist_item(index) for index in range(2)]
        market_service = FakeMarketService(
            [
                {
                    "symbol": "SYM0.US",
                    "name": "Quote 0",
                    "category": "US",
                    "last_done": "100",
                    "change_rate": "1.00%",
                    "change_value": "1",
                }
            ]
        )
        service = DashboardService(market_service, FakeWatchlistService(items), FakePortfolioService())

        payload = service.build(user=FakeUser(), settings=None, mode="bootstrap")

        self.assertEqual(market_service.quote_calls, 0)
        self.assertEqual(market_service.static_info_calls, 0)
        self.assertEqual(payload["watchlist"]["source"], "local")
        self.assertEqual(payload["watchlist"]["items"][0]["last_done"], None)

    def test_quote_cache_reuses_recent_full_refresh(self):
        items = [watchlist_item(100)]
        quotes = [
            {
                "symbol": "SYM100.US",
                "name": "Quote 100",
                "category": "US",
                "last_done": "120",
                "change_rate": "2.00%",
                "change_value": "2",
            }
        ]
        market_service = FakeMarketService(quotes)
        service = DashboardService(market_service, FakeWatchlistService(items), FakePortfolioService())
        user = FakeUser()

        first = service.watchlist(user=user, settings=None)
        second = service.watchlist(user=user, settings=None)

        self.assertEqual(market_service.quote_calls, 1)
        self.assertEqual(first["items"][0]["last_done"], "120")
        self.assertEqual(second["source"], "cache")


if __name__ == "__main__":
    unittest.main()
