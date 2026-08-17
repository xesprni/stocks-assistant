"""Portfolio API schemas."""

from decimal import Decimal, InvalidOperation
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

PortfolioMarket = Literal["US", "A", "H"]
PortfolioTransactionSide = Literal["buy", "sell", "adjust"]


def _non_negative_decimal_text(value: Optional[str], field: str) -> Optional[str]:
    if value in (None, ""):
        return None
    try:
        number = Decimal(str(value).replace(",", "").strip())
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(f"{field} must be a number") from exc
    if not number.is_finite() or number < 0:
        raise ValueError(f"{field} must be a finite non-negative number")
    return format(number.normalize(), "f")


class PortfolioSettings(BaseModel):
    """Portfolio-level settings for one market."""

    market: PortfolioMarket
    total_capital: str = "0"


class PortfolioSettingsUpdate(BaseModel):
    """Update portfolio settings."""

    total_capital: str = "0"

    @field_validator("total_capital")
    @classmethod
    def valid_total_capital(cls, value: str) -> str:
        return _non_negative_decimal_text(value, "total_capital") or "0"


class PortfolioItemBase(BaseModel):
    """Editable portfolio item fields."""

    market: PortfolioMarket
    symbol: str = Field(min_length=1)
    name: str = ""
    shares: Optional[str] = None
    cost_price: Optional[str] = None
    note: str = ""

    @field_validator("shares", "cost_price")
    @classmethod
    def valid_optional_amount(cls, value: Optional[str], info) -> Optional[str]:
        return _non_negative_decimal_text(value, info.field_name)


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

    @field_validator("shares", "cost_price")
    @classmethod
    def valid_optional_amount(cls, value: Optional[str], info) -> Optional[str]:
        return _non_negative_decimal_text(value, info.field_name)


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
    valuation_price_source: Literal["live", "cost", "unavailable"] = "unavailable"
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
    valuation_complete: bool = True
    unpriced_symbols: list[str] = Field(default_factory=list)


class PortfolioSellRequest(BaseModel):
    """Sell shares at a user-specified execution price."""

    shares: str = Field(min_length=1)
    price: str = Field(min_length=1)
    note: str = ""

    @field_validator("shares", "price")
    @classmethod
    def valid_positive_amount(cls, value: str, info) -> str:
        normalized = _non_negative_decimal_text(value, info.field_name)
        if normalized is None or Decimal(normalized) <= 0:
            raise ValueError(f"{info.field_name} must be greater than 0")
        return normalized


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
