"""SQLite-backed portfolio service with Longbridge quote enrichment."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from app.core.market.errors import LongbridgeUnavailableError
from app.core.orm.repositories.portfolio import PortfolioRepository
from app.core.portfolio.symbols import canonical_portfolio_symbol
from app.core.portfolio.valuation import CostBasisValuation, value_portfolio
from app.core.portfolio.valuation import money as _money
from app.core.portfolio.valuation import ratio as _ratio
from app.core.watchlist.service import LongbridgeSearchClient
from app.schemas.portfolio import (
    PortfolioItemCreate,
    PortfolioItemUpdate,
    PortfolioMarket,
    PortfolioSellRequest,
)


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    text = str(value).replace(",", "").strip()
    if not text:
        return None
    try:
        number = Decimal(text)
        return number if number.is_finite() else None
    except (InvalidOperation, TypeError, ValueError):
        return None


def _decimal_text(value: Any) -> str | None:
    number = _decimal(value)
    if number is None:
        return None
    return format(number.normalize(), "f")


def _non_negative_decimal(value: Any) -> Decimal | None:
    number = _decimal(value)
    return number if number is not None and number >= 0 else None


def _change_value(last_done: Any, prev_close: Any) -> str | None:
    last = _decimal(last_done)
    prev = _decimal(prev_close)
    if last is None or prev is None:
        return None
    return _money(last - prev)


def _change_rate(last_done: Any, prev_close: Any) -> str | None:
    last = _decimal(last_done)
    prev = _decimal(prev_close)
    if last is None or prev in (None, Decimal("0")):
        return None
    return _ratio((last - prev) / prev * Decimal("100"))


def _canonical_symbol(symbol: str, market: PortfolioMarket | None = None) -> str:
    return canonical_portfolio_symbol(symbol, market)


def _market_from_symbol(symbol: str) -> PortfolioMarket:
    suffix = symbol.rsplit(".", 1)[-1].upper() if "." in symbol else ""
    return "US" if suffix == "US" else "H" if suffix == "HK" else "A"


class PortfolioService:
    """Local portfolio CRUD and quote enrichment."""

    def __init__(self, workspace_dir: str, repository: PortfolioRepository | None = None):
        root = Path(workspace_dir).expanduser()
        self.db_path = root / "portfolio" / "portfolio.db"
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.repository = repository or PortfolioRepository(self.db_path)
        self.longbridge = LongbridgeSearchClient()

    def list_items(
        self, market: PortfolioMarket, user_id: str | None = None, settings: Any = None
    ) -> dict[str, Any]:
        rows, cash_amount = self.repository.snapshot(market, user_id=user_id)

        quote_error = None
        try:
            items, total_assets, cash_ratio, unpriced_symbols = self._enrich_items(
                rows, cash_amount, settings=settings
            )
            if unpriced_symbols:
                quote_error = (
                    "Missing live quotes for "
                    + ", ".join(unpriced_symbols)
                    + "; cost basis was used for valuation."
                )
        except LongbridgeUnavailableError as exc:
            # 行情不可用时仍返回本地持仓，前端可以展示静态数据并提示 quote_error。
            quote_error = str(exc)
            unpriced_symbols = [row["symbol"] for row in rows]
            items, total_assets, cash_ratio = self._build_enriched_items(rows, cash_amount, {}, {})

        return {
            "market": market,
            "total_capital": cash_amount,
            "total_assets": total_assets,
            "cash_ratio": cash_ratio,
            "items": items,
            "total": len(items),
            "quote_error": quote_error,
            "valuation_complete": not unpriced_symbols,
            "unpriced_symbols": unpriced_symbols,
        }

    def get_local_snapshot(
        self, market: PortfolioMarket, user_id: str | None = None
    ) -> dict[str, Any]:
        """Expose local holdings and cash without requesting quotes or applying valuation."""
        rows, cash_amount = self.repository.snapshot(market, user_id=user_id)
        return {
            "market": market,
            "total_capital": cash_amount,
            "total_assets": None,
            "cash_ratio": None,
            "items": [self._empty_enriched_item(row) for row in rows],
            "total": len(rows),
            "quote_error": None,
        }

    def get_settings(self, market: PortfolioMarket, user_id: str | None = None) -> dict[str, str]:
        row = self.repository.get_settings(market, user_id=user_id)
        if row:
            return row
        return {"market": market, "user_id": user_id or "", "total_capital": "0"}

    def save_settings(
        self, market: PortfolioMarket, total_capital: str, user_id: str | None = None
    ) -> dict[str, str]:
        number = _decimal(total_capital)
        if number is None or not number.is_finite() or number < 0:
            raise ValueError("total_capital must be a finite non-negative number")
        value = _decimal_text(number) or "0"
        return self.repository.save_settings(market, value, user_id, _now())

    def list_transactions(
        self, market: PortfolioMarket, user_id: str | None = None, limit: int = 100
    ) -> dict[str, Any]:
        normalized_limit = min(max(int(limit), 1), 200)
        transactions = self.repository.list_transactions(
            market, user_id=user_id, limit=normalized_limit
        )
        return {"market": market, "transactions": transactions, "total": len(transactions)}

    def add_item(self, item: PortfolioItemCreate, user_id: str | None = None) -> dict[str, Any]:
        now = _now()
        payload = item.model_dump()
        payload["user_id"] = user_id or ""
        payload["symbol"] = _canonical_symbol(item.symbol, item.market)
        payload["shares"] = self._validated_optional_amount(item.shares, "shares")
        payload["cost_price"] = self._validated_optional_amount(item.cost_price, "cost_price")
        payload["updated_at"] = now
        payload["created_at"] = now
        return self._empty_enriched_item(self.repository.add_item(payload))

    def seed_sample_items(self, user_id: str) -> list[dict[str, Any]]:
        """仅为空组合创建显式标记的教学持仓，不请求行情也不覆盖真实数据。"""
        existing = sum(
            (self.repository.list_items(market, user_id=user_id) for market in ("US", "A", "H")), []
        )
        if existing:
            return []
        samples = [
            PortfolioItemCreate(
                market="US",
                symbol="AAPL.US",
                name="Apple",
                shares="10",
                cost_price="150",
                note="[Sample] Replace with your actual holding",
            ),
            PortfolioItemCreate(
                market="A",
                symbol="600519.SH",
                name="贵州茅台",
                shares="1",
                cost_price="1500",
                note="[Sample] 请替换为真实持仓",
            ),
        ]
        return [self.add_item(item, user_id=user_id) for item in samples]

    def update_item(
        self, item_id: int, item: PortfolioItemUpdate, user_id: str | None = None
    ) -> dict[str, Any]:
        patch = item.model_dump(exclude_unset=True)
        if not patch:
            return self.get_item(item_id, user_id=user_id)

        if "symbol" in patch and patch["symbol"] is not None:
            market = patch.get("market")
            if market is None:
                current = self.get_item(item_id, user_id=user_id)
                market = current.get("market")
            patch["symbol"] = _canonical_symbol(patch["symbol"], market)
        elif "market" in patch:
            raise ValueError("changing market requires an explicit matching symbol")
        if "shares" in patch:
            patch["shares"] = self._validated_optional_amount(patch["shares"], "shares")
        if "cost_price" in patch:
            patch["cost_price"] = self._validated_optional_amount(patch["cost_price"], "cost_price")

        # patch 字段来自 Pydantic schema 的白名单，动态拼接只覆盖请求中出现的列。
        patch["updated_at"] = _now()
        return self._empty_enriched_item(
            self.repository.update_item(item_id, patch, user_id=user_id)
        )

    def sell_item(
        self, item_id: int, request: PortfolioSellRequest, user_id: str | None = None
    ) -> dict[str, Any]:
        with self.repository.sale(item_id, user_id=user_id) as sale:
            current = sale.item
            shares_to_sell = _decimal(request.shares)
            sell_price = _decimal(request.price)
            if shares_to_sell is None or shares_to_sell <= 0:
                raise ValueError("shares must be greater than 0")
            if sell_price is None or sell_price <= 0:
                raise ValueError("price must be greater than 0")

            current_shares = _decimal(current.get("shares")) or Decimal("0")
            if shares_to_sell > current_shares:
                raise ValueError("shares exceed current holding")

            amount = shares_to_sell * sell_price
            cost_price = _decimal(current.get("cost_price"))
            realized_pnl = (
                (sell_price - cost_price) * shares_to_sell if cost_price is not None else None
            )
            market = current["market"]
            cash = _decimal(sale.total_capital) or Decimal("0")
            remaining_shares = current_shares - shares_to_sell
            updated_at = _now()

            transaction = {
                "user_id": user_id or "",
                "market": market,
                "symbol": current["symbol"],
                "name": current.get("name") or "",
                "side": "sell",
                "shares": _decimal_text(shares_to_sell) or "0",
                "price": _decimal_text(sell_price) or "0",
                "amount": _money(amount) or "0.00",
                "realized_pnl": _money(realized_pnl),
                "note": request.note.strip(),
                "created_at": updated_at,
            }
            item, saved_transaction, setting = sale.record(
                remaining_shares=_decimal_text(remaining_shares) or "0",
                total_capital=_decimal_text(cash + amount) or "0",
                transaction=transaction,
                updated_at=updated_at,
            )
        return {
            "item": self._empty_enriched_item(item),
            "transaction": saved_transaction,
            "total_capital": setting["total_capital"],
        }

    def get_item(self, item_id: int, user_id: str | None = None) -> dict[str, Any]:
        return self._empty_enriched_item(self.repository.get_item(item_id, user_id=user_id))

    def delete_item(self, item_id: int, user_id: str | None = None) -> None:
        if not self.repository.delete_item(item_id, user_id=user_id):
            raise KeyError(item_id)

    def search(
        self, query: str, market: PortfolioMarket, limit: int, settings: Any = None
    ) -> list[dict[str, Any]]:
        results = []
        for item in self.longbridge.search(
            query=query, category=market, limit=limit, settings=settings
        ):
            if item.get("category") not in ("US", "A", "H"):
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

    def _enrich_items(
        self,
        rows: list[dict[str, Any]],
        cash_amount: str,
        settings: Any = None,
    ) -> tuple[list[dict[str, Any]], str, str | None, list[str]]:
        if not rows:
            cash = _decimal(cash_amount) or Decimal("0")
            return [], _money(cash) or "0.00", _ratio(Decimal("100")) if cash > 0 else None, []

        symbols = [row["symbol"] for row in rows]
        quotes, calc_indexes = self._fetch_live_data(symbols, settings=settings)
        unpriced_symbols = [
            symbol
            for symbol in symbols
            if _non_negative_decimal(quotes.get(symbol, {}).get("last_done")) is None
        ]
        enriched, total_assets, cash_ratio = self._build_enriched_items(
            rows, cash_amount, quotes, calc_indexes
        )
        return enriched, total_assets, cash_ratio, unpriced_symbols

    def _build_enriched_items(
        self,
        rows: list[dict[str, Any]],
        cash_amount: str,
        quotes: dict[str, dict[str, Any]],
        calc_indexes: dict[str, dict[str, Any]],
    ) -> tuple[list[dict[str, Any]], str, str | None]:
        valuation = value_portfolio(
            rows, quotes, _decimal(cash_amount) or Decimal("0"), CostBasisValuation()
        )
        enriched = []
        for item in valuation.items:
            enriched.append(
                {
                    **item.row,
                    "shares": _decimal_text(item.shares),
                    "cost_price": _decimal_text(item.cost_price),
                    "currency": item.quote.get("currency", ""),
                    "current_price": _decimal_text(item.current_price),
                    "change_value": item.quote.get("change_value"),
                    "change_rate": item.quote.get("change_rate"),
                    "pe_ttm_ratio": calc_indexes.get(item.symbol, {}).get("pe_ttm_ratio"),
                    "stock_value": _money(item.stock_value),
                    "position_ratio": _ratio(item.position),
                    "pnl_ratio": _ratio(item.pnl),
                    "valuation_price_source": item.source,
                }
            )
        return enriched, _money(valuation.total_assets) or "0.00", _ratio(valuation.cash_ratio)

    def _empty_enriched_item(self, row: dict[str, Any]) -> dict[str, Any]:
        shares = _non_negative_decimal(row.get("shares"))
        cost_price = _non_negative_decimal(row.get("cost_price"))
        return {
            **row,
            "shares": _decimal_text(shares),
            "cost_price": _decimal_text(cost_price),
            "currency": "",
            "current_price": None,
            "change_value": None,
            "change_rate": None,
            "pe_ttm_ratio": None,
            "stock_value": None,
            "position_ratio": None,
            "pnl_ratio": None,
            "valuation_price_source": "unavailable",
        }

    @staticmethod
    def _validated_optional_amount(value: Any, field: str) -> str | None:
        if value in (None, ""):
            return None
        number = _decimal(value)
        if number is None or not number.is_finite() or number < 0:
            raise ValueError(f"{field} must be a finite non-negative number")
        return _decimal_text(number)

    def _fetch_live_data(
        self, symbols: list[str], settings: Any = None
    ) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
        try:
            from longbridge.openapi import CalcIndex
        except ImportError as exc:
            raise LongbridgeUnavailableError("Longbridge SDK is not installed") from exc

        ctx = self.longbridge._quote_context(settings=settings)
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
            currency = str(getattr(quote, "currency", "") or "")
            quotes[symbol] = {
                "last_done": _decimal_text(last_done),
                "currency": currency.rsplit(".", 1)[-1].upper(),
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
