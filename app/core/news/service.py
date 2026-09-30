"""Longbridge security news service."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from app.constants.news import DEFAULT_NEWS_LIMIT
from app.core.market.errors import LongbridgeUnavailableError
from app.core.market.utils import canonical_symbol
from app.schemas.news import SecurityNewsItem, SecurityNewsResponse


def normalize_news_symbol(symbol: str) -> str:
    value = str(symbol or "").strip().upper()
    if not value:
        raise ValueError("Symbol is required")
    if "." in value:
        return canonical_symbol(value)
    if value.isdigit():
        if len(value) >= 6:
            suffix = "SH" if value.startswith(("5", "6", "9")) else "SZ"
            return f"{value}.{suffix}"
        return f"{value.lstrip('0') or '0'}.HK"
    return f"{value}.US"


def _to_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _published_at_iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value).isoformat()
    return str(value)


def _published_at_ts(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return int(value.timestamp())
    if isinstance(value, (int, float)):
        return int(value)
    return None


def _news_item_to_model(item: Any) -> SecurityNewsItem:
    published_at = getattr(item, "published_at", None)
    return SecurityNewsItem(
        id=str(getattr(item, "id", "") or ""),
        title=str(getattr(item, "title", "") or ""),
        description=str(getattr(item, "description", "") or ""),
        url=str(getattr(item, "url", "") or ""),
        published_at=_published_at_iso(published_at),
        published_at_ts=_published_at_ts(published_at),
        likes_count=_to_int(getattr(item, "likes_count", None)),
        comments_count=_to_int(getattr(item, "comments_count", None)),
        shares_count=_to_int(getattr(item, "shares_count", None)),
    )


class NewsService:
    """Fetch symbol news from Longbridge."""

    def get_security_news(
        self, symbol: str, limit: int = DEFAULT_NEWS_LIMIT, settings: Any = None
    ) -> SecurityNewsResponse:
        normalized_symbol = normalize_news_symbol(symbol)
        ctx = self._content_context(settings=settings)
        try:
            raw_items = list(ctx.news(normalized_symbol))
        except Exception as exc:
            raise LongbridgeUnavailableError(str(exc)) from exc

        items = [_news_item_to_model(item) for item in raw_items]
        items.sort(key=lambda item: item.published_at_ts or 0, reverse=True)
        items = items[:limit]
        return SecurityNewsResponse(symbol=normalized_symbol, news=items, total=len(items))

    def _content_context(self, settings: Any = None):
        from app.core.market.longbridge_context import get_cached_context

        return get_cached_context("ContentContext", settings=settings)
