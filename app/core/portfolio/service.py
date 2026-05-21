"""SQLite-backed portfolio service with Longbridge quote enrichment."""

from __future__ import annotations

import sqlite3
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Optional

from app.core.watchlist.service import LongbridgeSearchClient, LongbridgeUnavailableError
from app.schemas.portfolio import PortfolioItemCreate, PortfolioItemUpdate, PortfolioMarket


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _decimal(value: Any) -> Optional[Decimal]:
    if value is None:
        return None
    text = str(value).replace(",", "").strip()
    if not text:
        return None
    try:
        return Decimal(text)
    except (InvalidOperation, TypeError, ValueError):
        return None


def _decimal_text(value: Any) -> Optional[str]:
    number = _decimal(value)
    if number is None:
        return None
    return format(number.normalize(), "f")


def _money(value: Optional[Decimal]) -> Optional[str]:
    if value is None:
        return None
    return format(value.quantize(Decimal("0.01")), "f")


def _ratio(value: Optional[Decimal]) -> Optional[str]:
    if value is None:
        return None
    return f"{value.quantize(Decimal('0.01'))}%"


def _change_value(last_done: Any, prev_close: Any) -> Optional[str]:
    last = _decimal(last_done)
    prev = _decimal(prev_close)
    if last is None or prev is None:
        return None
    return _money(last - prev)


def _change_rate(last_done: Any, prev_close: Any) -> Optional[str]:
    last = _decimal(last_done)
    prev = _decimal(prev_close)
    if last is None or prev in (None, Decimal("0")):
        return None
    return _ratio((last - prev) / prev * Decimal("100"))


def _canonical_symbol(symbol: str, market: Optional[PortfolioMarket] = None) -> str:
    normalized = symbol.strip().upper()
    if "." in normalized or not market:
        return normalized
    if market == "US":
        return f"{normalized}.US"
    # A 股根据代码段推断交易所后缀，满足 Longbridge 报价接口的标准 symbol 格式。
    suffix = "SH" if normalized.startswith(("5", "6", "9")) else "SZ"
    return f"{normalized}.{suffix}"


def _market_from_symbol(symbol: str) -> PortfolioMarket:
    suffix = symbol.rsplit(".", 1)[-1].upper() if "." in symbol else ""
    return "US" if suffix == "US" else "A"


