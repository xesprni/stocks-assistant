"""Portfolio API schemas."""

from typing import Literal, Optional

from pydantic import BaseModel, Field

PortfolioMarket = Literal["US", "A"]
PortfolioTransactionSide = Literal["buy", "sell", "adjust"]


class PortfolioSettings(BaseModel):
    """Portfolio-level settings for one market."""

    market: PortfolioMarket
    total_capital: str = "0"


class PortfolioSettingsUpdate(BaseModel):
    """Update portfolio settings."""

    total_capital: str = "0"


class PortfolioItemBase(BaseModel):
    """Editable portfolio item fields."""

    market: PortfolioMarket
    symbol: str = Field(min_length=1)
    name: str = ""
    shares: Optional[str] = None
    cost_price: Optional[str] = None
    note: str = ""


class PortfolioItemCreate(PortfolioItemBase):
    """Create portfolio item request."""


class PortfolioItemUpdate(BaseModel):
    """Update portfolio item request."""

    market: Optional[PortfolioMarket] = None
    symbol: Optional[str] = Field(default=None, min_length=1)
    name: Optional[str] = None
    shares: Optional[str] = None
    cost_price: Optional[str] = None
    note: Optional[str] = None


class PortfolioItem(PortfolioItemBase):
    """Portfolio item enriched with realtime market data."""

    id: int
    currency: str = ""
    pe_ttm_ratio: Optional[str] = None
    current_price: Optional[str] = None
    change_value: Optional[str] = None
    change_rate: Optional[str] = None
    stock_value: Optional[str] = None
    position_ratio: Optional[str] = None
    pnl_ratio: Optional[str] = None
    created_at: str
    updated_at: str


class PortfolioListResponse(BaseModel):
    """Portfolio list response."""

    market: PortfolioMarket
    total_capital: str = "0"
    total_assets: str = "0"
    cash_ratio: Optional[str] = None
    items: list[PortfolioItem]
    total: int
    quote_error: Optional[str] = None


class PortfolioSellRequest(BaseModel):
    """Sell shares at a user-specified execution price."""

    shares: str = Field(min_length=1)
    price: str = Field(min_length=1)
    note: str = ""


class PortfolioTransaction(BaseModel):
    """Local portfolio transaction record."""

    id: int
    market: PortfolioMarket
    symbol: str
    name: str = ""
    side: PortfolioTransactionSide
    shares: str
    price: str
    amount: str
    realized_pnl: Optional[str] = None
    note: str = ""
    created_at: str


class PortfolioTransactionListResponse(BaseModel):
    """Portfolio transaction history response."""

    market: PortfolioMarket
    transactions: list[PortfolioTransaction]
    total: int


class PortfolioSellResponse(BaseModel):
    """Sell result with updated local holding and transaction record."""

    item: PortfolioItem
    transaction: PortfolioTransaction
    total_capital: str = "0"


class PortfolioSearchResult(BaseModel):
    """Longbridge search result for portfolio symbols."""

    market: PortfolioMarket
    symbol: str
    name: str = ""
    currency: str = ""
    last_done: Optional[str] = None
    change_rate: Optional[str] = None


class PortfolioSearchResponse(BaseModel):
    """Portfolio symbol search response."""

    results: list[PortfolioSearchResult]
    total: int
