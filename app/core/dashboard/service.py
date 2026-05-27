"""Dashboard aggregation service."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from hashlib import sha256
from threading import RLock
from time import monotonic
from typing import Any, Literal

from app.core.market.utils import canonical_symbol, normalize_symbol_map, normalize_symbols
from app.schemas.portfolio import PortfolioMarket

WATCHLIST_CATEGORIES = ("US", "A", "H")
PORTFOLIO_MARKETS: tuple[PortfolioMarket, ...] = ("US", "A")
DASHBOARD_QUOTE_TTL_SECONDS = 8
DashboardMode = Literal["bootstrap", "full"]
DashboardSource = Literal["local", "cache", "live"]


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


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


def _static_quote_row(symbol: str, name: str = "", category: str = "") -> dict[str, Any]:
    return {
        "symbol": canonical_symbol(symbol),
        "name": name,
        "category": category,
        "last_done": None,
        "prev_close": None,
        "open": None,
        "high": None,
        "low": None,
        "volume": None,
        "turnover": None,
        "change_value": None,
        "change_rate": None,
    }


def _static_watchlist_row(item: dict[str, Any]) -> dict[str, Any]:
    name = item.get("name") or item.get("name_cn") or item.get("name_hk") or item.get("name_en") or ""
    row = _static_quote_row(item.get("symbol", ""), name=name, category=item.get("category", ""))
    row.update(
        {
            "id": item.get("id"),
            "name_cn": item.get("name_cn", ""),
            "name_en": item.get("name_en", ""),
            "name_hk": item.get("name_hk", ""),
            "exchange": item.get("exchange", ""),
            "currency": item.get("currency", ""),
            "note": item.get("note", ""),
            "created_at": item.get("created_at", ""),
            "updated_at": item.get("updated_at", ""),
        }
    )
    row["last_done"] = item.get("last_done")
    row["change_value"] = item.get("change_value")
    row["change_rate"] = item.get("change_rate")
    return row


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


def _merge_quote(static_row: dict[str, Any], quote: dict[str, Any] | None) -> dict[str, Any]:
    if not quote:
        return dict(static_row)
    merged = dict(static_row)
    for key, value in quote.items():
        if value not in (None, ""):
            merged[key] = value
    merged["symbol"] = canonical_symbol(merged.get("symbol", static_row.get("symbol", "")))
    merged["name"] = quote.get("name") or static_row.get("name") or merged.get("name", "")
    merged["category"] = quote.get("category") or static_row.get("category") or merged.get("category", "")
    return merged


def _settings_signature(settings: Any) -> str:
    keys = (
        "longbridge_app_key",
        "longbridge_app_secret",
        "longbridge_access_token",
        "longbridge_http_url",
        "longbridge_quote_ws_url",
    )
    parts = [f"{key}={getattr(settings, key, '') or ''}" for key in keys]
    return sha256("|".join(parts).encode("utf-8")).hexdigest()


@dataclass
class QuoteFetchResult:
    quotes: dict[str, dict[str, Any]] = field(default_factory=dict)
    error: str | None = None
    fetched_at: str = field(default_factory=_iso_now)
    source: DashboardSource = "local"
    stale: bool = False


@dataclass
class QuoteCacheEntry:
    expires_at: float
    fetched_at: str
    row: dict[str, Any]


@dataclass
class QuoteFailureEntry:
    expires_at: float
    fetched_at: str
    error: str


class DashboardQuoteCache:
    """Small process-local cache for Dashboard quote bursts."""

    def __init__(self, ttl_seconds: int = DASHBOARD_QUOTE_TTL_SECONDS) -> None:
        self.ttl_seconds = ttl_seconds
        self._lock = RLock()
        self._quotes: dict[tuple[str, str, str], QuoteCacheEntry] = {}
        self._failures: dict[tuple[str, str, tuple[str, ...]], QuoteFailureEntry] = {}

    def get_many(self, user_key: str, settings_key: str, symbols: list[str]) -> tuple[dict[str, dict[str, Any]], list[str], str | None]:
        now = monotonic()
        hits: dict[str, dict[str, Any]] = {}
        missing: list[str] = []
        fetched_at: str | None = None
        with self._lock:
            for symbol in symbols:
                key = (user_key, settings_key, symbol)
                entry = self._quotes.get(key)
                if entry and entry.expires_at > now:
                    hits[symbol] = dict(entry.row)
                    fetched_at = max(fetched_at or entry.fetched_at, entry.fetched_at)
                    continue
                self._quotes.pop(key, None)
                missing.append(symbol)
        return hits, missing, fetched_at

    def set_many(self, user_key: str, settings_key: str, rows: list[dict[str, Any]], fetched_at: str) -> None:
        expires_at = monotonic() + self.ttl_seconds
        with self._lock:
            for row in rows:
                symbol = canonical_symbol(row.get("symbol", ""))
                if not symbol:
                    continue
                self._quotes[(user_key, settings_key, symbol)] = QuoteCacheEntry(
                    expires_at=expires_at,
                    fetched_at=fetched_at,
                    row=dict(row),
                )

    def get_failure(self, user_key: str, settings_key: str, symbols: list[str]) -> QuoteFailureEntry | None:
        key = (user_key, settings_key, tuple(symbols))
        now = monotonic()
        with self._lock:
            entry = self._failures.get(key)
            if entry and entry.expires_at > now:
                return entry
            self._failures.pop(key, None)
        return None

    def set_failure(self, user_key: str, settings_key: str, symbols: list[str], error: str, fetched_at: str) -> None:
        key = (user_key, settings_key, tuple(symbols))
        with self._lock:
            self._failures[key] = QuoteFailureEntry(
                expires_at=monotonic() + self.ttl_seconds,
                fetched_at=fetched_at,
                error=error,
            )


_QUOTE_CACHE = DashboardQuoteCache()


class DashboardService:
    """Aggregate existing domain services into a Dashboard payload."""

    def __init__(self, market_service: Any, watchlist_service: Any, portfolio_service: Any):
        self.market_service = market_service
        self.watchlist_service = watchlist_service
        self.portfolio_service = portfolio_service

    def build(self, *, user: Any, settings: Any, mode: DashboardMode = "full") -> dict[str, Any]:
        context = self._load_context(user=user)
        quote_result = self._fetch_dashboard_quotes(
            user=user,
            settings=settings,
            symbols=context["symbols"],
            name_map=context["name_map"],
            category_map=context["category_map"],
            allow_remote=mode == "full" and user.can("market:read"),
        )
        return {
            "market": self._build_market(context["market"], quote_result),
            "watchlist": self._build_watchlist(context["watchlist"], quote_result, user=user),
            "portfolio": self._build_portfolio(context["portfolio"], quote_result, user=user),
        }

    def market(self, *, user: Any, settings: Any, mode: DashboardMode = "full") -> dict[str, Any]:
        context = self._market_context(user=user)
        symbols = [row["symbol"] for row in context.get("rows", [])]
        quote_result = self._fetch_dashboard_quotes(
            user=user,
            settings=settings,
            symbols=symbols,
            name_map={row["symbol"]: row.get("name", "") for row in context.get("rows", [])},
            category_map={row["symbol"]: row.get("category", "") for row in context.get("rows", [])},
            allow_remote=mode == "full" and user.can("market:read"),
        )
        return self._build_market(context, quote_result)

    def watchlist(self, *, user: Any, settings: Any, mode: DashboardMode = "full") -> dict[str, Any]:
        context = self._watchlist_context(user=user)
        symbols = [row["symbol"] for row in context.get("rows", [])]
        quote_result = self._fetch_dashboard_quotes(
            user=user,
            settings=settings,
            symbols=symbols,
            name_map={row["symbol"]: row.get("name", "") for row in context.get("rows", [])},
            category_map={row["symbol"]: row.get("category", "") for row in context.get("rows", [])},
            allow_remote=mode == "full" and user.can("market:read"),
        )
        return self._build_watchlist(context, quote_result, user=user)

    def portfolio(self, *, user: Any, settings: Any, mode: DashboardMode = "full") -> dict[str, Any]:
        context = self._portfolio_context(user=user)
        rows = [item for payload in context.get("payloads", []) for item in payload.get("items", [])]
        quote_result = self._fetch_dashboard_quotes(
            user=user,
            settings=settings,
            symbols=[row.get("symbol", "") for row in rows],
            name_map={canonical_symbol(row.get("symbol", "")): row.get("name", "") for row in rows},
            category_map={canonical_symbol(row.get("symbol", "")): row.get("market", "") for row in rows},
            allow_remote=mode == "full" and user.can("market:read"),
        )
        return self._build_portfolio(context, quote_result, user=user)

    def _load_context(self, *, user: Any) -> dict[str, Any]:
        market = self._market_context(user=user)
        watchlist = self._watchlist_context(user=user)
        portfolio = self._portfolio_context(user=user)

        symbols: list[str] = []
        name_map: dict[str, str] = {}
        category_map: dict[str, str] = {}
        for row in market.get("rows", []):
            self._append_symbol_meta(row, symbols, name_map, category_map)
        for row in watchlist.get("rows", []):
            self._append_symbol_meta(row, symbols, name_map, category_map)
        for payload in portfolio.get("payloads", []):
            for row in payload.get("items", []):
                self._append_symbol_meta(
                    {"symbol": row.get("symbol"), "name": row.get("name", ""), "category": row.get("market", "")},
                    symbols,
                    name_map,
                    category_map,
                )

        return {
            "market": market,
            "watchlist": watchlist,
            "portfolio": portfolio,
            "symbols": symbols,
            "name_map": name_map,
            "category_map": category_map,
        }

    def _append_symbol_meta(
        self,
        row: dict[str, Any],
        symbols: list[str],
        name_map: dict[str, str],
        category_map: dict[str, str],
    ) -> None:
        symbol = canonical_symbol(row.get("symbol", ""))
        if not symbol:
            return
        symbols.append(symbol)
        if row.get("name"):
            name_map.setdefault(symbol, row["name"])
        if row.get("category"):
            category_map.setdefault(symbol, row["category"])

    def _fetch_dashboard_quotes(
        self,
        *,
        user: Any,
        settings: Any,
        symbols: list[str],
        name_map: dict[str, str] | None = None,
        category_map: dict[str, str] | None = None,
        allow_remote: bool,
    ) -> QuoteFetchResult:
        normalized_symbols = normalize_symbols(symbols)
        fetched_at = _iso_now()
        if not normalized_symbols:
            return QuoteFetchResult(fetched_at=fetched_at, source="local", stale=False)

        user_key = str(getattr(user, "id", ""))
        settings_key = _settings_signature(settings)
        cached, missing, cache_fetched_at = _QUOTE_CACHE.get_many(user_key, settings_key, normalized_symbols)
        if not allow_remote:
            return QuoteFetchResult(
                quotes=cached,
                fetched_at=cache_fetched_at or fetched_at,
                source="cache" if cached else "local",
                stale=bool(missing),
            )
        if not missing:
            return QuoteFetchResult(quotes=cached, fetched_at=cache_fetched_at or fetched_at, source="cache", stale=False)

        failure = _QUOTE_CACHE.get_failure(user_key, settings_key, missing)
        if failure:
            return QuoteFetchResult(
                quotes=cached,
                error=failure.error,
                fetched_at=cache_fetched_at or failure.fetched_at,
                source="cache" if cached else "local",
                stale=True,
            )

        try:
            normalized_name_map = normalize_symbol_map(name_map)
            normalized_category_map = normalize_symbol_map(category_map)
            fetched_rows = self.market_service._fetch_quotes(
                missing,
                name_map={symbol: normalized_name_map.get(symbol, "") for symbol in missing},
                category_map={symbol: normalized_category_map.get(symbol, "") for symbol in missing},
                settings=settings,
            )
            fetched_at = _iso_now()
            _QUOTE_CACHE.set_many(user_key, settings_key, fetched_rows, fetched_at)
            quote_map = dict(cached)
            for row in fetched_rows:
                symbol = canonical_symbol(row.get("symbol", ""))
                if symbol:
                    quote_map[symbol] = row
            return QuoteFetchResult(quotes=quote_map, fetched_at=fetched_at, source="live", stale=False)
        except Exception as exc:
            error = str(exc)
            _QUOTE_CACHE.set_failure(user_key, settings_key, missing, error, fetched_at)
            return QuoteFetchResult(
                quotes=cached,
                error=error,
                fetched_at=cache_fetched_at or fetched_at,
                source="cache" if cached else "local",
                stale=True,
            )

    def _market_context(self, *, user: Any) -> dict[str, Any]:
        if not user.can("market:read"):
            return {"available": False, "error": "Missing permission: market:read", "rows": []}
        try:
            config = self.market_service.get_config(user_id=user.id)
            rows = [
                _static_quote_row(index.get("symbol", ""), name=index.get("name", ""), category="")
                for index in config.get("indices", [])
                if index.get("enabled", True) and canonical_symbol(index.get("symbol", ""))
            ]
            return {"available": True, "error": None, "rows": rows}
        except Exception as exc:
            return {"available": True, "error": str(exc), "rows": []}

    def _build_market(self, context: dict[str, Any], quote_result: QuoteFetchResult) -> dict[str, Any]:
        if not context.get("available", True):
            return self._module_meta(
                available=False,
                error=context.get("error"),
                source="local",
                fetched_at=quote_result.fetched_at,
                stale=False,
                indices=[],
            )
        rows = [_merge_quote(row, quote_result.quotes.get(row["symbol"])) for row in context.get("rows", [])]
        error = context.get("error") or (quote_result.error if rows else None)
        return self._module_meta(
            available=True,
            error=error,
            source=quote_result.source,
            fetched_at=quote_result.fetched_at,
            stale=quote_result.stale,
            indices=rows,
        )

    def _watchlist_context(self, *, user: Any) -> dict[str, Any]:
        if not user.can("watchlist:read"):
            return self._empty_watchlist_context(available=False, error="Missing permission: watchlist:read")

        try:
            items = self.watchlist_service.list_items(category=None, user_id=user.id)
        except Exception as exc:
            return self._empty_watchlist_context(error=str(exc))

        counts = {category: 0 for category in WATCHLIST_CATEGORIES}
        for item in items:
            category = item.get("category", "")
            if category in counts:
                counts[category] += 1

        return {
            "available": True,
            "error": None,
            "rows": [_static_watchlist_row(item) for item in items],
            "counts": counts,
        }

    def _build_watchlist(self, context: dict[str, Any], quote_result: QuoteFetchResult, *, user: Any) -> dict[str, Any]:
        if not context.get("available", True):
            return self._empty_watchlist(
                available=False,
                error=context.get("error"),
                fetched_at=quote_result.fetched_at,
                source="local",
                stale=False,
            )
        rows = [_merge_quote(row, quote_result.quotes.get(row["symbol"])) for row in context.get("rows", [])]
        views = _sort_watchlist_views(rows)
        quote_error = quote_result.error if rows and user.can("market:read") else None
        return self._module_meta(
            available=True,
            error=context.get("error"),
            source=quote_result.source,
            fetched_at=quote_result.fetched_at,
            stale=quote_result.stale,
            items=rows,
            views=views,
            counts_by_category=context.get("counts", {category: 0 for category in WATCHLIST_CATEGORIES}),
            total=len(rows),
            quote_error=quote_error,
        )

    def _empty_watchlist_context(self, *, available: bool = True, error: str | None = None) -> dict[str, Any]:
        return {
            "available": available,
            "error": error,
            "rows": [],
            "counts": {category: 0 for category in WATCHLIST_CATEGORIES},
        }

    def _empty_watchlist(
        self,
        *,
        available: bool = True,
        error: str | None = None,
        fetched_at: str | None = None,
        source: DashboardSource = "local",
        stale: bool = False,
    ) -> dict[str, Any]:
        return self._module_meta(
            available=available,
            error=error,
            source=source,
            fetched_at=fetched_at or _iso_now(),
            stale=stale,
            items=[],
            views={"movers": [], "gainers": [], "losers": [], "active": []},
            counts_by_category={category: 0 for category in WATCHLIST_CATEGORIES},
            total=0,
            quote_error=None,
        )

    def _portfolio_context(self, *, user: Any) -> dict[str, Any]:
        if not user.can("portfolio:read"):
            return {"available": False, "error": "Missing permission: portfolio:read", "payloads": []}

        payloads = []
        errors = []
        for market in PORTFOLIO_MARKETS:
            try:
                payloads.append(self._portfolio_local_payload(market, user=user))
            except Exception as exc:
                errors.append(f"{market}: {exc}")
        return {
            "available": True,
            "error": "; ".join(errors) if errors else None,
            "payloads": payloads,
        }

    def _portfolio_local_payload(self, market: PortfolioMarket, *, user: Any) -> dict[str, Any]:
        repository = getattr(self.portfolio_service, "repository", None)
        if repository is not None and hasattr(repository, "list_items"):
            rows = repository.list_items(market, user_id=user.id)
            settings = self.portfolio_service.get_settings(market, user_id=user.id)
            cash_amount = settings.get("total_capital", "0")
            return {
                "market": market,
                "total_capital": cash_amount,
                "total_assets": None,
                "cash_ratio": None,
                "items": [self._empty_portfolio_item(row) for row in rows],
                "total": len(rows),
                "quote_error": None,
            }

        payload = self.portfolio_service.list_items(market, user_id=user.id, settings=None)
        return {
            **payload,
            "items": [self._empty_portfolio_item(row) for row in payload.get("items", [])],
        }

    def _empty_portfolio_item(self, row: dict[str, Any]) -> dict[str, Any]:
        return {
            **row,
            "currency": row.get("currency", ""),
            "pe_ttm_ratio": row.get("pe_ttm_ratio"),
            "current_price": row.get("current_price"),
            "change_value": row.get("change_value"),
            "change_rate": row.get("change_rate"),
            "stock_value": row.get("stock_value"),
            "position_ratio": row.get("position_ratio"),
            "pnl_ratio": row.get("pnl_ratio"),
        }

    def _build_portfolio(self, context: dict[str, Any], quote_result: QuoteFetchResult, *, user: Any) -> dict[str, Any]:
        if not context.get("available", True):
            return self._module_meta(
                available=False,
                error=context.get("error"),
                source="local",
                fetched_at=quote_result.fetched_at,
                stale=False,
                markets=[],
            )

        markets = []
        for payload in context.get("payloads", []):
            enriched = self._enrich_portfolio_payload(payload, quote_result.quotes)
            if enriched.get("items") and quote_result.error and user.can("market:read"):
                enriched["quote_error"] = quote_result.error
            markets.append(self._portfolio_market_summary(enriched))

        return self._module_meta(
            available=True,
            error=context.get("error"),
            source=quote_result.source,
            fetched_at=quote_result.fetched_at,
            stale=quote_result.stale,
            markets=markets,
        )

    def _enrich_portfolio_payload(self, payload: dict[str, Any], quotes: dict[str, dict[str, Any]]) -> dict[str, Any]:
        rows = payload.get("items") or []
        cash_value = _decimal(payload.get("total_capital")) or Decimal("0")
        total_market_value = Decimal("0")
        has_market_value = False
        enriched_rows: list[dict[str, Any]] = []

        for row in rows:
            symbol = canonical_symbol(row.get("symbol", ""))
            quote = quotes.get(symbol, {})
            shares = _decimal(row.get("shares"))
            current_price = quote.get("last_done") or row.get("current_price")
            price = _decimal(current_price)
            cost_price = _decimal(row.get("cost_price"))
            stock_value = shares * price if shares is not None and price is not None else _decimal(row.get("stock_value"))
            if stock_value is not None:
                total_market_value += stock_value
                has_market_value = True
            pnl_ratio = (
                (price - cost_price) / cost_price * Decimal("100")
                if price is not None and cost_price not in (None, Decimal("0"))
                else _decimal(row.get("pnl_ratio"))
            )
            enriched_rows.append(
                {
                    **row,
                    "symbol": symbol,
                    "current_price": current_price,
                    "change_value": quote.get("change_value") or row.get("change_value"),
                    "change_rate": quote.get("change_rate") or row.get("change_rate"),
                    "stock_value": _money(stock_value),
                    "pnl_ratio": _ratio(pnl_ratio),
                }
            )

        total_assets_value = cash_value + total_market_value
        for row in enriched_rows:
            stock_value = _decimal(row.get("stock_value"))
            position_ratio = (
                stock_value / total_assets_value * Decimal("100")
                if stock_value is not None and total_assets_value > 0
                else _decimal(row.get("position_ratio"))
            )
            row["position_ratio"] = _ratio(position_ratio)

        return {
            **payload,
            "items": enriched_rows,
            "total": len(enriched_rows),
            "total_assets": _money(total_assets_value) if has_market_value or cash_value else payload.get("total_assets"),
            "cash_ratio": (
                _ratio(cash_value / total_assets_value * Decimal("100"))
                if total_assets_value > 0
                else payload.get("cash_ratio")
            ),
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

        cash_value = _decimal(payload.get("total_capital")) or Decimal("0")
        total_assets_value = cash_value + market_value if has_market_value or cash_value else None
        cash_ratio = (
            _ratio(cash_value / total_assets_value * Decimal("100"))
            if total_assets_value not in (None, Decimal("0"))
            else payload.get("cash_ratio")
        )
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
            "total_assets": payload.get("total_assets") or _money(total_assets_value) or "0",
            "market_value": _money(market_value if has_market_value else Decimal("0")) or "0",
            "cash_amount": payload.get("total_capital") or "0",
            "cash_ratio": cash_ratio,
            "cost_value": _money(cost_value if has_cost_value else Decimal("0")) or "0",
            "unrealized_pnl_value": _money(pnl_value),
            "unrealized_pnl_ratio": _ratio(pnl_ratio),
            "day_change_value": _money(day_change_value) if has_day_change else None,
            "day_change_rate": _ratio(day_change_rate),
            "position_count": int(payload.get("total") or len(items)),
            "quote_error": payload.get("quote_error"),
            "top_positions": top_positions,
        }

    def _module_meta(
        self,
        *,
        available: bool,
        error: str | None,
        source: DashboardSource,
        fetched_at: str,
        stale: bool,
        **payload: Any,
    ) -> dict[str, Any]:
        return {
            "available": available,
            "error": error,
            "fetched_at": fetched_at,
            "stale": stale,
            "source": source,
            **payload,
        }
