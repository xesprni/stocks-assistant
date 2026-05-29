import unittest
from types import SimpleNamespace

from app.core.tools.portfolio import PortfolioTool
from app.core.tools.tool_manager import ToolManager


def canonical_symbol(symbol: str, market: str) -> str:
    normalized = symbol.strip().upper()
    if "." in normalized:
        return normalized
    if market == "US":
        return f"{normalized}.US"
    suffix = "SH" if normalized.startswith(("5", "6", "9")) else "SZ"
    return f"{normalized}.{suffix}"


class FakePortfolioService:
    def __init__(self):
        self.calls = []
        self.items = [
            {
                "id": 1,
                "user_id": "user-1",
                "market": "US",
                "symbol": "MSFT.US",
                "name": "Microsoft",
                "shares": "10",
                "cost_price": "100",
                "note": "core",
                "created_at": "2026-01-01T00:00:00",
                "updated_at": "2026-01-01T00:00:00",
            }
        ]
        self.settings = {"US": "1000", "A": "0"}

    def list_items(self, market, user_id=None, settings=None):
        self.calls.append(("list", market, user_id, settings))
        rows = [
            dict(item)
            for item in self.items
            if item["market"] == market and (not user_id or item["user_id"] == user_id)
        ]
        return {
            "market": market,
            "total_capital": self.settings.get(market, "0"),
            "total_assets": self.settings.get(market, "0"),
            "cash_ratio": None,
            "items": rows,
            "total": len(rows),
            "quote_error": None,
        }

    def get_item(self, item_id, user_id=None):
        self.calls.append(("get", item_id, user_id))
        for item in self.items:
            if item["id"] == item_id and (not user_id or item["user_id"] == user_id):
                return dict(item)
        raise KeyError(item_id)

    def add_item(self, item, user_id=None):
        payload = item.model_dump()
        payload["symbol"] = canonical_symbol(payload["symbol"], payload["market"])
        self.calls.append(("add", user_id, dict(payload)))
        for existing in self.items:
            if existing["user_id"] == user_id and existing["symbol"] == payload["symbol"]:
                existing.update(payload)
                existing["updated_at"] = "2026-01-02T00:00:00"
                return dict(existing)
        created = {
            "id": max(item["id"] for item in self.items) + 1 if self.items else 1,
            "user_id": user_id,
            "created_at": "2026-01-02T00:00:00",
            "updated_at": "2026-01-02T00:00:00",
            **payload,
        }
        self.items.append(created)
        return dict(created)

    def update_item(self, item_id, item, user_id=None):
        patch = item.model_dump(exclude_unset=True)
        self.calls.append(("update", item_id, user_id, dict(patch)))
        for existing in self.items:
            if existing["id"] == item_id and existing["user_id"] == user_id:
                if patch.get("symbol"):
                    patch["symbol"] = canonical_symbol(patch["symbol"], patch.get("market") or existing["market"])
                existing.update(patch)
                existing["updated_at"] = "2026-01-02T00:00:00"
                return dict(existing)
        raise KeyError(item_id)

    def delete_item(self, item_id, user_id=None):
        self.calls.append(("delete", item_id, user_id))
        for index, item in enumerate(self.items):
            if item["id"] == item_id and item["user_id"] == user_id:
                del self.items[index]
                return None
        raise KeyError(item_id)

    def save_settings(self, market, total_capital, user_id=None):
        self.calls.append(("settings", market, total_capital, user_id))
        self.settings[market] = total_capital
        return {"market": market, "user_id": user_id, "total_capital": total_capital}

    def search(self, query, market, limit, settings=None):
        self.calls.append(("search", query, market, limit, settings))
        return [
            {
                "market": market,
                "symbol": canonical_symbol(query, market),
                "name": "Search Result",
                "currency": "USD" if market == "US" else "CNY",
                "last_done": "10",
                "change_rate": "1.00%",
            }
        ]


class PortfolioToolTest(unittest.TestCase):
    def test_upsert_updates_existing_without_clearing_unspecified_fields(self):
        service = FakePortfolioService()
        tool = PortfolioTool(portfolio_service=service, user_id="user-1")

        result = tool.execute({"action": "upsert", "market": "US", "symbol": "MSFT", "shares": "12"})

        self.assertEqual(result.status, "success")
        self.assertEqual(result.result["operation"], "update")
        self.assertEqual(result.result["item"]["shares"], "12")
        self.assertEqual(result.result["item"]["name"], "Microsoft")
        self.assertEqual(result.result["item"]["cost_price"], "100")
        self.assertNotIn("user_id", result.result["item"])
        self.assertEqual(service.calls[-1], ("update", 1, "user-1", {"shares": "12"}))

    def test_adjust_shares_recomputes_average_cost_for_positive_delta(self):
        service = FakePortfolioService()
        tool = PortfolioTool(portfolio_service=service, user_id="user-1")

        result = tool.execute(
            {
                "action": "adjust_shares",
                "market": "US",
                "symbol": "MSFT",
                "shares_delta": "5",
                "trade_price": "130",
            }
        )

        self.assertEqual(result.status, "success")
        self.assertEqual(result.result["item"]["shares"], "15")
        self.assertEqual(result.result["item"]["cost_price"], "110")

    def test_set_capital_search_delete_and_register_tool(self):
        service = FakePortfolioService()
        settings = SimpleNamespace(longbridge_app_key="demo")
        tool = PortfolioTool(portfolio_service=service, user_id="user-1", settings=settings)

        saved = tool.execute({"action": "set_cash", "market": "US", "cash": "2500"})
        self.assertEqual(saved.status, "success")
        self.assertEqual(saved.result["settings"], {"market": "US", "total_capital": "2500"})

        search = tool.execute({"action": "search", "market": "US", "query": "aapl", "limit": 50})
        self.assertEqual(search.status, "success")
        self.assertEqual(service.calls[-1], ("search", "aapl", "US", 20, settings))

        deleted = tool.execute({"action": "delete", "symbol": "MSFT", "market": "US"})
        self.assertEqual(deleted.status, "success")
        self.assertEqual(deleted.result["deleted_item"]["symbol"], "MSFT.US")
        self.assertEqual(service.calls[-1], ("delete", 1, "user-1"))

        manager = ToolManager()
        original_instantiate = manager._instantiate_tool

        def instantiate_without_scheduler_service(tool_class):
            if getattr(tool_class, "__name__", "") == "SchedulerTool":
                return tool_class()
            return original_instantiate(tool_class)

        manager._instantiate_tool = instantiate_without_scheduler_service
        manager.load_builtin_tools()
        self.assertIn("portfolio", set(manager.tool_classes))


if __name__ == "__main__":
    unittest.main()