class PortfolioService:
    """Local portfolio CRUD and quote enrichment."""

    def __init__(self, workspace_dir: str):
        root = Path(workspace_dir).expanduser()
        self.db_path = root / "portfolio" / "portfolio.db"
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()
        self.longbridge = LongbridgeSearchClient()

    def list_items(self, market: PortfolioMarket) -> dict[str, Any]:
        cash_amount = self.get_settings(market)["total_capital"]
        with self._connect() as conn:
            rows = [
                dict(row)
                for row in conn.execute(
                    "SELECT * FROM portfolio_items WHERE market = ? ORDER BY sort_order ASC, id ASC",
                    (market,),
                ).fetchall()
            ]

        quote_error = None
        try:
            items, total_assets, cash_ratio = self._enrich_items(rows, cash_amount)
        except LongbridgeUnavailableError as exc:
            # 行情不可用时仍返回本地持仓，前端可以展示静态数据并提示 quote_error。
            quote_error = str(exc)
            items = [self._empty_enriched_item(row) for row in rows]
            cash = _decimal(cash_amount) or Decimal("0")
            total_assets = _money(cash) or "0.00"
            cash_ratio = _ratio(Decimal("100")) if cash > 0 else None

        return {
            "market": market,
            "total_capital": cash_amount,
            "total_assets": total_assets,
            "cash_ratio": cash_ratio,
            "items": items,
            "total": len(items),
            "quote_error": quote_error,
        }

    def get_settings(self, market: PortfolioMarket) -> dict[str, str]:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM portfolio_settings WHERE market = ?", (market,)).fetchone()
            if row:
                return dict(row)
        return {"market": market, "total_capital": "0"}

    def save_settings(self, market: PortfolioMarket, total_capital: str) -> dict[str, str]:
        value = _decimal_text(total_capital) or "0"
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO portfolio_settings (market, total_capital, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(market) DO UPDATE SET
                    total_capital = excluded.total_capital,
                    updated_at = excluded.updated_at
                """,
                (market, value, _now()),
            )
            conn.commit()
        return {"market": market, "total_capital": value}

    def add_item(self, item: PortfolioItemCreate) -> dict[str, Any]:
        now = _now()
        payload = item.model_dump()
        payload["symbol"] = _canonical_symbol(item.symbol, item.market)
        payload["shares"] = _decimal_text(item.shares)
        payload["cost_price"] = _decimal_text(item.cost_price)
        payload["updated_at"] = now
        with self._connect() as conn:
            max_order = conn.execute(
                "SELECT COALESCE(MAX(sort_order), -1) FROM portfolio_items WHERE market = ?",
                (payload["market"],),
            ).fetchone()[0]
            payload["sort_order"] = max_order + 1
            conn.execute(
                """
                INSERT INTO portfolio_items (
                    market, symbol, name, shares, cost_price, note,
                    sort_order, created_at, updated_at
                )
                VALUES (
                    :market, :symbol, :name, :shares, :cost_price, :note,
                    :sort_order, :updated_at, :updated_at
                )
                ON CONFLICT(symbol) DO UPDATE SET
                    market = excluded.market,
                    name = excluded.name,
                    shares = excluded.shares,
                    cost_price = excluded.cost_price,
                    note = excluded.note,
                    updated_at = excluded.updated_at
                """,
                payload,
            )
            row = conn.execute("SELECT * FROM portfolio_items WHERE symbol = ?", (payload["symbol"],)).fetchone()
            conn.commit()
        return self._empty_enriched_item(dict(row))

    def update_item(self, item_id: int, item: PortfolioItemUpdate) -> dict[str, Any]:
        patch = item.model_dump(exclude_unset=True)
        if not patch:
            return self.get_item(item_id)

        if "symbol" in patch and patch["symbol"] is not None:
            market = patch.get("market")
            if market is None:
                current = self.get_item(item_id)
                market = current.get("market")
            patch["symbol"] = _canonical_symbol(patch["symbol"], market)
        if "shares" in patch:
            patch["shares"] = _decimal_text(patch["shares"])
        if "cost_price" in patch:
            patch["cost_price"] = _decimal_text(patch["cost_price"])

        # patch 字段来自 Pydantic schema 的白名单，动态拼接只覆盖请求中出现的列。
        assignments = [f"{key} = :{key}" for key in patch]
        patch["id"] = item_id
        patch["updated_at"] = _now()
        assignments.append("updated_at = :updated_at")
        with self._connect() as conn:
            cursor = conn.execute(
                f"UPDATE portfolio_items SET {', '.join(assignments)} WHERE id = :id",
                patch,
            )
            if cursor.rowcount == 0:
                raise KeyError(item_id)
            row = conn.execute("SELECT * FROM portfolio_items WHERE id = ?", (item_id,)).fetchone()
            conn.commit()
        return self._empty_enriched_item(dict(row))

    def get_item(self, item_id: int) -> dict[str, Any]:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM portfolio_items WHERE id = ?", (item_id,)).fetchone()
        if not row:
            raise KeyError(item_id)
        return self._empty_enriched_item(dict(row))

    def delete_item(self, item_id: int) -> None:
        with self._connect() as conn:
            cursor = conn.execute("DELETE FROM portfolio_items WHERE id = ?", (item_id,))
            conn.commit()
        if cursor.rowcount == 0:
            raise KeyError(item_id)

    def search(self, query: str, market: PortfolioMarket, limit: int) -> list[dict[str, Any]]:
        results = []
        for item in self.longbridge.search(query=query, category=market, limit=limit):
            if item.get("category") not in ("US", "A"):
                continue
            results.append(
                {
                    "market": item.get("category"),
                    "symbol": item.get("symbol", ""),
                    "name": item.get("name") or item.get("name_cn") or item.get("name_en") or "",
                    "currency": item.get("currency", ""),
                    "last_done": item.get("last_done"),
                    "change_rate": item.get("change_rate"),
                }
            )
        return results

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS portfolio_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    market TEXT NOT NULL CHECK (market IN ('US', 'A')),
                    symbol TEXT NOT NULL UNIQUE,
                    name TEXT NOT NULL DEFAULT '',
                    shares TEXT,
                    cost_price TEXT,
                    note TEXT NOT NULL DEFAULT '',
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_portfolio_market ON portfolio_items(market)")
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS portfolio_settings (
                    market TEXT PRIMARY KEY CHECK (market IN ('US', 'A')),
                    total_capital TEXT NOT NULL DEFAULT '0',
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.commit()

    def _enrich_items(self, rows: list[dict[str, Any]], cash_amount: str) -> tuple[list[dict[str, Any]], str, Optional[str]]:
        if not rows:
            cash = _decimal(cash_amount) or Decimal("0")
            return [], _money(cash) or "0.00", _ratio(Decimal("100")) if cash > 0 else None

        symbols = [row["symbol"] for row in rows]
        quotes, calc_indexes = self._fetch_live_data(symbols)
        cash_value = _decimal(cash_amount) or Decimal("0")
        row_values: dict[str, Optional[Decimal]] = {}
        total_market_value = Decimal("0")
        # 先算出总市值和总资产，再回填每只股票的仓位占比，避免边遍历边依赖未完成的总数。
        for row in rows:
            quote = quotes.get(row["symbol"], {})
            shares = _decimal(row.get("shares"))
            price = _decimal(quote.get("last_done"))
            stock_value = shares * price if shares is not None and price is not None else None
            row_values[row["symbol"]] = stock_value
            if stock_value is not None:
                total_market_value += stock_value

        total_assets_value = cash_value + total_market_value
        cash_ratio = (
            _ratio(cash_value / total_assets_value * Decimal("100"))
            if total_assets_value > 0
            else None
        )
        enriched = []
        for row in rows:
            symbol = row["symbol"]
            quote = quotes.get(symbol, {})
            calc = calc_indexes.get(symbol, {})
            current_price = quote.get("last_done")
            cost_price = _decimal(row.get("cost_price"))
            price = _decimal(current_price)
            stock_value = row_values.get(symbol)
            position_ratio = (
                stock_value / total_assets_value * Decimal("100")
                if stock_value is not None and total_assets_value > 0
                else None
            )
            pnl_ratio = (
                (price - cost_price) / cost_price * Decimal("100")
                if price is not None and cost_price not in (None, Decimal("0"))
                else None
            )
            enriched.append(
                {
                    **row,
                    "currency": quote.get("currency", ""),
                    "current_price": current_price,
                    "change_value": quote.get("change_value"),
                    "change_rate": quote.get("change_rate"),
                    "pe_ttm_ratio": calc.get("pe_ttm_ratio"),
                    "stock_value": _money(stock_value),
                    "position_ratio": _ratio(position_ratio),
                    "pnl_ratio": _ratio(pnl_ratio),
                }
            )
        return enriched, _money(total_assets_value) or "0.00", cash_ratio

    def _empty_enriched_item(self, row: dict[str, Any]) -> dict[str, Any]:
        return {
            **row,
            "currency": "",
            "current_price": None,
            "change_value": None,
            "change_rate": None,
            "pe_ttm_ratio": None,
            "stock_value": None,
            "position_ratio": None,
            "pnl_ratio": None,
        }

    def _fetch_live_data(self, symbols: list[str]) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
        try:
            from longbridge.openapi import CalcIndex
        except ImportError as exc:
            raise LongbridgeUnavailableError("Longbridge SDK is not installed") from exc

        ctx = self.longbridge._quote_context()
        try:
            raw_quotes = list(ctx.quote(symbols))
        except Exception as exc:
            raise LongbridgeUnavailableError(str(exc)) from exc

        quotes: dict[str, dict[str, Any]] = {}
        for quote in raw_quotes:
            symbol = str(getattr(quote, "symbol", "") or "").upper()
            if not symbol:
                continue
            last_done = getattr(quote, "last_done", None)
            prev_close = getattr(quote, "prev_close", None)
            quotes[symbol] = {
                "last_done": _decimal_text(last_done),
                "currency": str(getattr(quote, "currency", "") or ""),
                "change_value": _change_value(last_done, prev_close),
                "change_rate": _change_rate(last_done, prev_close),
            }

        calc_indexes: dict[str, dict[str, Any]] = {}
        try:
            raw_calc_indexes = list(ctx.calc_indexes(symbols, [CalcIndex.PeTtmRatio]))
        except Exception:
            # PE-TTM 是增强展示字段，失败不影响基础报价和持仓估值。
            raw_calc_indexes = []
        for calc in raw_calc_indexes:
            symbol = str(getattr(calc, "symbol", "") or "").upper()
            if not symbol:
                continue
            calc_indexes[symbol] = {
                "pe_ttm_ratio": _decimal_text(getattr(calc, "pe_ttm_ratio", None)),
            }

        return quotes, calc_indexes
