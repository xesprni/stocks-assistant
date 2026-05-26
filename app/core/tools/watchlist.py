"""Agent-facing watchlist CRUD tool."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional

from pydantic import ValidationError

from app.core.tools.base_tool import BaseTool, ToolResult
from app.core.watchlist.service import LongbridgeUnavailableError
from app.schemas.watchlist import WatchlistItemCreate


WATCHLIST_FIELDS = (
    "id",
    "category",
    "symbol",
    "name",
    "name_cn",
    "name_en",
    "name_hk",
    "exchange",
    "currency",
    "last_done",
    "change_value",
    "change_rate",
    "note",
    "created_at",
    "updated_at",
)

ITEM_PAYLOAD_FIELDS = (
    "category",
    "symbol",
    "name",
    "name_cn",
    "name_en",
    "name_hk",
    "exchange",
    "currency",
    "last_done",
    "change_value",
    "change_rate",
    "note",
)


class WatchlistTool(BaseTool):
    name: str = "watchlist"
    description: str = (
        "管理当前用户本地自选股列表时使用此工具。Use this internal tool to list, get, add, "
        "update, delete, reorder, or search watchlist items. Symbols use Longbridge format "
        "such as AAPL.US, 700.HK, 600519.SH. All operations are scoped to the current user."
    )
    params: dict = {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["list", "get", "add", "create", "update", "delete", "reorder", "search"],
                "description": "Watchlist operation to run.",
            },
            "category": {
                "type": "string",
                "enum": ["US", "A", "H"],
                "description": "Watchlist category. US = US stocks, A = A-shares, H = Hong Kong stocks.",
            },
            "item_id": {"type": "integer", "description": "Watchlist item id for get/update/delete."},
            "id": {"type": "integer", "description": "Alias for item_id."},
            "symbol": {
                "type": "string",
                "description": "Longbridge symbol. For update/delete/get it can select the existing item.",
            },
            "name": {"type": "string"},
            "name_cn": {"type": "string"},
            "name_en": {"type": "string"},
            "name_hk": {"type": "string"},
            "exchange": {"type": "string"},
            "currency": {"type": "string"},
            "last_done": {"type": "string"},
            "change_value": {"type": "string"},
            "change_rate": {"type": "string"},
            "note": {"type": "string"},
            "ids": {
                "type": "array",
                "items": {"type": "integer"},
                "description": "Ordered item ids for reorder.",
            },
            "query": {"type": "string", "description": "Search query for Longbridge symbol lookup."},
            "q": {"type": "string", "description": "Alias for query."},
            "limit": {"type": "integer", "minimum": 1, "maximum": 20, "default": 10},
        },
        "required": ["action"],
    }

    def __init__(self, watchlist_service: Any = None, user_id: Optional[str] = None, settings: Any = None):
        self.watchlist_service = watchlist_service
        self.user_id = user_id
        self.settings = settings

    def execute(self, params: Dict[str, Any]) -> ToolResult:
        service = self._get_watchlist_service()
        if service is None:
            return ToolResult.fail("Watchlist service not initialized")

        action = self._normalize_action(params.get("action"))
        handlers = {
            "list": self._list,
            "get": self._get,
            "add": self._add,
            "update": self._update,
            "delete": self._delete,
            "reorder": self._reorder,
            "search": self._search,
        }
        handler = handlers.get(action)
        if handler is None:
            return ToolResult.fail(f"Unknown action: {params.get('action')}")

        try:
            return ToolResult.success(handler(service, params))
        except LongbridgeUnavailableError as exc:
            return ToolResult.fail(str(exc))
        except (KeyError, LookupError) as exc:
            return ToolResult.fail(str(exc) or "Watchlist item not found")
        except (TypeError, ValueError, ValidationError) as exc:
            return ToolResult.fail(str(exc))

    def _get_watchlist_service(self):
        if self.watchlist_service is not None:
            return self.watchlist_service
        try:
            from app.deps import get_watchlist_service

            return get_watchlist_service()
        except Exception:
            return None

    def _list(self, service: Any, params: Dict[str, Any]) -> dict[str, Any]:
        category = self._category(params.get("category"))
        items = [self._sanitize_item(item) for item in service.list_items(category, user_id=self.user_id)]
        return {
            "source": "watchlist",
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "category": category or "ALL",
            "items": items,
            "total": len(items),
        }

    def _get(self, service: Any, params: Dict[str, Any]) -> dict[str, Any]:
        item = self._find_item(service, params)
        return {"source": "watchlist", "item": self._sanitize_item(item)}

    def _add(self, service: Any, params: Dict[str, Any]) -> dict[str, Any]:
        payload = self._create_payload(params)
        item = service.add_item(WatchlistItemCreate(**payload), user_id=self.user_id)
        return {"status": "ok", "item": self._sanitize_item(item)}

    def _update(self, service: Any, params: Dict[str, Any]) -> dict[str, Any]:
        current = self._find_item(service, params, use_category_filter=False)
        payload = {field: current.get(field) for field in ITEM_PAYLOAD_FIELDS}
        has_updates = False

        # symbol 在 update 中用于定位现有条目；如需改代码本身，先 add 新 symbol 再 delete 旧条目更清晰。
        for field in ITEM_PAYLOAD_FIELDS:
            if field == "symbol":
                continue
            if field not in params:
                continue
            payload[field] = self._category(params[field], required=True) if field == "category" else params[field]
            has_updates = True

        if not has_updates:
            return {"status": "ok", "item": self._sanitize_item(current)}

        item = service.add_item(WatchlistItemCreate(**payload), user_id=self.user_id)
        return {"status": "ok", "item": self._sanitize_item(item)}

    def _delete(self, service: Any, params: Dict[str, Any]) -> dict[str, Any]:
        item = self._find_item(service, params)
        service.delete_item(int(item["id"]), user_id=self.user_id)
        return {"status": "ok", "deleted_item": self._sanitize_item(item)}

    def _reorder(self, service: Any, params: Dict[str, Any]) -> dict[str, Any]:
        ids = self._id_list(params.get("ids") or params.get("ordered_ids"))
        if not ids:
            raise ValueError("ids is required for reorder")
        service.reorder_items(ids, user_id=self.user_id)
        return {"status": "ok", "total": len(ids)}

    def _search(self, service: Any, params: Dict[str, Any]) -> dict[str, Any]:
        query = str(params.get("query") or params.get("q") or params.get("symbol") or "").strip()
        if not query:
            raise ValueError("query is required for search")
        limit = self._bounded_int(params.get("limit"), default=10, minimum=1, maximum=20, name="limit")
        category = self._category(params.get("category"))
        results = [
            self._sanitize_search_result(item)
            for item in service.search(query=query, category=category, limit=limit, settings=self.settings)
        ]
        return {
            "source": "longbridge",
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "query": query,
            "category": category or "ALL",
            "results": results,
            "total": len(results),
        }

    def _find_item(self, service: Any, params: Dict[str, Any], use_category_filter: bool = True) -> dict[str, Any]:
        raw_item_id = params.get("item_id") if params.get("item_id") is not None else params.get("id")
        item_id = self._optional_int(raw_item_id, "item_id")
        symbol = str(params.get("symbol") or "").strip().upper()
        if item_id is None and not symbol:
            raise ValueError("item_id or symbol is required")

        category = self._category(params.get("category")) if use_category_filter else None
        items = service.list_items(category, user_id=self.user_id)
        for item in items:
            if item_id is not None and int(item.get("id")) == item_id:
                return item
            if symbol and str(item.get("symbol") or "").upper() == symbol:
                return item
        raise LookupError("Watchlist item not found")

    def _create_payload(self, params: Dict[str, Any]) -> dict[str, Any]:
        symbol = str(params.get("symbol") or "").strip().upper()
        if not symbol:
            raise ValueError("symbol is required")
        return {
            "category": self._category(params.get("category"), required=True),
            "symbol": symbol,
            "name": str(params.get("name") or ""),
            "name_cn": str(params.get("name_cn") or ""),
            "name_en": str(params.get("name_en") or ""),
            "name_hk": str(params.get("name_hk") or ""),
            "exchange": str(params.get("exchange") or ""),
            "currency": str(params.get("currency") or ""),
            "last_done": params.get("last_done"),
            "change_value": params.get("change_value"),
            "change_rate": params.get("change_rate"),
            "note": str(params.get("note") or ""),
        }

    @staticmethod
    def _normalize_action(value: Any) -> str:
        action = str(value or "").strip().lower()
        aliases = {"create": "add", "read": "list", "remove": "delete"}
        return aliases.get(action, action)

    @staticmethod
    def _category(value: Any, required: bool = False) -> Optional[str]:
        if value is None or value == "":
            if required:
                raise ValueError("category is required")
            return None
        normalized = str(value).strip().upper().replace("-", "").replace("_", "")
        aliases = {"HK": "H", "HKG": "H", "CN": "A", "ASHARE": "A", "ALL": None}
        category = aliases.get(normalized, normalized)
        if category is None and not required:
            return None
        if category not in {"US", "A", "H"}:
            raise ValueError("category must be one of: US, A, H")
        return category

    @staticmethod
    def _optional_int(value: Any, name: str) -> Optional[int]:
        if value is None or value == "":
            return None
        try:
            parsed = int(value)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{name} must be an integer") from exc
        if parsed <= 0:
            raise ValueError(f"{name} must be a positive integer")
        return parsed

    @classmethod
    def _bounded_int(cls, value: Any, default: int, minimum: int, maximum: int, name: str) -> int:
        parsed = cls._optional_int(value, name)
        if parsed is None:
            return default
        return max(minimum, min(parsed, maximum))

    @classmethod
    def _id_list(cls, value: Any) -> list[int]:
        if value is None:
            return []
        if isinstance(value, str):
            raw_items = [item.strip() for item in value.split(",") if item.strip()]
        elif isinstance(value, list):
            raw_items = value
        else:
            raw_items = [value]
        ids: list[int] = []
        for item in raw_items:
            parsed = cls._optional_int(item, "ids")
            if parsed is not None:
                ids.append(parsed)
        return ids

    @staticmethod
    def _sanitize_item(item: dict[str, Any]) -> dict[str, Any]:
        # 工具结果只暴露业务字段，避免把内部用户标识混进 LLM 上下文。
        return {field: item.get(field) for field in WATCHLIST_FIELDS if field in item}

    @staticmethod
    def _sanitize_search_result(item: dict[str, Any]) -> dict[str, Any]:
        fields = tuple(field for field in WATCHLIST_FIELDS if field not in {"id", "note", "created_at", "updated_at"})
        return {field: item.get(field) for field in fields if field in item}
