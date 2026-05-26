"""Dashboard aggregation service."""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

from app.core.market.utils import canonical_symbol
from app.core.watchlist.service import LongbridgeUnavailableError
from app.schemas.portfolio import PortfolioMarket

WATCHLIST_CATEGORIES = ("US", "A", "H")
PORTFOLIO_MARKETS: tuple[PortfolioMarket, ...] = ("US", "A")


def _decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    text = str(value).replace(",", "").replace("%", "").strip()
    if not text:
        return None
    try:
        return Decimal(text)
    except (InvalidOperation, TypeError, ValueError):
        return None


def _money(value: Decimal | None) -> str | None:
    if value is None:
        return None
    return format(value.quantize(Decimal("0.01")), "f")


def _ratio(value: Decimal | None) -> str | None:
    if value is None:
        return None
    return f"{value.quantize(Decimal('0.01'))}%"


def _static_watchlist_row(item: dict[str, Any]) -> dict[str, Any]:
    name = item.get("name") or item.get("name_cn") or item.get("name_hk") or item.get("name_en") or ""
    return {
        "symbol": canonical_symbol(item.get("symbol", "")),
        "name": name,
        "category": item.get("category", ""),
        "last_done": item.get("last_done"),
        "prev_close": None,
        "open": None,
        "high": None,
        "low": None,
        "volume": None,
        "turnover": None,
        "change_value": item.get("change_value"),
        "change_rate": item.get("change_rate"),
    }


def _rate(row: dict[str, Any]) -> Decimal | None:
    return _decimal(row.get("change_rate"))


def _activity_value(row: dict[str, Any]) -> Decimal:
    return _decimal(row.get("turnover")) or _decimal(row.get("volume")) or Decimal("-1")


def _abs_rate_value(row: dict[str, Any]) -> Decimal:
    rate = _rate(row)
    return abs(rate) if rate is not None else Decimal("-1")


