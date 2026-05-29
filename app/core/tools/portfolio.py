"""Agent-facing local portfolio management tool."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, Optional

from pydantic import ValidationError

from app.core.tools.base_tool import BaseTool, ToolResult
from app.core.watchlist.service import LongbridgeUnavailableError
from app.schemas.portfolio import PortfolioItemCreate, PortfolioItemUpdate


PORTFOLIO_FIELDS = (
    "id",
    "market",
    "symbol",
    "name",
    "shares",
    "cost_price",
    "currency",
    "current_price",
    "change_value",
    "change_rate",
    "pe_ttm_ratio",
    "stock_value",
    "position_ratio",
    "pnl_ratio",
    "note",
    "created_at",
    "updated_at",
)


class PortfolioTool(BaseTool):
    name: str = "portfolio"
    description: str = (
        "管理当前用户本地持仓记录时使用此工具。Use this internal bookkeeping tool to list, "
        "get, search, add/upsert, update, delete, adjust share quantities, or set the cash "
        "amount of the user's local portfolio. It only changes local portfolio records and "
        "never places real trades or orders. Symbols use Longbridge format such as AAPL.US "
        "or 600519.SH; US/A-share shorthand symbols are normalized when market is provided."
    )
    params: dict = {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": [
                    "list",
                    "get",
                    "search",
                    "add",
                    "create",
                    "upsert",
                    "update",
                    "delete",
                    "remove",
                    "adjust_shares",
                    "set_total_capital",
                    "set_cash",
                ],
                "description": "Portfolio operation to run.",
            },
            "market": {
                "type": "string",
                "enum": ["US", "A", "ALL"],
                "description": "Portfolio market. US = US stocks, A = A-shares, ALL is only valid for list.",
            },
            "item_id": {"type": "integer", "description": "Portfolio item id for get/update/delete."},
            "id": {"type": "integer", "description": "Alias for item_id."},
            "symbol": {
                "type": "string",
                "description": "Symbol to select or create. For update/delete/get, this selects the existing holding.",
            },
            "new_symbol": {"type": "string", "description": "Optional replacement symbol when action=update."},
            "new_market": {"type": "string", "enum": ["US", "A"], "description": "Optional replacement market when action=update."},
            "name": {"type": "string", "description": "Holding display name."},
            "shares": {"type": "string", "description": "Final share quantity to store."},
            "shares_delta": {
                "type": "string",
                "description": "Positive or negative share quantity change for action=adjust_shares.",
            },
            "delta": {"type": "string", "description": "Alias for shares_delta."},
            "cost_price": {"type": "string", "description": "Final average cost price to store."},
            "trade_price": {
                "type": "string",
                "description": "Trade price used by adjust_shares to recompute average cost for share increases.",
            },
            "note": {"type": "string", "description": "Holding note."},
            "total_capital": {
                "type": "string",
                "description": "Cash amount / portfolio-level capital field for set_total_capital or set_cash.",
            },
            "cash": {"type": "string", "description": "Alias for total_capital."},
            "delete_when_zero": {
                "type": "boolean",
                "description": "For adjust_shares, delete the holding if the resulting shares are zero.",
                "default": False,
            },
            "query": {"type": "string", "description": "Search query for Longbridge symbol lookup."},
            "q": {"type": "string", "description": "Alias for query."},
            "limit": {"type": "integer", "minimum": 1, "maximum": 20, "default": 10},
        },
        "required": ["action"],
    }

    def __init__(self, portfolio_service: Any = None, user_id: Optional[str] = None, settings: Any = None):
        self.portfolio_service = portfolio_service
        self.user_id = user_id
        self.settings = settings

    def execute(self, params: Dict[str, Any]) -> ToolResult:
        service = self._get_portfolio_service()
        if service is None:
            return ToolResult.fail("Portfolio service not initialized")

        action = self._normalize_action(params.get("action"))
        handlers = {
            "list": self._list,
            "get": self._get,
            "search": self._search,
            "upsert": self._upsert,
            "update": self._update,
            "delete": self._delete,
            "adjust_shares": self._adjust_shares,
            "set_total_capital": self._set_total_capital,
        }
        handler = handlers.get(action)
        if handler is None:
            return ToolResult.fail(f"Unknown action: {params.get('action')}")

        try:
            return ToolResult.success(handler(service, params))
        except LongbridgeUnavailableError as exc:
            return ToolResult.fail(str(exc))
        except (KeyError, LookupError) as exc:
            return ToolResult.fail(str(exc) or "Portfolio item not found")
        except (TypeError, ValueError, ValidationError, InvalidOperation) as exc:
            return ToolResult.fail(str(exc))

    def _get_portfolio_service(self):
        if self.portfolio_service is not None:
            return self.portfolio_service
        try:
            from app.deps import get_portfolio_service

            return get_portfolio_service()
        except Exception:
            return None

    def _list(self, service: Any, params: Dict[str, Any]) -> dict[str, Any]:
        market = self._market(params.get("market") or "US", allow_all=True)
        markets = ["US", "A"] if market == "ALL" else [market]
        results = [
            self._sanitize_portfolio_list(
                service.list_items(item_market, user_id=self.user_id, settings=self.settings)
            )
            for item_market in markets
        ]
        return {
            "source": "portfolio",
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "market": market,
            "markets": results,
            "total_positions": sum(int(item.get("total", 0) or 0) for item in results),
            "quote_errors": [
                {"market": item["market"], "error": item["quote_error"]}
                for item in results
                if item.get("quote_error")
            ],
        }

    def _get(self, service: Any, params: Dict[str, Any]) -> dict[str, Any]:
        item = self._find_item(service, params)
        return {"source": "portfolio", "item": self._sanitize_item(item)}

    def _search(self, service: Any, params: Dict[str, Any]) -> dict[str, Any]:
        query = str(params.get("query") or params.get("q") or params.get("symbol") or "").strip()
        if not query:
            raise ValueError("query is required for search")
        market = self._market(params.get("market") or "US")
        limit = self._bounded_int(params.get("limit"), default=10, minimum=1, maximum=20, name="limit")
        results = [
            self._sanitize_search_result(item)
            for item in service.search(query=query, market=market, limit=limit, settings=self.settings)
        ]
        return {
            "source": "longbridge",
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "query": query,
            "market": market,
            "results": results,
            "total": len(results),
        }

    def _upsert(self, service: Any, params: Dict[str, Any]) -> dict[str, Any]:
        existing = self._try_find_item(service, params)
        if existing:
            item = self._update_existing(service, existing, params, allow_symbol_replacement=False)
            operation = "update"
        else:
            item = service.add_item(PortfolioItemCreate(**self._create_payload(params)), user_id=self.user_id)
            operation = "create"
        return {"status": "ok", "operation": operation, "item": self._sanitize_item(item)}

    def _update(self, service: Any, params: Dict[str, Any]) -> dict[str, Any]:
        current = self._find_item(service, params)
        item = self._update_existing(service, current, params, allow_symbol_replacement=True)
        return {"status": "ok", "operation": "update", "item": self._sanitize_item(item)}

    def _delete(self, service: Any, params: Dict[str, Any]) -> dict[str, Any]:
        item = self._find_item(service, params)
        service.delete_item(int(item["id"]), user_id=self.user_id)
        return {"status": "ok", "operation": "delete", "deleted_item": self._sanitize_item(item)}

    def _adjust_shares(self, service: Any, params: Dict[str, Any]) -> dict[str, Any]:
        delta = self._decimal(params.get("shares_delta") if params.get("shares_delta") is not None else params.get("delta"), "shares_delta", required=True)
        if delta == 0:
            raise ValueError("shares_delta must not be zero")

        current = self._try_find_item(service, params)
        if current is None:
            if delta < 0:
                raise LookupError("Portfolio item not found")
            payload = self._create_payload({**params, "shares": self._decimal_text(delta)})
            item = service.add_item(PortfolioItemCreate(**payload), user_id=self.user_id)
            return {"status": "ok", "operation": "create", "item": self._sanitize_item(item)}

        current_shares = self._decimal(current.get("shares"), "current shares") or Decimal("0")
        next_shares = current_shares + delta
        if next_shares < 0:
            raise ValueError("shares_delta would make shares negative")
        if next_shares == 0 and self._bool(params.get("delete_when_zero")):
            service.delete_item(int(current["id"]), user_id=self.user_id)
            return {"status": "ok", "operation": "delete", "deleted_item": self._sanitize_item(current)}

        patch: dict[str, Any] = {"shares": self._decimal_text(next_shares)}
        next_cost = self._adjusted_cost_price(current, delta, next_shares, params)
        if next_cost is not None:
            patch["cost_price"] = self._decimal_text(next_cost)
        if "note" in params:
            patch["note"] = str(params.get("note") or "")
        item = service.update_item(int(current["id"]), PortfolioItemUpdate(**patch), user_id=self.user_id)
        return {"status": "ok", "operation": "adjust_shares", "item": self._sanitize_item(item)}

    def _set_total_capital(self, service: Any, params: Dict[str, Any]) -> dict[str, Any]:
        market = self._market(params.get("market") or "US")
        amount = params.get("total_capital") if params.get("total_capital") is not None else params.get("cash")
        if amount is None or str(amount).strip() == "":
            raise ValueError("total_capital or cash is required")
        saved = service.save_settings(market, str(amount), user_id=self.user_id)
        return {"status": "ok", "operation": "set_total_capital", "settings": self._sanitize_settings(saved)}

    def _update_existing(
        self,
        service: Any,
        current: dict[str, Any],
        params: Dict[str, Any],
        *,
        allow_symbol_replacement: bool,
    ) -> dict[str, Any]:
        patch: dict[str, Any] = {}
        if allow_symbol_replacement and params.get("new_market") not in (None, ""):
            patch["market"] = self._market(params.get("new_market"))
        if allow_symbol_replacement and params.get("new_symbol"):
            patch["symbol"] = str(params.get("new_symbol") or "").strip().upper()
            patch.setdefault("market", self._market(params.get("new_market") or current.get("market")))
        for field in ("name", "shares", "cost_price", "note"):
            if field not in params:
                continue
            value = params.get(field)
            if field in {"shares", "cost_price"} and value is not None:
                patch[field] = str(value)
            else:
                patch[field] = "" if value is None and field in {"name", "note"} else value
        if not patch:
            return current
        return service.update_item(int(current["id"]), PortfolioItemUpdate(**patch), user_id=self.user_id)

    def _create_payload(self, params: Dict[str, Any]) -> dict[str, Any]:
        market = self._market(params.get("market"), required=True)
        symbol = str(params.get("symbol") or "").strip().upper()
        if not symbol:
            raise ValueError("symbol is required")
        cost_price = params.get("cost_price")
        if cost_price is None and params.get("trade_price") is not None:
            cost_price = params.get("trade_price")
        return {
            "market": market,
            "symbol": symbol,
            "name": str(params.get("name") or ""),
            "shares": str(params.get("shares")) if params.get("shares") is not None else None,
            "cost_price": str(cost_price) if cost_price is not None else None,
            "note": str(params.get("note") or ""),
        }

    def _find_item(self, service: Any, params: Dict[str, Any]) -> dict[str, Any]:
        raw_item_id = params.get("item_id") if params.get("item_id") is not None else params.get("id")
        item_id = self._optional_int(raw_item_id, "item_id")
        if item_id is not None:
            return service.get_item(item_id, user_id=self.user_id)

        symbol = str(params.get("symbol") or "").strip().upper()
        if not symbol:
            raise ValueError("item_id or symbol is required")

        candidates = self._find_symbol_matches(service, symbol, params.get("market"))
        if len(candidates) > 1:
            raise ValueError("Multiple portfolio items match symbol; provide market or item_id")
        if not candidates:
            raise LookupError("Portfolio item not found")
        return candidates[0]

    def _try_find_item(self, service: Any, params: Dict[str, Any]) -> Optional[dict[str, Any]]:
        try:
            return self._find_item(service, params)
        except (KeyError, LookupError, ValueError):
            return None

    def _find_symbol_matches(self, service: Any, symbol: str, market_value: Any) -> list[dict[str, Any]]:
        markets = self._candidate_markets(symbol, market_value)
        matches: list[dict[str, Any]] = []
        for market in markets:
            canonical = self._canonical_symbol(symbol, market)
            for item in self._local_items(service, market):
                item_symbol = str(item.get("symbol") or "").upper()
                if item_symbol == canonical or ("." not in symbol and item_symbol.split(".", 1)[0] == symbol):
                    matches.append(item)
        return matches

    def _local_items(self, service: Any, market: str) -> list[dict[str, Any]]:
        repository = getattr(service, "repository", None)
        if repository is not None and hasattr(repository, "list_items"):
            return repository.list_items(market, user_id=self.user_id)
        data = service.list_items(market, user_id=self.user_id, settings=None)
        return list(data.get("items", [])) if isinstance(data, dict) else list(data or [])

    def _adjusted_cost_price(
        self,
        current: dict[str, Any],
        delta: Decimal,
        next_shares: Decimal,
        params: Dict[str, Any],
    ) -> Optional[Decimal]:
        if params.get("cost_price") not in (None, "") and params.get("trade_price") in (None, ""):
            return self._decimal(params.get("cost_price"), "cost_price")

        trade_price = self._decimal(params.get("trade_price"), "trade_price")
        current_cost = self._decimal(current.get("cost_price"), "current cost_price")
        current_shares = self._decimal(current.get("shares"), "current shares") or Decimal("0")
        if trade_price is None:
            return current_cost
        if delta <= 0 or next_shares <= 0:
            return current_cost
        if current_cost is None or current_shares <= 0:
            return trade_price
        return ((current_shares * current_cost) + (delta * trade_price)) / next_shares

    @staticmethod
    def _normalize_action(value: Any) -> str:
        action = str(value or "").strip().lower().replace("-", "_")
        aliases = {
            "create": "upsert",
            "add": "upsert",
            "remove": "delete",
            "set_cash": "set_total_capital",
            "set_capital": "set_total_capital",
            "cash": "set_total_capital",
            "adjust": "adjust_shares",
        }
        return aliases.get(action, action)

    @staticmethod
    def _market(value: Any, required: bool = False, allow_all: bool = False) -> Optional[str]:
        if value is None or value == "":
            if required:
                raise ValueError("market is required")
            return None
        normalized = str(value).strip().upper().replace("-", "").replace("_", "")
        aliases = {
            "美股": "US",
            "美国": "US",
            "USTOCK": "US",
            "USTOCKS": "US",
            "A股": "A",
            "沪深": "A",
            "中国": "A",
            "CN": "A",
            "CHINA": "A",
            "ASHARE": "A",
            "ASHARES": "A",
        }
        market = aliases.get(normalized, normalized)
        allowed = {"US", "A"} | ({"ALL"} if allow_all else set())
        if market not in allowed:
            suffix = "ALL" if allow_all else "US, A"
            raise ValueError(f"market must be one of: {suffix}")
        return market

    @classmethod
    def _candidate_markets(cls, symbol: str, market_value: Any) -> list[str]:
        market = cls._market(market_value) if market_value not in (None, "") else None
        if market:
            return [market]
        suffix = symbol.rsplit(".", 1)[-1].upper() if "." in symbol else ""
        if suffix == "US":
            return ["US"]
        if suffix in {"SH", "SZ"}:
            return ["A"]
        return ["US", "A"]

    @staticmethod
    def _canonical_symbol(symbol: str, market: Optional[str] = None) -> str:
        normalized = str(symbol or "").strip().upper()
        if "." in normalized or not market:
            return normalized
        if market == "US":
            return f"{normalized}.US"
        suffix = "SH" if normalized.startswith(("5", "6", "9")) else "SZ"
        return f"{normalized}.{suffix}"

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

    @staticmethod
    def _decimal(value: Any, name: str, required: bool = False) -> Optional[Decimal]:
        if value is None or value == "":
            if required:
                raise ValueError(f"{name} is required")
            return None
        text = str(value).replace(",", "").strip()
        try:
            return Decimal(text)
        except (InvalidOperation, TypeError, ValueError) as exc:
            raise ValueError(f"{name} must be a number") from exc

    @staticmethod
    def _decimal_text(value: Decimal) -> str:
        return format(value.normalize(), "f")

    @staticmethod
    def _bool(value: Any) -> bool:
        if isinstance(value, bool):
            return value
        return str(value or "").strip().lower() in {"1", "true", "yes", "y", "on"}

    def _sanitize_portfolio_list(self, data: dict[str, Any]) -> dict[str, Any]:
        return {
            "market": data.get("market"),
            "total_capital": data.get("total_capital", "0"),
            "total_assets": data.get("total_assets", "0"),
            "cash_ratio": data.get("cash_ratio"),
            "items": [self._sanitize_item(item) for item in data.get("items", [])],
            "total": data.get("total", 0),
            "quote_error": data.get("quote_error"),
        }

    @staticmethod
    def _sanitize_item(item: dict[str, Any]) -> dict[str, Any]:
        # 工具结果只暴露持仓业务字段，避免把内部用户标识混进 LLM 上下文。
        return {field: item.get(field) for field in PORTFOLIO_FIELDS if field in item}

    @staticmethod
    def _sanitize_settings(settings: dict[str, Any]) -> dict[str, Any]:
        return {
            "market": settings.get("market"),
            "total_capital": settings.get("total_capital", "0"),
        }

    @staticmethod
    def _sanitize_search_result(item: dict[str, Any]) -> dict[str, Any]:
        fields = ("market", "symbol", "name", "currency", "last_done", "change_rate")
        return {field: item.get(field) for field in fields if field in item}
