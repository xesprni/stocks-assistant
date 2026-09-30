"""Agent-facing watchlist CRUD tool."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import ValidationError

from app.constants.common import OperationStatus
from app.constants.market import DEFAULT_SYMBOL_SEARCH_LIMIT, MAX_SYMBOL_SEARCH_LIMIT
from app.constants.tools import (
    ITEM_PAYLOAD_FIELDS as ITEM_PAYLOAD_FIELDS,
)
from app.constants.tools import (
    WATCHLIST_ACTION_ALIASES,
    WATCHLIST_CATEGORY_ALIASES,
)
from app.constants.tools import (
    WATCHLIST_FIELDS as WATCHLIST_FIELDS,
)
from app.core.market.errors import LongbridgeUnavailableError
from app.core.tools.base_tool import BaseTool, ToolResult
from app.core.tools.parameters import bounded_positive_int, optional_positive_int
from app.schemas.common import RefreshResponse
from app.schemas.tool_outputs import (
    ItemDeletionResult,
    ItemMutationResult,
    ToolItemResult,
    WatchlistToolList,
    WatchlistToolSearch,
)
from app.schemas.watchlist import WatchlistItem, WatchlistItemCreate, WatchlistSearchResult


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
            "item_id": {
                "type": "integer",
                "description": "Watchlist item id for get/update/delete.",
            },
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
            "query": {
                "type": "string",
                "description": "Search query for Longbridge symbol lookup.",
            },
            "q": {"type": "string", "description": "Alias for query."},
            "limit": {
                "type": "integer",
                "minimum": 1,
                "maximum": MAX_SYMBOL_SEARCH_LIMIT,
                "default": DEFAULT_SYMBOL_SEARCH_LIMIT,
            },
        },
        "required": ["action"],
    }

    def is_read_only(self, params: dict[str, Any]) -> bool:
        return str(params.get("action") or "").strip().lower() in {"search", "list", "get"}

    def __init__(
        self, watchlist_service: Any = None, user_id: str | None = None, settings: Any = None
    ):
        self.watchlist_service = watchlist_service
        self.user_id = user_id
        self.settings = settings

    def execute(self, params: dict[str, Any]) -> ToolResult:
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

    def _list(self, service: Any, params: dict[str, Any]) -> WatchlistToolList:
        category = self._category(params.get("category"))
        items = [
            self._sanitize_item(item) for item in service.list_items(category, user_id=self.user_id)
        ]
        return WatchlistToolList(
            source="watchlist",
            generated_at=datetime.now().isoformat(timespec="seconds"),
            category=category or "ALL",
            items=items,
            total=len(items),
        )

    def _get(self, service: Any, params: dict[str, Any]) -> ToolItemResult[WatchlistItem]:
        item = self._find_item(service, params)
        return ToolItemResult[WatchlistItem](source="watchlist", item=self._sanitize_item(item))

    def _add(self, service: Any, params: dict[str, Any]) -> ItemMutationResult[WatchlistItem]:
        payload = self._create_payload(params)
        item = WatchlistItem.model_validate(
            service.add_item(WatchlistItemCreate.model_validate(payload), user_id=self.user_id)
        )
        return ItemMutationResult[WatchlistItem](
            status=OperationStatus.OK, item=self._sanitize_item(item)
        )

    def _update(self, service: Any, params: dict[str, Any]) -> ItemMutationResult[WatchlistItem]:
        current = self._find_item(service, params, use_category_filter=False)
        payload = {field: getattr(current, field) for field in ITEM_PAYLOAD_FIELDS}
        has_updates = False

        # symbol 在 update 中用于定位现有条目；如需改代码本身，先 add 新 symbol 再 delete 旧条目更清晰。
        for field in ITEM_PAYLOAD_FIELDS:
            if field == "symbol":
                continue
            if field not in params:
                continue
            payload[field] = (
                self._category(params[field], required=True)
                if field == "category"
                else params[field]
            )
            has_updates = True

        if not has_updates:
            return ItemMutationResult[WatchlistItem](
                status=OperationStatus.OK, item=self._sanitize_item(current)
            )

        item = WatchlistItem.model_validate(
            service.add_item(WatchlistItemCreate.model_validate(payload), user_id=self.user_id)
        )
        return ItemMutationResult[WatchlistItem](
            status=OperationStatus.OK, item=self._sanitize_item(item)
        )

    def _delete(self, service: Any, params: dict[str, Any]) -> ItemDeletionResult[WatchlistItem]:
        item = self._find_item(service, params)
        service.delete_item(item.id, user_id=self.user_id)
        return ItemDeletionResult[WatchlistItem](
            status=OperationStatus.OK, deleted_item=self._sanitize_item(item)
        )

    def _reorder(self, service: Any, params: dict[str, Any]) -> RefreshResponse:
        ids = self._id_list(params.get("ids") or params.get("ordered_ids"))
        if not ids:
            raise ValueError("ids is required for reorder")
        service.reorder_items(ids, user_id=self.user_id)
        return RefreshResponse(status=OperationStatus.OK, total=len(ids))

    def _search(self, service: Any, params: dict[str, Any]) -> WatchlistToolSearch:
        query = str(params.get("query") or params.get("q") or params.get("symbol") or "").strip()
        if not query:
            raise ValueError("query is required for search")
        limit = self._bounded_int(
            params.get("limit"),
            default=DEFAULT_SYMBOL_SEARCH_LIMIT,
            minimum=1,
            maximum=MAX_SYMBOL_SEARCH_LIMIT,
            name="limit",
        )
        category = self._category(params.get("category"))
        results = [
            self._sanitize_search_result(item)
            for item in service.search(
                query=query, category=category, limit=limit, settings=self.settings
            )
        ]
        return WatchlistToolSearch(
            source="longbridge",
            generated_at=datetime.now().isoformat(timespec="seconds"),
            query=query,
            category=category or "ALL",
            results=results,
            total=len(results),
        )

    def _find_item(
        self, service: Any, params: dict[str, Any], use_category_filter: bool = True
    ) -> WatchlistItem:
        raw_item_id = (
            params.get("item_id") if params.get("item_id") is not None else params.get("id")
        )
        item_id = self._optional_int(raw_item_id, "item_id")
        symbol = str(params.get("symbol") or "").strip().upper()
        if item_id is None and not symbol:
            raise ValueError("item_id or symbol is required")

        category = self._category(params.get("category")) if use_category_filter else None
        items = [
            WatchlistItem.model_validate(item)
            for item in service.list_items(category, user_id=self.user_id)
        ]
        for item in items:
            if item_id is not None and item.id == item_id:
                return item
            if symbol and item.symbol.upper() == symbol:
                return item
        raise LookupError("Watchlist item not found")

    def _create_payload(self, params: dict[str, Any]) -> WatchlistItemCreate:
        symbol = str(params.get("symbol") or "").strip().upper()
        if not symbol:
            raise ValueError("symbol is required")
        return WatchlistItemCreate(
            category=self._category(params.get("category"), required=True),
            symbol=symbol,
            name=str(params.get("name") or ""),
            name_cn=str(params.get("name_cn") or ""),
            name_en=str(params.get("name_en") or ""),
            name_hk=str(params.get("name_hk") or ""),
            exchange=str(params.get("exchange") or ""),
            currency=str(params.get("currency") or ""),
            last_done=params.get("last_done"),
            change_value=params.get("change_value"),
            change_rate=params.get("change_rate"),
            note=str(params.get("note") or ""),
        )

    @staticmethod
    def _normalize_action(value: Any) -> str:
        action = str(value or "").strip().lower()
        aliases = WATCHLIST_ACTION_ALIASES
        return aliases.get(action, action)

    @staticmethod
    def _category(value: Any, required: bool = False) -> str | None:
        if value is None or value == "":
            if required:
                raise ValueError("category is required")
            return None
        normalized = str(value).strip().upper().replace("-", "").replace("_", "")
        aliases = WATCHLIST_CATEGORY_ALIASES
        category = aliases.get(normalized, normalized)
        if category is None and not required:
            return None
        if category not in {"US", "A", "H"}:
            raise ValueError("category must be one of: US, A, H")
        return category

    _optional_int = staticmethod(optional_positive_int)

    _bounded_int = staticmethod(bounded_positive_int)

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
    def _sanitize_item(item: WatchlistItem | dict[str, Any]) -> WatchlistItem:
        # 模型只声明公开业务字段，忽略数据库行中的内部用户标识。
        return WatchlistItem.model_validate(item)

    @staticmethod
    def _sanitize_search_result(
        item: WatchlistSearchResult | dict[str, Any],
    ) -> WatchlistSearchResult:
        return WatchlistSearchResult.model_validate(item)
