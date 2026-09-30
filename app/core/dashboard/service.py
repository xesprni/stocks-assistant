"""Dashboard aggregation service."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from hashlib import sha256
from threading import RLock
from time import monotonic
from typing import Any, Literal

from app.constants.dashboard import (
    DASHBOARD_CACHE_MAX_ENTRIES as DASHBOARD_CACHE_MAX_ENTRIES,
)
from app.constants.dashboard import (
    DASHBOARD_QUOTE_TTL_SECONDS as DASHBOARD_QUOTE_TTL_SECONDS,
)
from app.constants.dashboard import (
    DASHBOARD_STATIC_INFO_TTL_SECONDS as DASHBOARD_STATIC_INFO_TTL_SECONDS,
)
from app.constants.dashboard import (
    PORTFOLIO_MARKETS as PORTFOLIO_MARKETS,
)
from app.constants.dashboard import (
    WATCHLIST_CATEGORIES as WATCHLIST_CATEGORIES,
)
from app.constants.security import Permission
from app.core.market.utils import canonical_symbol, normalize_symbol_map, normalize_symbols
from app.core.portfolio.valuation import HistoricalDisplayValuation, value_portfolio
from app.core.portfolio.valuation import money as _money
from app.core.portfolio.valuation import ratio as _ratio
from app.schemas.dashboard import (
    DashboardLoadContext,
    DashboardMarketModule,
    DashboardPortfolioMarket,
    DashboardPortfolioModule,
    DashboardPortfolioSnapshot,
    DashboardResponse,
    DashboardWatchlistModule,
    DashboardWatchlistRow,
    DashboardWatchlistViews,
    MarketLoadContext,
    PortfolioLoadContext,
    WatchlistLoadContext,
)
from app.schemas.market import MarketDashboardConfig, QuoteItem
from app.schemas.market_data import SecurityStaticInfo
from app.schemas.portfolio import PortfolioItem, PortfolioMarket
from app.schemas.watchlist import WatchlistItem

DashboardMode = Literal["bootstrap", "full"]
DashboardSource = Literal["local", "cache", "live"]


def _iso_now() -> str:
    return datetime.now(UTC).isoformat()


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


def _static_quote_row(symbol: str, name: str = "", category: str = "") -> QuoteItem:
    return QuoteItem(
        symbol=canonical_symbol(symbol),
        name=name,
        category=category,
        last_done=None,
        prev_close=None,
        open=None,
        high=None,
        low=None,
        volume=None,
        turnover=None,
        change_value=None,
        change_rate=None,
    )


def _static_watchlist_row(item: WatchlistItem) -> DashboardWatchlistRow:
    row = DashboardWatchlistRow.model_validate(item)
    row.symbol = canonical_symbol(item.symbol)
    row.name = item.name or item.name_cn or item.name_hk or item.name_en or ""
    return row


def _rate(row: QuoteItem) -> Decimal | None:
    return _decimal(row.change_rate)


def _activity_value(row: QuoteItem) -> Decimal:
    return _decimal(row.turnover) or _decimal(row.volume) or Decimal("-1")


def _abs_rate_value(row: QuoteItem) -> Decimal:
    rate = _rate(row)
    return abs(rate) if rate is not None else Decimal("-1")


def _sort_watchlist_views(rows: list[DashboardWatchlistRow]) -> DashboardWatchlistViews:
    indexed = list(enumerate(rows))
    movers = sorted(indexed, key=lambda item: (_abs_rate_value(item[1]), -item[0]), reverse=True)
    gainers = sorted(
        indexed, key=lambda item: (_rate(item[1]) or Decimal("-999999999"), -item[0]), reverse=True
    )
    losers = sorted(
        indexed,
        key=lambda item: (
            _rate(item[1]) if _rate(item[1]) is not None else Decimal("999999999"),
            item[0],
        ),
    )
    active = sorted(indexed, key=lambda item: (_activity_value(item[1]), -item[0]), reverse=True)
    return DashboardWatchlistViews(
        movers=[row for _, row in movers],
        gainers=[row for _, row in gainers],
        losers=[row for _, row in losers],
        active=[row for _, row in active],
    )


def _position_sort_value(item: PortfolioItem) -> Decimal:
    return _decimal(item.position_ratio) or Decimal("-1")


def _merge_quote[T: QuoteItem](static_row: T, quote: QuoteItem | None) -> T:
    merged = static_row.model_copy(deep=True)
    if quote is not None:
        for key in QuoteItem.model_fields:
            value = getattr(quote, key)
            if value not in (None, ""):
                setattr(merged, key, value)
    merged.symbol = canonical_symbol(merged.symbol)
    return merged


def _merge_static_info(
    row: DashboardWatchlistRow, static_info: SecurityStaticInfo | None
) -> DashboardWatchlistRow:
    merged = row.model_copy(deep=True)
    if static_info is not None:
        for key in SecurityStaticInfo.model_fields:
            value = getattr(static_info, key)
            if key != "symbol" and value not in (None, ""):
                setattr(merged, key, value)
        merged.name = (
            static_info.name
            or static_info.name_cn
            or static_info.name_hk
            or static_info.name_en
            or row.name
        )
    merged.symbol = canonical_symbol(merged.symbol)
    return merged


def _settings_signature(settings: Any) -> str:
    keys = (
        "longbridge_auth_mode",
        "longbridge_oauth_client_id",
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
    quotes: dict[str, QuoteItem] = field(default_factory=dict)
    error: str | None = None
    fetched_at: str = field(default_factory=_iso_now)
    source: DashboardSource = "local"
    stale: bool = False


@dataclass
class QuoteCacheEntry[T: (QuoteItem, SecurityStaticInfo)]:
    expires_at: float
    fetched_at: str
    row: T


@dataclass
class QuoteFailureEntry:
    expires_at: float
    fetched_at: str
    error: str


class DashboardQuoteCache:
    """Small process-local cache for Dashboard quote bursts."""

    def __init__(
        self,
        ttl_seconds: int = DASHBOARD_QUOTE_TTL_SECONDS,
        *,
        static_ttl_seconds: int = DASHBOARD_STATIC_INFO_TTL_SECONDS,
        max_entries: int = DASHBOARD_CACHE_MAX_ENTRIES,
    ) -> None:
        self.ttl_seconds = ttl_seconds
        self.static_ttl_seconds = static_ttl_seconds
        self.max_entries = max(1, max_entries)
        self._lock = RLock()
        self._quotes: dict[tuple[str, str, str], QuoteCacheEntry[QuoteItem]] = {}
        self._failures: dict[tuple[str, str, tuple[str, ...]], QuoteFailureEntry] = {}
        self._static_info: dict[tuple[str, str], QuoteCacheEntry[SecurityStaticInfo]] = {}

    def _prune_locked(self, cache: dict, now: float) -> None:
        for key in [key for key, entry in cache.items() if entry.expires_at <= now]:
            cache.pop(key, None)
        overflow = len(cache) - self.max_entries
        if overflow > 0:
            for key, _ in sorted(cache.items(), key=lambda item: item[1].expires_at)[:overflow]:
                cache.pop(key, None)

    def get_many(
        self, user_key: str, settings_key: str, symbols: list[str]
    ) -> tuple[dict[str, QuoteItem], list[str], str | None]:
        now = monotonic()
        hits: dict[str, QuoteItem] = {}
        missing: list[str] = []
        fetched_at: str | None = None
        with self._lock:
            self._prune_locked(self._quotes, now)
            for symbol in symbols:
                key = (user_key, settings_key, symbol)
                entry = self._quotes.get(key)
                if entry and entry.expires_at > now:
                    hits[symbol] = entry.row.model_copy(deep=True)
                    fetched_at = max(fetched_at or entry.fetched_at, entry.fetched_at)
                    continue
                self._quotes.pop(key, None)
                missing.append(symbol)
        return hits, missing, fetched_at

    def set_many(
        self, user_key: str, settings_key: str, rows: list[QuoteItem], fetched_at: str
    ) -> None:
        expires_at = monotonic() + self.ttl_seconds
        with self._lock:
            for row in rows:
                symbol = canonical_symbol(row.symbol)
                if not symbol:
                    continue
                self._quotes[(user_key, settings_key, symbol)] = QuoteCacheEntry(
                    expires_at=expires_at,
                    fetched_at=fetched_at,
                    row=row.model_copy(deep=True),
                )
            self._prune_locked(self._quotes, monotonic())

    def get_failure(
        self, user_key: str, settings_key: str, symbols: list[str]
    ) -> QuoteFailureEntry | None:
        key = (user_key, settings_key, tuple(symbols))
        now = monotonic()
        with self._lock:
            self._prune_locked(self._failures, now)
            entry = self._failures.get(key)
            if entry and entry.expires_at > now:
                return entry
            self._failures.pop(key, None)
        return None

    def set_failure(
        self, user_key: str, settings_key: str, symbols: list[str], error: str, fetched_at: str
    ) -> None:
        key = (user_key, settings_key, tuple(symbols))
        with self._lock:
            self._failures[key] = QuoteFailureEntry(
                expires_at=monotonic() + self.ttl_seconds,
                fetched_at=fetched_at,
                error=error,
            )
            self._prune_locked(self._failures, monotonic())

    def get_static_info(
        self, settings_key: str, symbols: list[str]
    ) -> tuple[dict[str, SecurityStaticInfo], list[str]]:
        now = monotonic()
        hits: dict[str, SecurityStaticInfo] = {}
        missing: list[str] = []
        with self._lock:
            self._prune_locked(self._static_info, now)
            for symbol in symbols:
                entry = self._static_info.get((settings_key, symbol))
                if entry:
                    hits[symbol] = entry.row.model_copy(deep=True)
                else:
                    missing.append(symbol)
        return hits, missing

    def set_static_info(self, settings_key: str, rows: list[SecurityStaticInfo]) -> None:
        now = monotonic()
        fetched_at = _iso_now()
        with self._lock:
            for row in rows:
                symbol = canonical_symbol(row.symbol)
                if symbol:
                    self._static_info[(settings_key, symbol)] = QuoteCacheEntry(
                        expires_at=now + self.static_ttl_seconds,
                        fetched_at=fetched_at,
                        row=row.model_copy(deep=True),
                    )
            self._prune_locked(self._static_info, now)

    def clear(self) -> None:
        with self._lock:
            self._quotes.clear()
            self._failures.clear()
            self._static_info.clear()


_QUOTE_CACHE = DashboardQuoteCache()


def clear_dashboard_cache() -> None:
    """Invalidate quote/static caches after Longbridge configuration changes."""
    _QUOTE_CACHE.clear()


class DashboardService:
    """Aggregate existing domain services into a Dashboard payload."""

    def __init__(self, market_service: Any, watchlist_service: Any, portfolio_service: Any):
        self.market_service = market_service
        self.watchlist_service = watchlist_service
        self.portfolio_service = portfolio_service

    def build(self, *, user: Any, settings: Any, mode: DashboardMode = "full") -> DashboardResponse:
        context = self._load_context(user=user)
        allow_market_remote = mode == "full" and user.can(Permission.MARKET_READ)
        quote_result = self._fetch_dashboard_quotes(
            user=user,
            settings=settings,
            symbols=context.symbols,
            name_map=context.name_map,
            category_map=context.category_map,
            allow_remote=allow_market_remote,
        )
        watchlist_static_info = self._fetch_static_info(
            settings=settings,
            symbols=[row.symbol for row in context.watchlist.rows],
            allow_remote=allow_market_remote,
        )
        return DashboardResponse(
            market=self._build_market(context.market, quote_result),
            watchlist=self._build_watchlist(
                context.watchlist, quote_result, user=user, static_info=watchlist_static_info
            ),
            portfolio=self._build_portfolio(context.portfolio, quote_result, user=user),
        )

    def market(
        self, *, user: Any, settings: Any, mode: DashboardMode = "full"
    ) -> DashboardMarketModule:
        context = self._market_context(user=user)
        symbols = [row.symbol for row in context.rows]
        quote_result = self._fetch_dashboard_quotes(
            user=user,
            settings=settings,
            symbols=symbols,
            name_map={row.symbol: row.name for row in context.rows},
            category_map={row.symbol: row.category for row in context.rows},
            allow_remote=mode == "full" and user.can(Permission.MARKET_READ),
        )
        return self._build_market(context, quote_result)

    def watchlist(
        self, *, user: Any, settings: Any, mode: DashboardMode = "full"
    ) -> DashboardWatchlistModule:
        context = self._watchlist_context(user=user)
        symbols = [row.symbol for row in context.rows]
        allow_market_remote = mode == "full" and user.can(Permission.MARKET_READ)
        quote_result = self._fetch_dashboard_quotes(
            user=user,
            settings=settings,
            symbols=symbols,
            name_map={row.symbol: row.name for row in context.rows},
            category_map={row.symbol: row.category for row in context.rows},
            allow_remote=allow_market_remote,
        )
        static_info = self._fetch_static_info(
            settings=settings, symbols=symbols, allow_remote=allow_market_remote
        )
        return self._build_watchlist(context, quote_result, user=user, static_info=static_info)

    def portfolio(
        self, *, user: Any, settings: Any, mode: DashboardMode = "full"
    ) -> DashboardPortfolioModule:
        context = self._portfolio_context(user=user)
        rows = [item for payload in context.payloads for item in payload.items]
        quote_result = self._fetch_dashboard_quotes(
            user=user,
            settings=settings,
            symbols=[row.symbol for row in rows],
            name_map={canonical_symbol(row.symbol): row.name for row in rows},
            category_map={canonical_symbol(row.symbol): row.market for row in rows},
            allow_remote=mode == "full" and user.can(Permission.MARKET_READ),
        )
        return self._build_portfolio(context, quote_result, user=user)

    def _load_context(self, *, user: Any) -> DashboardLoadContext:
        market = self._market_context(user=user)
        watchlist = self._watchlist_context(user=user)
        portfolio = self._portfolio_context(user=user)

        symbols: list[str] = []
        name_map: dict[str, str] = {}
        category_map: dict[str, str] = {}
        for row in market.rows:
            self._append_symbol_meta(row, symbols, name_map, category_map)
        for row in watchlist.rows:
            self._append_symbol_meta(row, symbols, name_map, category_map)
        for payload in portfolio.payloads:
            for row in payload.items:
                self._append_symbol_meta(
                    QuoteItem(symbol=row.symbol, name=row.name, category=row.market),
                    symbols,
                    name_map,
                    category_map,
                )

        return DashboardLoadContext(
            market=market,
            watchlist=watchlist,
            portfolio=portfolio,
            symbols=symbols,
            name_map=name_map,
            category_map=category_map,
        )

    def _append_symbol_meta(
        self,
        row: QuoteItem,
        symbols: list[str],
        name_map: dict[str, str],
        category_map: dict[str, str],
    ) -> None:
        symbol = canonical_symbol(row.symbol)
        if not symbol:
            return
        symbols.append(symbol)
        if row.name:
            name_map.setdefault(symbol, row.name)
        if row.category:
            category_map.setdefault(symbol, row.category)

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
        cached, missing, cache_fetched_at = _QUOTE_CACHE.get_many(
            user_key, settings_key, normalized_symbols
        )
        if not allow_remote:
            return QuoteFetchResult(
                quotes=cached,
                fetched_at=cache_fetched_at or fetched_at,
                source="cache" if cached else "local",
                stale=bool(missing),
            )
        if not missing:
            return QuoteFetchResult(
                quotes=cached,
                fetched_at=cache_fetched_at or fetched_at,
                source="cache",
                stale=False,
            )

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
                category_map={
                    symbol: normalized_category_map.get(symbol, "") for symbol in missing
                },
                settings=settings,
            )
            fetched_rows = [QuoteItem.model_validate(row) for row in fetched_rows]
            fetched_at = _iso_now()
            _QUOTE_CACHE.set_many(user_key, settings_key, fetched_rows, fetched_at)
            quote_map = dict(cached)
            for row in fetched_rows:
                symbol = canonical_symbol(row.symbol)
                if symbol:
                    quote_map[symbol] = row
            return QuoteFetchResult(
                quotes=quote_map, fetched_at=fetched_at, source="live", stale=False
            )
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

    def _fetch_static_info(
        self, *, settings: Any, symbols: list[str], allow_remote: bool
    ) -> dict[str, SecurityStaticInfo]:
        if (
            not allow_remote
            or not symbols
            or not hasattr(self.market_service, "get_security_static_info")
        ):
            return {}
        normalized = normalize_symbols(symbols)
        settings_key = _settings_signature(settings)
        cached, missing = _QUOTE_CACHE.get_static_info(settings_key, normalized)
        if not missing:
            return cached
        try:
            rows = self.market_service.get_security_static_info(missing, settings=settings)
        except Exception:
            return cached
        rows = [SecurityStaticInfo.model_validate(row) for row in rows]
        _QUOTE_CACHE.set_static_info(settings_key, rows)
        for row in rows:
            symbol = canonical_symbol(row.symbol)
            if symbol:
                cached[symbol] = row
        return cached

    def _market_context(self, *, user: Any) -> MarketLoadContext:
        if not user.can(Permission.MARKET_READ):
            return MarketLoadContext(
                available=False, error="Missing permission: market:read", rows=[]
            )
        try:
            config = MarketDashboardConfig.model_validate(
                self.market_service.get_config(user_id=user.id)
            )
            rows = [
                _static_quote_row(index.symbol, name=index.name, category="")
                for index in config.indices
                if index.enabled and canonical_symbol(index.symbol)
            ]
            return MarketLoadContext(available=True, error=None, rows=rows)
        except Exception as exc:
            return MarketLoadContext(available=True, error=str(exc), rows=[])

    def _build_market(
        self, context: MarketLoadContext, quote_result: QuoteFetchResult
    ) -> DashboardMarketModule:
        if not context.available:
            return DashboardMarketModule(
                available=False,
                error=context.error,
                source="local",
                fetched_at=quote_result.fetched_at,
                stale=False,
                indices=[],
            )
        rows = [_merge_quote(row, quote_result.quotes.get(row.symbol)) for row in context.rows]
        error = context.error or (quote_result.error if rows else None)
        return DashboardMarketModule(
            available=True,
            error=error,
            source=quote_result.source,
            fetched_at=quote_result.fetched_at,
            stale=quote_result.stale,
            indices=rows,
        )

    def _watchlist_context(self, *, user: Any) -> WatchlistLoadContext:
        if not user.can(Permission.WATCHLIST_READ):
            return self._empty_watchlist_context(
                available=False, error="Missing permission: watchlist:read"
            )

        try:
            items = [
                WatchlistItem.model_validate(item)
                for item in self.watchlist_service.list_items(category=None, user_id=user.id)
            ]
        except Exception as exc:
            return self._empty_watchlist_context(error=str(exc))

        counts = {category: 0 for category in WATCHLIST_CATEGORIES}
        for item in items:
            category = item.category
            if category in counts:
                counts[category] += 1

        return WatchlistLoadContext(
            available=True,
            error=None,
            rows=[_static_watchlist_row(item) for item in items],
            counts=counts,
        )

    def _build_watchlist(
        self,
        context: WatchlistLoadContext,
        quote_result: QuoteFetchResult,
        *,
        user: Any,
        static_info: dict[str, SecurityStaticInfo] | None = None,
    ) -> DashboardWatchlistModule:
        if not context.available:
            return self._empty_watchlist(
                available=False,
                error=context.error,
                fetched_at=quote_result.fetched_at,
                source="local",
                stale=False,
            )
        static_info = static_info or {}
        rows = [
            _merge_quote(
                _merge_static_info(row, static_info.get(row.symbol)),
                quote_result.quotes.get(row.symbol),
            )
            for row in context.rows
        ]
        views = _sort_watchlist_views(rows)
        quote_error = quote_result.error if rows and user.can(Permission.MARKET_READ) else None
        return DashboardWatchlistModule(
            available=True,
            error=context.error,
            source=quote_result.source,
            fetched_at=quote_result.fetched_at,
            stale=quote_result.stale,
            items=rows,
            views=views,
            counts_by_category=context.counts,
            total=len(rows),
            quote_error=quote_error,
        )

    def _empty_watchlist_context(
        self, *, available: bool = True, error: str | None = None
    ) -> WatchlistLoadContext:
        return WatchlistLoadContext(
            available=available,
            error=error,
            rows=[],
            counts={category: 0 for category in WATCHLIST_CATEGORIES},
        )

    def _empty_watchlist(
        self,
        *,
        available: bool = True,
        error: str | None = None,
        fetched_at: str | None = None,
        source: DashboardSource = "local",
        stale: bool = False,
    ) -> DashboardWatchlistModule:
        return DashboardWatchlistModule(
            available=available,
            error=error,
            source=source,
            fetched_at=fetched_at or _iso_now(),
            stale=stale,
            items=[],
            views=DashboardWatchlistViews(movers=[], gainers=[], losers=[], active=[]),
            counts_by_category={category: 0 for category in WATCHLIST_CATEGORIES},
            total=0,
            quote_error=None,
        )

    def _portfolio_context(self, *, user: Any) -> PortfolioLoadContext:
        if not user.can(Permission.PORTFOLIO_READ):
            return PortfolioLoadContext(
                available=False, error="Missing permission: portfolio:read", payloads=[]
            )

        payloads = []
        errors = []
        for market in PORTFOLIO_MARKETS:
            try:
                payloads.append(self._portfolio_local_payload(market, user=user))
            except Exception as exc:
                errors.append(f"{market}: {exc}")
        return PortfolioLoadContext(
            available=True, error="; ".join(errors) if errors else None, payloads=payloads
        )

    def _portfolio_local_payload(
        self, market: PortfolioMarket, *, user: Any
    ) -> DashboardPortfolioSnapshot:
        return DashboardPortfolioSnapshot.model_validate(
            self.portfolio_service.get_local_snapshot(market, user_id=user.id)
        )

    def _build_portfolio(
        self, context: PortfolioLoadContext, quote_result: QuoteFetchResult, *, user: Any
    ) -> DashboardPortfolioModule:
        if not context.available:
            return DashboardPortfolioModule(
                available=False,
                error=context.error,
                source="local",
                fetched_at=quote_result.fetched_at,
                stale=False,
                markets=[],
            )

        markets = []
        for payload in context.payloads:
            enriched = self._enrich_portfolio_payload(payload, quote_result.quotes)
            if enriched.items and quote_result.error and user.can(Permission.MARKET_READ):
                enriched.quote_error = quote_result.error
            markets.append(self._portfolio_market_summary(enriched))

        return DashboardPortfolioModule(
            available=True,
            error=context.error,
            source=quote_result.source,
            fetched_at=quote_result.fetched_at,
            stale=quote_result.stale,
            markets=markets,
        )

    def _enrich_portfolio_payload(
        self, payload: DashboardPortfolioSnapshot, quotes: dict[str, QuoteItem]
    ) -> DashboardPortfolioSnapshot:
        cash_value = _decimal(payload.total_capital) or Decimal("0")
        valuation = value_portfolio(
            [item.model_dump() for item in payload.items],
            {symbol: quote.model_dump() for symbol, quote in quotes.items()},
            cash_value,
            HistoricalDisplayValuation(),
        )
        enriched_rows = []
        for item in valuation.items:
            row = PortfolioItem.model_validate(item.row)
            row.symbol = item.symbol
            row.current_price = str(item.current_price) if item.current_price is not None else None
            row.change_value = item.quote.get("change_value") or row.change_value
            row.change_rate = item.quote.get("change_rate") or row.change_rate
            row.stock_value = _money(item.stock_value)
            row.pnl_ratio = _ratio(item.pnl)
            row.position_ratio = _ratio(item.position)
            enriched_rows.append(row)
        return DashboardPortfolioSnapshot(
            market=payload.market,
            total_capital=payload.total_capital,
            items=enriched_rows,
            total=len(enriched_rows),
            quote_error=payload.quote_error,
            total_assets=_money(valuation.total_assets)
            if valuation.has_market_value or cash_value
            else payload.total_assets,
            cash_ratio=_ratio(valuation.cash_ratio)
            if valuation.total_assets > 0
            else payload.cash_ratio,
        )

    def _portfolio_market_summary(
        self, payload: DashboardPortfolioSnapshot
    ) -> DashboardPortfolioMarket:
        items = payload.items or []
        market_value = Decimal("0")
        cost_value = Decimal("0")
        day_change_value = Decimal("0")
        has_market_value = False
        has_cost_value = False
        has_day_change = False

        for item in items:
            shares = _decimal(item.shares)
            stock_value = _decimal(item.stock_value)
            price = _decimal(item.current_price)
            cost_price = _decimal(item.cost_price)
            change_value = _decimal(item.change_value)

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

        cash_value = _decimal(payload.total_capital) or Decimal("0")
        total_assets_value = cash_value + market_value if has_market_value or cash_value else None
        cash_ratio = (
            _ratio(cash_value / total_assets_value * Decimal("100"))
            if total_assets_value not in (None, Decimal("0"))
            else payload.cash_ratio
        )
        pnl_value = market_value - cost_value if has_market_value and has_cost_value else None
        pnl_ratio = (
            pnl_value / cost_value * Decimal("100")
            if pnl_value is not None and cost_value != 0
            else None
        )
        previous_market_value = market_value - day_change_value if has_day_change else None
        day_change_rate = (
            day_change_value / previous_market_value * Decimal("100")
            if previous_market_value not in (None, Decimal("0"))
            else None
        )
        top_positions = sorted(items, key=_position_sort_value, reverse=True)[:5]

        return DashboardPortfolioMarket(
            market=payload.market,
            total_assets=payload.total_assets or _money(total_assets_value) or "0",
            market_value=_money(market_value if has_market_value else Decimal("0")) or "0",
            cash_amount=payload.total_capital or "0",
            cash_ratio=cash_ratio,
            cost_value=_money(cost_value if has_cost_value else Decimal("0")) or "0",
            unrealized_pnl_value=_money(pnl_value),
            unrealized_pnl_ratio=_ratio(pnl_ratio),
            day_change_value=_money(day_change_value) if has_day_change else None,
            day_change_rate=_ratio(day_change_rate),
            position_count=int(payload.total or len(items)),
            quote_error=payload.quote_error,
            top_positions=top_positions,
        )
