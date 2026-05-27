import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import watchlist as watchlist_api
from app.core.security import CurrentUser, get_current_user
from app.core.watchlist.service import LongbridgeUnavailableError


def current_user(user_id: str = "user-1", permissions: set[str] | None = None) -> CurrentUser:
    return CurrentUser(
        id=user_id,
        username=user_id,
        display_name=user_id,
        roles=(),
        permissions=frozenset(permissions or {"watchlist:read", "watchlist:write", "market:read", "portfolio:read"}),
        is_active=True,
    )


def watchlist_item(index: int, *, user_id: str = "user-1", category: str = "US") -> dict:
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
        "last_done": None,
        "change_value": None,
        "change_rate": None,
        "note": user_id,
        "created_at": "2026-01-01T00:00:00",
        "updated_at": "2026-01-01T00:00:00",
    }


class FakeWatchlistService:
    def __init__(self, items: list[dict] | None = None):
        self.items = items or []
        self.add_calls = []
        self.delete_calls = []
        self.reorder_calls = []
        self.list_user_ids = []

    def list_items(self, category=None, user_id=None):
        self.list_user_ids.append(user_id)
        rows = [item for item in self.items if item.get("note") == user_id]
        if category:
            rows = [item for item in rows if item["category"] == category]
        return rows

    def add_item(self, item, user_id=None):
        payload = item.model_dump() if hasattr(item, "model_dump") else dict(item)
        self.add_calls.append((payload, user_id))
        created = {
            "id": 99,
            "note": "",
            "created_at": "2026-01-01T00:00:00",
            "updated_at": "2026-01-01T00:00:00",
            **payload,
        }
        self.items.append({**created, "note": user_id})
        return created

    def delete_item(self, item_id, user_id=None):
        self.delete_calls.append((item_id, user_id))
        return True

    def reorder_items(self, ordered_ids, user_id=None):
        self.reorder_calls.append((ordered_ids, user_id))


class FakeMarketService:
    def __init__(self, quotes: list[dict] | None = None, fail: bool = False):
        self.quotes = quotes or []
        self.fail = fail
        self.quote_calls = 0

    def _fetch_quotes(self, symbols, name_map=None, category_map=None, settings=None):
        self.quote_calls += 1
        if self.fail:
            raise LongbridgeUnavailableError("Longbridge credentials are not configured")
        wanted = set(symbols)
        return [quote for quote in self.quotes if quote["symbol"] in wanted]


class FakePortfolioService:
    pass


class FakeSettings:
    def __init__(self, signature: str):
        self.longbridge_app_key = signature
        self.longbridge_app_secret = ""
        self.longbridge_access_token = ""
        self.longbridge_http_url = ""
        self.longbridge_quote_ws_url = ""


class WatchlistApiTest(unittest.TestCase):
    def setUp(self):
        self.user = current_user()
        app = FastAPI()
        app.include_router(watchlist_api.router, prefix="/api/v1/watchlist")
        app.dependency_overrides[get_current_user] = lambda: self.user
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()

    def test_overview_empty_list_does_not_fetch_quotes(self):
        watchlist_service = FakeWatchlistService()
        market_service = FakeMarketService()

        with self._patched_services(watchlist_service, market_service):
            response = self.client.get("/api/v1/watchlist/overview")

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["items"], [])
        self.assertEqual(response.json()["total"], 0)
        self.assertEqual(market_service.quote_calls, 0)

    def test_overview_merges_quotes_with_local_rows(self):
        item = watchlist_item(1)
        market_service = FakeMarketService(
            [
                {
                    "symbol": "SYM1.US",
                    "name": "Quote 1",
                    "category": "US",
                    "last_done": "123.45",
                    "change_value": "1.23",
                    "change_rate": "1.00%",
                    "turnover": "1000",
                }
            ]
        )

        with self._patched_services(FakeWatchlistService([item]), market_service):
            response = self.client.get("/api/v1/watchlist/overview")

        self.assertEqual(response.status_code, 200, response.text)
        row = response.json()["items"][0]
        self.assertEqual(row["id"], 1)
        self.assertEqual(row["last_done"], "123.45")
        self.assertEqual(row["exchange"], "NASDAQ")
        self.assertEqual(response.json()["counts_by_category"]["US"], 1)

    def test_overview_quote_error_keeps_static_rows(self):
        with self._patched_services(FakeWatchlistService([watchlist_item(2)]), FakeMarketService(fail=True)):
            response = self.client.get("/api/v1/watchlist/overview")

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertIn("Longbridge credentials", body["quote_error"])
        self.assertEqual(body["items"][0]["symbol"], "SYM2.US")
        self.assertIsNone(body["items"][0]["last_done"])

    def test_overview_without_market_permission_returns_local_rows_only(self):
        self.user = current_user("user-no-market", {"watchlist:read"})
        watchlist_service = FakeWatchlistService([watchlist_item(3, user_id="user-no-market")])
        market_service = FakeMarketService(
            [
                {
                    "symbol": "SYM3.US",
                    "name": "Quote 3",
                    "category": "US",
                    "last_done": "200",
                    "change_value": "10",
                    "change_rate": "5.00%",
                }
            ]
        )

        with self._patched_services(watchlist_service, market_service):
            response = self.client.get("/api/v1/watchlist/overview")

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(market_service.quote_calls, 0)
        self.assertEqual(body["quote_error"], "Missing permission: market:read")
        self.assertEqual(body["source"], "local")
        self.assertIsNone(body["items"][0]["last_done"])

    def test_overview_uses_current_user_watchlist(self):
        self.user = current_user("user-2")
        watchlist_service = FakeWatchlistService(
            [watchlist_item(4, user_id="user-1"), watchlist_item(5, user_id="user-2")]
        )

        with self._patched_services(watchlist_service, FakeMarketService()):
            response = self.client.get("/api/v1/watchlist/overview")

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(watchlist_service.list_user_ids, ["user-2"])
        self.assertEqual([row["symbol"] for row in response.json()["items"]], ["SYM5.US"])

    def test_existing_add_delete_reorder_routes_keep_user_scope(self):
        watchlist_service = FakeWatchlistService()
        with self._patched_services(watchlist_service, FakeMarketService()):
            added = self.client.post(
                "/api/v1/watchlist",
                json={"category": "US", "symbol": "AAPL.US", "name": "Apple", "note": ""},
            )
            deleted = self.client.delete("/api/v1/watchlist/99")
            reordered = self.client.patch("/api/v1/watchlist/reorder", json={"ids": [99, 100]})

        self.assertEqual(added.status_code, 200, added.text)
        self.assertEqual(deleted.status_code, 200, deleted.text)
        self.assertEqual(reordered.status_code, 200, reordered.text)
        self.assertEqual(watchlist_service.add_calls[0][1], "user-1")
        self.assertEqual(watchlist_service.delete_calls, [(99, "user-1")])
        self.assertEqual(watchlist_service.reorder_calls, [([99, 100], "user-1")])

    def _patched_services(self, watchlist_service: FakeWatchlistService, market_service: FakeMarketService):
        settings = FakeSettings(str(id(watchlist_service)))
        return patch.multiple(
            watchlist_api,
            get_watchlist_service=lambda: watchlist_service,
            get_market_service=lambda: market_service,
            get_portfolio_service=lambda: FakePortfolioService(),
            get_effective_settings=lambda user_id: settings,
        )


if __name__ == "__main__":
    unittest.main()
