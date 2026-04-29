"""Watchlist storage and Longbridge search service."""

from __future__ import annotations

import sqlite3
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterable, Optional

from app.config import get_settings
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

    def search(self, query: str, category: Optional[WatchlistCategory], limit: int) -> list[dict[str, Any]]:
        symbols = self._candidate_symbols(query, category)
        if not symbols:
            return []

        ctx = self._quote_context()
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

    def _quote_context(self):
        try:
            from longbridge.openapi import Config, QuoteContext
        except ImportError as exc:
            raise LongbridgeUnavailableError("Longbridge SDK is not installed") from exc

        settings = get_settings()
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

    def __init__(self, workspace_dir: str):
        root = Path(workspace_dir).expanduser()
        self.db_path = root / "watchlist" / "watchlist.db"
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()
        self.longbridge = LongbridgeSearchClient()

    def list_items(self, category: Optional[WatchlistCategory] = None) -> list[dict[str, Any]]:
        query = "SELECT * FROM watchlist_items"
        params: tuple[Any, ...] = ()
        if category:
            query += " WHERE category = ?"
            params = (category,)
        query += " ORDER BY created_at DESC, id DESC"
        with self._connect() as conn:
            return [dict(row) for row in conn.execute(query, params).fetchall()]

    def add_item(self, item: WatchlistItemCreate) -> dict[str, Any]:
        now = _now()
        payload = item.model_dump()
        payload["symbol"] = item.symbol.strip().upper()
        payload["updated_at"] = now
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO watchlist_items (
                    category, symbol, name, name_cn, name_en, name_hk, exchange,
                    currency, last_done, change_value, change_rate, note,
                    created_at, updated_at
                )
                VALUES (
                    :category, :symbol, :name, :name_cn, :name_en, :name_hk, :exchange,
                    :currency, :last_done, :change_value, :change_rate, :note,
                    :updated_at, :updated_at
                )
                ON CONFLICT(symbol) DO UPDATE SET
                    category = excluded.category,
                    name = excluded.name,
                    name_cn = excluded.name_cn,
                    name_en = excluded.name_en,
                    name_hk = excluded.name_hk,
                    exchange = excluded.exchange,
                    currency = excluded.currency,
                    last_done = excluded.last_done,
                    change_value = excluded.change_value,
                    change_rate = excluded.change_rate,
                    note = excluded.note,
                    updated_at = excluded.updated_at
                """,
                payload,
            )
            row = conn.execute("SELECT * FROM watchlist_items WHERE symbol = ?", (payload["symbol"],)).fetchone()
            conn.commit()
        return dict(row)

    def delete_item(self, item_id: int) -> None:
        with self._connect() as conn:
            cursor = conn.execute("DELETE FROM watchlist_items WHERE id = ?", (item_id,))
            conn.commit()
        if cursor.rowcount == 0:
            raise KeyError(item_id)

    def search(self, query: str, category: Optional[WatchlistCategory], limit: int) -> list[dict[str, Any]]:
        return self.longbridge.search(query=query, category=category, limit=limit)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS watchlist_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    category TEXT NOT NULL CHECK (category IN ('US', 'A', 'H')),
                    symbol TEXT NOT NULL UNIQUE,
                    name TEXT NOT NULL DEFAULT '',
                    name_cn TEXT NOT NULL DEFAULT '',
                    name_en TEXT NOT NULL DEFAULT '',
                    name_hk TEXT NOT NULL DEFAULT '',
                    exchange TEXT NOT NULL DEFAULT '',
                    currency TEXT NOT NULL DEFAULT '',
                    last_done TEXT,
                    change_value TEXT,
                    change_rate TEXT,
                    note TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_watchlist_category ON watchlist_items(category)")
            conn.commit()
