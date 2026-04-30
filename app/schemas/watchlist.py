"""Watchlist API Schema."""

from typing import Literal, Optional

from pydantic import BaseModel, Field

WatchlistCategory = Literal["US", "A", "H"]


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
