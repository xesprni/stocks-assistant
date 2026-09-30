"""内置工具固定结果；明确声明公开字段，避免内部标识进入 LLM 上下文。"""

from app.schemas.base import AppModel
from app.schemas.common import StatusResponse
from app.schemas.portfolio import PortfolioPositionFields, PortfolioSearchResult, PortfolioSettings
from app.schemas.watchlist import WatchlistItem, WatchlistSearchResult


class ToolItemResult[T: AppModel](AppModel):
    source: str
    item: T


class ItemMutationResult[T: AppModel](StatusResponse):
    item: T


class ItemDeletionResult[T: AppModel](StatusResponse):
    deleted_item: T


class PortfolioMutationResult(ItemMutationResult[PortfolioPositionFields]):
    operation: str


class PortfolioDeletionResult(ItemDeletionResult[PortfolioPositionFields]):
    operation: str


class PortfolioSettingsResult(StatusResponse):
    operation: str
    settings: PortfolioSettings


class PortfolioToolMarket(AppModel):
    market: str
    total_capital: str
    total_assets: str
    cash_ratio: str | None
    items: list[PortfolioPositionFields]
    total: int
    quote_error: str | None


class PortfolioQuoteError(AppModel):
    market: str
    error: str


class PortfolioSnapshot(AppModel):
    source: str
    generated_at: str
    markets: list[PortfolioToolMarket]
    total_positions: int
    quote_errors: list[PortfolioQuoteError]


class PortfolioToolList(PortfolioSnapshot):
    market: str


class PortfolioToolSearch(AppModel):
    source: str
    generated_at: str
    query: str
    market: str
    results: list[PortfolioSearchResult]
    total: int


class WatchlistToolList(AppModel):
    source: str
    generated_at: str
    category: str
    items: list[WatchlistItem]
    total: int


class WatchlistToolSearch(AppModel):
    source: str
    generated_at: str
    query: str
    category: str
    results: list[WatchlistSearchResult]
    total: int
