"""Dashboard aggregate API schemas."""

from typing import Literal, Optional

from pydantic import BaseModel, Field

from app.schemas.market import QuoteItem
from app.schemas.portfolio import PortfolioItem, PortfolioMarket

WatchlistViewKey = Literal["movers", "gainers", "losers", "active"]


class DashboardModule(BaseModel):
    """Common module availability metadata."""

    available: bool = True
    error: Optional[str] = None
    fetched_at: Optional[str] = None
    stale: bool = False
    source: Optional[Literal["local", "cache", "live"]] = None


class DashboardMarketModule(DashboardModule):
    """Market index snapshot for Dashboard."""

    indices: list[QuoteItem] = Field(default_factory=list)


class DashboardWatchlistRow(QuoteItem):
    """Dashboard watchlist quote row."""

    id: Optional[int] = None
    name_cn: str = ""
    name_en: str = ""
    name_hk: str = ""
    exchange: str = ""
    currency: str = ""
    lot_size: str = ""
    board: str = ""
    security_type: str = ""
    note: str = ""
    created_at: str = ""
    updated_at: str = ""


class DashboardWatchlistViews(BaseModel):
    """Pre-sorted watchlist views."""

    movers: list[DashboardWatchlistRow] = Field(default_factory=list)
    gainers: list[DashboardWatchlistRow] = Field(default_factory=list)
    losers: list[DashboardWatchlistRow] = Field(default_factory=list)
    active: list[DashboardWatchlistRow] = Field(default_factory=list)


class DashboardWatchlistModule(DashboardModule):
    """Complete watchlist data for Dashboard paging."""

    items: list[DashboardWatchlistRow] = Field(default_factory=list)
    views: DashboardWatchlistViews = Field(default_factory=DashboardWatchlistViews)
    counts_by_category: dict[str, int] = Field(default_factory=dict)
    total: int = 0
    quote_error: Optional[str] = None


class DashboardPortfolioPosition(PortfolioItem):
    """Top portfolio position shown on Dashboard."""


class DashboardPortfolioMarket(BaseModel):
    """Per-market portfolio summary."""

    market: PortfolioMarket
    total_assets: str = "0"
    market_value: str = "0"
    cash_amount: str = "0"
    cash_ratio: Optional[str] = None
    cost_value: str = "0"
    unrealized_pnl_value: Optional[str] = None
    unrealized_pnl_ratio: Optional[str] = None
    day_change_value: Optional[str] = None
    day_change_rate: Optional[str] = None
    position_count: int = 0
    quote_error: Optional[str] = None
    top_positions: list[DashboardPortfolioPosition] = Field(default_factory=list)


class DashboardPortfolioModule(DashboardModule):
    """Portfolio summary grouped by market."""

    markets: list[DashboardPortfolioMarket] = Field(default_factory=list)


class DashboardResponse(BaseModel):
    """Aggregated Dashboard payload."""

    market: DashboardMarketModule
    watchlist: DashboardWatchlistModule
    portfolio: DashboardPortfolioModule
