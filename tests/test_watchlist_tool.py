import unittest
from types import SimpleNamespace

from app.core.tools.tool_manager import ToolManager
from app.core.tools.watchlist import WatchlistTool


class FakeWatchlistService:
    def __init__(self):
        self.calls = []
        self.items = [
            {
                "id": 1,
                "user_id": "user-1",
                "category": "US",
                "symbol": "MSFT.US",
                "name": "Microsoft",
                "name_cn": "",
                "name_en": "Microsoft",
                "name_hk": "",
                "exchange": "NASDAQ",
                "currency": "USD",
                "last_done": "125",
                "change_value": "1",
                "change_rate": "0.80%",
                "note": "core",
                "created_at": "2026-01-01T00:00:00",
                "updated_at": "2026-01-01T00:00:00",
            },
            {
                "id": 2,
                "user_id": "user-2",
                "category": "US",
                "symbol": "TSLA.US",
                "name": "Tesla",
                "name_cn": "",
                "name_en": "Tesla",
                "name_hk": "",
                "exchange": "NASDAQ",
                "currency": "USD",
                "last_done": None,
                "change_value": None,
                "change_rate": None,
                "note": "",
                "created_at": "2026-01-01T00:00:00",
                "updated_at": "2026-01-01T00:00:00",
            },
        ]

    def list_items(self, category=None, user_id=None):
        self.calls.append(("list", category, user_id))
        rows = [
            item
            for item in self.items
            if (not user_id or item["user_id"] == user_id) and (not category or item["category"] == category)
        ]
        return [dict(item) for item in rows]

    def add_item(self, item, user_id=None):
        payload = item.model_dump()
        self.calls.append(("add", user_id, dict(payload)))
        for existing in self.items:
            if existing["user_id"] == user_id and existing["symbol"] == payload["symbol"]:
                existing.update(payload)
                existing["updated_at"] = "2026-01-02T00:00:00"
                return dict(existing)
        created = {
            "id": max(item["id"] for item in self.items) + 1,
            "user_id": user_id,
            "created_at": "2026-01-02T00:00:00",
            "updated_at": "2026-01-02T00:00:00",
            **payload,
        }
        self.items.append(created)
        return dict(created)

    def delete_item(self, item_id, user_id=None):
        self.calls.append(("delete", item_id, user_id))
        for index, item in enumerate(self.items):
            if item["id"] == item_id and item["user_id"] == user_id:
                del self.items[index]
                return None
        raise KeyError(item_id)

    def reorder_items(self, ordered_ids, user_id=None):
        self.calls.append(("reorder", ordered_ids, user_id))

    def search(self, query, category, limit, settings=None):
        self.calls.append(("search", query, category, limit, settings))
        return [
            {
                "category": category or "US",
                "symbol": f"{query.upper()}.US",
                "name": "Search Result",
                "exchange": "NASDAQ",
                "currency": "USD",
                "last_done": "10",
                "change_value": "0.1",
                "change_rate": "1.00%",
            }
        ]


class WatchlistToolTest(unittest.TestCase):
    def test_lists_current_user_watchlist_without_internal_user_id(self):
        service = FakeWatchlistService()
        tool = WatchlistTool(watchlist_service=service, user_id="user-1")

        result = tool.execute({"action": "list", "category": "US"})

        self.assertEqual(result.status, "success")
        self.assertEqual(service.calls, [("list", "US", "user-1")])
        self.assertEqual(result.result["total"], 1)
        self.assertEqual(result.result["items"][0]["symbol"], "MSFT.US")
        self.assertNotIn("user_id", result.result["items"][0])

    def test_adds_updates_deletes_and_reorders_with_current_user_scope(self):
        service = FakeWatchlistService()
        tool = WatchlistTool(watchlist_service=service, user_id="user-1")

        created = tool.execute({"action": "add", "category": "US", "symbol": "aapl.us", "name": "Apple"})
        self.assertEqual(created.status, "success")
        self.assertEqual(created.result["item"]["symbol"], "AAPL.US")
        self.assertNotIn("user_id", created.result["item"])
        self.assertEqual(service.calls[-1][0], "add")
        self.assertEqual(service.calls[-1][1], "user-1")

        updated = tool.execute({"action": "update", "symbol": "MSFT.US", "category": "A", "note": "watch thesis"})
        self.assertEqual(updated.status, "success")
        self.assertEqual(updated.result["item"]["category"], "A")
        self.assertEqual(updated.result["item"]["note"], "watch thesis")
        self.assertEqual(service.calls[-1][2]["symbol"], "MSFT.US")

        reordered = tool.execute({"action": "reorder", "ids": "3,1"})
        self.assertEqual(reordered.status, "success")
        self.assertEqual(service.calls[-1], ("reorder", [3, 1], "user-1"))

        deleted = tool.execute({"action": "delete", "symbol": "MSFT.US"})
        self.assertEqual(deleted.status, "success")
        self.assertEqual(service.calls[-1], ("delete", 1, "user-1"))

    def test_search_forwards_effective_settings_and_bounds_limit(self):
        service = FakeWatchlistService()
        settings = SimpleNamespace(longbridge_app_key="demo")
        tool = WatchlistTool(watchlist_service=service, user_id="user-1", settings=settings)

        result = tool.execute({"action": "search", "q": "aapl", "category": "US", "limit": 50})

        self.assertEqual(result.status, "success")
        self.assertEqual(service.calls, [("search", "aapl", "US", 20, settings)])
        self.assertEqual(result.result["source"], "longbridge")
        self.assertEqual(result.result["results"][0]["symbol"], "AAPL.US")

    def test_rejects_missing_delete_target(self):
        tool = WatchlistTool(watchlist_service=FakeWatchlistService(), user_id="user-1")

        result = tool.execute({"action": "delete"})

        self.assertEqual(result.status, "error")
        self.assertIn("item_id or symbol is required", result.result)

    def test_tool_manager_registers_watchlist_tool(self):
        manager = ToolManager()
        original_instantiate = manager._instantiate_tool

        def instantiate_without_scheduler_service(tool_class):
            if getattr(tool_class, "__name__", "") == "SchedulerTool":
                return tool_class()
            return original_instantiate(tool_class)

        manager._instantiate_tool = instantiate_without_scheduler_service
        manager.load_builtin_tools()

        self.assertIn("watchlist", set(manager.tool_classes))


if __name__ == "__main__":
    unittest.main()