def _sort_watchlist_views(rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    indexed = list(enumerate(rows))
    movers = sorted(indexed, key=lambda item: (_abs_rate_value(item[1]), -item[0]), reverse=True)
    gainers = sorted(indexed, key=lambda item: (_rate(item[1]) or Decimal("-999999999"), -item[0]), reverse=True)
    losers = sorted(
        indexed,
        key=lambda item: (_rate(item[1]) if _rate(item[1]) is not None else Decimal("999999999"), item[0]),
    )
    active = sorted(indexed, key=lambda item: (_activity_value(item[1]), -item[0]), reverse=True)
    return {
        "movers": [row for _, row in movers],
        "gainers": [row for _, row in gainers],
        "losers": [row for _, row in losers],
        "active": [row for _, row in active],
    }


def _position_sort_value(item: dict[str, Any]) -> Decimal:
    return _decimal(item.get("position_ratio")) or Decimal("-1")


class DashboardService:
    """Aggregate existing domain services into a Dashboard payload."""

    def __init__(self, market_service: Any, watchlist_service: Any, portfolio_service: Any):
        self.market_service = market_service
        self.watchlist_service = watchlist_service
        self.portfolio_service = portfolio_service

    def build(self, *, user: Any, settings: Any) -> dict[str, Any]:
        return {
            "market": self._market(user=user, settings=settings),
            "watchlist": self._watchlist(user=user, settings=settings),
            "portfolio": self._portfolio(user=user, settings=settings),
        }

    def _market(self, *, user: Any, settings: Any) -> dict[str, Any]:
        if not user.can("market:read"):
            return {"available": False, "error": "Missing permission: market:read", "indices": []}
        try:
            return {
                "available": True,
                "error": None,
                "indices": self.market_service.get_index_quotes(user_id=user.id, settings=settings),
            }
        except Exception as exc:
            return {"available": True, "error": str(exc), "indices": []}

    def _watchlist(self, *, user: Any, settings: Any) -> dict[str, Any]:
        if not user.can("watchlist:read"):
            return self._empty_watchlist(available=False, error="Missing permission: watchlist:read")

        try:
            items = self.watchlist_service.list_items(category=None, user_id=user.id)
        except Exception as exc:
            return self._empty_watchlist(error=str(exc))

        counts = {category: 0 for category in WATCHLIST_CATEGORIES}
        for item in items:
            category = item.get("category", "")
            if category in counts:
                counts[category] += 1

        rows = [_static_watchlist_row(item) for item in items]
        quote_error = None
        if rows and user.can("market:read"):
            try:
                quotes = self.market_service.get_watchlist_quotes(items, settings=settings)
                quote_map = {canonical_symbol(row.get("symbol", "")): row for row in quotes}
                rows = [
                    {
                        **row,
                        **{key: value for key, value in quote_map.get(row["symbol"], {}).items() if value not in (None, "")},
                        "name": quote_map.get(row["symbol"], {}).get("name") or row["name"],
                        "category": quote_map.get(row["symbol"], {}).get("category") or row["category"],
                    }
                    for row in rows
                ]
            except LongbridgeUnavailableError as exc:
                quote_error = str(exc)
            except Exception as exc:
                quote_error = str(exc)

        views = _sort_watchlist_views(rows)
        return {
            "available": True,
            "error": None,
            "items": rows,
            "views": views,
            "counts_by_category": counts,
            "total": len(rows),
            "quote_error": quote_error,
        }

    def _empty_watchlist(self, *, available: bool = True, error: str | None = None) -> dict[str, Any]:
        return {
            "available": available,
            "error": error,
            "items": [],
            "views": {"movers": [], "gainers": [], "losers": [], "active": []},
            "counts_by_category": {category: 0 for category in WATCHLIST_CATEGORIES},
            "total": 0,
            "quote_error": None,
        }

    def _portfolio(self, *, user: Any, settings: Any) -> dict[str, Any]:
        if not user.can("portfolio:read"):
            return {"available": False, "error": "Missing permission: portfolio:read", "markets": []}

        markets = []
        errors = []
        for market in PORTFOLIO_MARKETS:
            try:
                payload = self.portfolio_service.list_items(market, user_id=user.id, settings=settings)
                markets.append(self._portfolio_market_summary(payload))
            except Exception as exc:
                errors.append(f"{market}: {exc}")
        return {
            "available": True,
            "error": "; ".join(errors) if errors else None,
            "markets": markets,
        }

    def _portfolio_market_summary(self, payload: dict[str, Any]) -> dict[str, Any]:
        items = payload.get("items") or []
        market_value = Decimal("0")
        cost_value = Decimal("0")
        day_change_value = Decimal("0")
        has_market_value = False
        has_cost_value = False
        has_day_change = False

        for item in items:
            shares = _decimal(item.get("shares"))
            stock_value = _decimal(item.get("stock_value"))
            price = _decimal(item.get("current_price"))
            cost_price = _decimal(item.get("cost_price"))
            change_value = _decimal(item.get("change_value"))

            if stock_value is not None:
                market_value += stock_value
                has_market_value = True
            elif shares is not None and price is not None:
                market_value += shares * price
                has_market_value = True

            if shares is not None and cost_price is not None:
                cost_value += shares * cost_price
                has_cost_value = True

            if shares is not None and change_value is not None:
                day_change_value += shares * change_value
                has_day_change = True

        pnl_value = market_value - cost_value if has_market_value and has_cost_value else None
        pnl_ratio = pnl_value / cost_value * Decimal("100") if pnl_value is not None and cost_value != 0 else None
        previous_market_value = market_value - day_change_value if has_day_change else None
        day_change_rate = (
            day_change_value / previous_market_value * Decimal("100")
            if previous_market_value not in (None, Decimal("0"))
            else None
        )
        top_positions = sorted(items, key=_position_sort_value, reverse=True)[:5]

        return {
            "market": payload.get("market"),
            "total_assets": payload.get("total_assets") or "0",
            "market_value": _money(market_value if has_market_value else Decimal("0")) or "0",
            "cash_amount": payload.get("total_capital") or "0",
            "cash_ratio": payload.get("cash_ratio"),
            "cost_value": _money(cost_value if has_cost_value else Decimal("0")) or "0",
            "unrealized_pnl_value": _money(pnl_value),
            "unrealized_pnl_ratio": _ratio(pnl_ratio),
            "day_change_value": _money(day_change_value) if has_day_change else None,
            "day_change_rate": _ratio(day_change_rate),
            "position_count": int(payload.get("total") or len(items)),
            "quote_error": payload.get("quote_error"),
            "top_positions": top_positions,
        }
