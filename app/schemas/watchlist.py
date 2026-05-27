"""Watchlist API Schema."""

from typing import Literal, Optional

from pydantic import BaseModel, Field

from app.schemas.market import QuoteItem

WatchlistCategory = Literal["US", "A", "H"]
WatchlistOverviewSource = Literal["local", "cache", "live"]
WatchlistQuoteView = Literal["movers", "gainers", "losers", "active"]


class WatchlistItem(BaseModel):
    """本地 watchlist 条目。"""

    id: int
    category: WatchlistCategory
    symbol: str
    name: str = ""
    name_cn: str = ""
    name_en: str = ""
    name_hk: str = ""
    exchange: str = ""
    currency: str = ""
    last_done: Optional[str] = None
    change_value: Optional[str] = None
    change_rate: Optional[str] = None
    note: str = ""
    created_at: str
    updated_at: str


class WatchlistItemCreate(BaseModel):
    """新增 watchlist 条目请求。"""

    category: WatchlistCategory
    symbol: str = Field(min_length=1)
    name: str = ""
    name_cn: str = ""
    name_en: str = ""
    name_hk: str = ""
    exchange: str = ""
    currency: str = ""
    last_done: Optional[str] = None
    change_value: Optional[str] = None
    change_rate: Optional[str] = None
    note: str = ""


class WatchlistListResponse(BaseModel):
    """Watchlist 列表响应。"""

    items: list[WatchlistItem]
    total: int


class WatchlistSearchResult(BaseModel):
    """Longbridge 搜索结果。"""

    category: WatchlistCategory
    symbol: str
    name: str = ""
    name_cn: str = ""
    name_en: str = ""
    name_hk: str = ""
    exchange: str = ""
    currency: str = ""
    last_done: Optional[str] = None
    change_value: Optional[str] = None
    change_rate: Optional[str] = None


class WatchlistSearchResponse(BaseModel):
    """Longbridge 搜索响应。"""

    results: list[WatchlistSearchResult]
    total: int


class WatchlistReorderRequest(BaseModel):
    """Watchlist 排序请求：按新顺序传入 id 列表。"""

    ids: list[int]


class WatchlistOverviewRow(QuoteItem):
    """带本地管理字段的 Watchlist 行情行。"""

    id: int
    category: WatchlistCategory
    name_cn: str = ""
    name_en: str = ""
    name_hk: str = ""
    exchange: str = ""
    currency: str = ""
    note: str = ""
    created_at: str
    updated_at: str


class WatchlistOverviewViews(BaseModel):
    """按行情维度预排序的 Watchlist 视图。"""

    movers: list[WatchlistOverviewRow] = Field(default_factory=list)
    gainers: list[WatchlistOverviewRow] = Field(default_factory=list)
    losers: list[WatchlistOverviewRow] = Field(default_factory=list)
    active: list[WatchlistOverviewRow] = Field(default_factory=list)


class WatchlistOverviewResponse(BaseModel):
    """Watchlist 手动行情概览响应。"""

    available: bool = True
    error: Optional[str] = None
    fetched_at: Optional[str] = None
    stale: bool = False
    source: Optional[WatchlistOverviewSource] = None
    items: list[WatchlistOverviewRow] = Field(default_factory=list)
    views: WatchlistOverviewViews = Field(default_factory=WatchlistOverviewViews)
    counts_by_category: dict[str, int] = Field(default_factory=dict)
    total: int = 0
    quote_error: Optional[str] = None
