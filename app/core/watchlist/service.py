"""Watchlist storage and Longbridge search service."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterable, Optional

from app.config import get_settings
from app.core.orm.repositories.watchlist import WatchlistRepository
from app.schemas.watchlist import WatchlistCategory, WatchlistItemCreate


class LongbridgeUnavailableError(RuntimeError):
    """Raised when Longbridge SDK or credentials are unavailable."""


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _decimal_to_str(value: Any) -> Optional[str]:
    if value is None:
        return None
    return str(value)


def _change_rate(last_done: Any, prev_close: Any) -> Optional[str]:
    try:
        last_value = Decimal(str(last_done))
        prev_value = Decimal(str(prev_close))
    except (InvalidOperation, TypeError, ValueError):
        return None
    if prev_value == 0:
        return None
    return f"{((last_value - prev_value) / prev_value * Decimal('100')):.2f}%"


def _category_from_symbol(symbol: str) -> WatchlistCategory:
    suffix = symbol.rsplit(".", 1)[-1].upper() if "." in symbol else ""
    if suffix == "US":
        return "US"
    if suffix == "HK":
        return "H"
    return "A"


def _name_from_static(info: Any) -> str:
    for attr in ("name_cn", "name_hk", "name_en"):
        value = getattr(info, attr, "")
        if value:
            return str(value)
    return getattr(info, "symbol", "")


class LongbridgeSearchClient:
    """Small adapter around Longbridge SDK quote APIs."""

    def search(self, query: str, category: Optional[WatchlistCategory], limit: int, settings: Any = None) -> list[dict[str, Any]]:
        symbols = self._candidate_symbols(query, category)
        if not symbols:
            return []

        ctx = self._quote_context(settings=settings)
        try:
            static_infos = list(ctx.static_info(symbols))
        except Exception as exc:  # SDK wraps auth/network/API errors.
            raise LongbridgeUnavailableError(str(exc)) from exc

        if not static_infos:
            return []

        quote_by_symbol: dict[str, Any] = {}
        try:
            quotes = ctx.quote([getattr(item, "symbol", "") for item in static_infos])
            quote_by_symbol = {getattr(item, "symbol", ""): item for item in quotes}
        except Exception:
            quote_by_symbol = {}

        results: list[dict[str, Any]] = []
        for info in static_infos:
            symbol = str(getattr(info, "symbol", "")).upper()
            if not symbol:
                continue
            quote = quote_by_symbol.get(symbol)
            last_done = getattr(quote, "last_done", None) if quote else None
            prev_close = getattr(quote, "prev_close", None) if quote else None
            change_value = None
            if last_done is not None and prev_close is not None:
                try:
                    change_value = str(Decimal(str(last_done)) - Decimal(str(prev_close)))
                except (InvalidOperation, TypeError, ValueError):
                    change_value = None

            results.append(
                {
                    "category": _category_from_symbol(symbol),
                    "symbol": symbol,
                    "name": _name_from_static(info),
                    "name_cn": str(getattr(info, "name_cn", "") or ""),
                    "name_en": str(getattr(info, "name_en", "") or ""),
                    "name_hk": str(getattr(info, "name_hk", "") or ""),
                    "exchange": str(getattr(info, "exchange", "") or ""),
                    "currency": str(getattr(info, "currency", "") or ""),
                    "last_done": _decimal_to_str(last_done),
                    "change_value": change_value,
                    "change_rate": _change_rate(last_done, prev_close),
                }
            )

        return results[:limit]

    def _quote_context(self, settings: Any = None):
        try:
            from longbridge.openapi import Config, QuoteContext
        except ImportError as exc:
            raise LongbridgeUnavailableError("Longbridge SDK is not installed") from exc

        settings = settings or get_settings()
        if (
            settings.longbridge_app_key
            and settings.longbridge_app_secret
            and settings.longbridge_access_token
        ):
            config = Config.from_apikey(
                settings.longbridge_app_key,
                settings.longbridge_app_secret,
                settings.longbridge_access_token,
                http_url=settings.longbridge_http_url or None,
                quote_ws_url=settings.longbridge_quote_ws_url or None,
            )
        else:
            try:
                config = Config.from_apikey_env()
            except Exception as exc:
                raise LongbridgeUnavailableError(
                    "Longbridge credentials are not configured. Set LONGBRIDGE_APP_KEY, "
                    "LONGBRIDGE_APP_SECRET and LONGBRIDGE_ACCESS_TOKEN, or add them to config.json."
                ) from exc

        return QuoteContext(config)

    def _candidate_symbols(self, query: str, category: Optional[WatchlistCategory]) -> list[str]:
        normalized = query.strip().upper()
        if not normalized:
            return []
        if "." in normalized:
            return [normalized]

        categories: Iterable[WatchlistCategory]
        if category:
            categories = [category]
        elif normalized.isdigit():
            categories = ["H", "A"]
        else:
            categories = ["US"]

        symbols: list[str] = []
        for item in categories:
            if item == "US":
                symbols.append(f"{normalized}.US")
            elif item == "H":
                symbols.append(f"{normalized.lstrip('0') or '0'}.HK")
            else:
                suffix = "SH" if normalized.startswith(("5", "6", "9")) else "SZ"
                symbols.append(f"{normalized}.{suffix}")

        return list(dict.fromkeys(symbols))


class WatchlistService:
    """SQLite-backed watchlist service."""

    def __init__(self, workspace_dir: str, repository: WatchlistRepository | None = None):
        root = Path(workspace_dir).expanduser()
        self.db_path = root / "watchlist" / "watchlist.db"
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.repository = repository or WatchlistRepository(self.db_path)
        self.longbridge = LongbridgeSearchClient()

    def list_items(self, category: Optional[WatchlistCategory] = None, user_id: Optional[str] = None) -> list[dict[str, Any]]:
        return self.repository.list_items(category=category, user_id=user_id)

    def reorder_items(self, ordered_ids: list[int], user_id: Optional[str] = None) -> None:
        """Update sort_order for each item according to the provided ID sequence."""
        self.repository.reorder_items(ordered_ids, user_id=user_id)

    def add_item(self, item: WatchlistItemCreate, user_id: Optional[str] = None) -> dict[str, Any]:
        now = _now()
        payload = item.model_dump()
        payload["user_id"] = user_id or ""
        payload["symbol"] = item.symbol.strip().upper()
        payload["updated_at"] = now
        payload["created_at"] = now
        return self.repository.add_item(payload)

    def delete_item(self, item_id: int, user_id: Optional[str] = None) -> None:
        if not self.repository.delete_item(item_id, user_id=user_id):
            raise KeyError(item_id)

    def search(self, query: str, category: Optional[WatchlistCategory], limit: int, settings: Any = None) -> list[dict[str, Any]]:
        return self.longbridge.search(query=query, category=category, limit=limit, settings=settings)
