"""Pure portfolio valuation with explicit cost-basis and historical-display policies."""

from dataclasses import dataclass, replace
from decimal import Decimal, InvalidOperation
from typing import Any, Protocol

from app.core.market.utils import canonical_symbol


def money(value: Decimal | None) -> str | None:
    return None if value is None else format(value.quantize(Decimal("0.01")), "f")


def ratio(value: Decimal | None) -> str | None:
    return None if value is None else f"{value.quantize(Decimal('0.01'))}%"


def position_ratio(
    value: Decimal | None, total_assets: Decimal, *, fallback: Decimal | None = None
) -> Decimal | None:
    if value is None or total_assets <= 0:
        return fallback
    return value / total_assets * Decimal("100")


def pnl_ratio(
    price: Decimal | None, cost_price: Decimal | None, *, fallback: Decimal | None = None
) -> Decimal | None:
    if price is None or cost_price is None or cost_price == 0:
        return fallback
    return (price - cost_price) / cost_price * Decimal("100")


def decimal_value(value: Any, *, percentage: bool = False) -> Decimal | None:
    if value is None:
        return None
    text = str(value).replace(",", "").strip()
    if percentage:
        text = text.replace("%", "")
    try:
        parsed = Decimal(text)
        return parsed if parsed.is_finite() else None
    except (InvalidOperation, TypeError, ValueError):
        return None


def non_negative_value(value: Any) -> Decimal | None:
    parsed = decimal_value(value)
    return parsed if parsed is not None and parsed >= 0 else None


@dataclass(frozen=True)
class ValuedPosition:
    symbol: str
    row: dict[str, Any]
    quote: dict[str, Any]
    shares: Decimal | None
    cost_price: Decimal | None
    current_price: Any
    stock_value: Decimal | None
    pnl: Decimal | None
    source: str
    position: Decimal | None = None


class ValuationPolicy(Protocol):
    def select(self, row: dict[str, Any], quote: dict[str, Any]) -> ValuedPosition: ...

    def position(self, item: ValuedPosition, total_assets: Decimal) -> Decimal | None: ...


class CostBasisValuation:
    """Portfolio values missing quotes at cost while keeping live P&L unavailable."""

    def select(self, row: dict[str, Any], quote: dict[str, Any]) -> ValuedPosition:
        shares = non_negative_value(row.get("shares"))
        cost = non_negative_value(row.get("cost_price"))
        price = non_negative_value(quote.get("last_done"))
        valuation_price = price if price is not None else cost
        return ValuedPosition(
            canonical_symbol(row.get("symbol")),
            row,
            quote,
            shares,
            cost,
            price,
            shares * valuation_price
            if shares is not None and valuation_price is not None
            else None,
            pnl_ratio(price, cost),
            "live" if price is not None else "cost" if cost is not None else "unavailable",
        )

    def position(self, item: ValuedPosition, total_assets: Decimal) -> Decimal | None:
        return position_ratio(item.stock_value, total_assets)


class HistoricalDisplayValuation:
    """Dashboard retains historical display values and never substitutes cost for a quote."""

    def select(self, row: dict[str, Any], quote: dict[str, Any]) -> ValuedPosition:
        shares = decimal_value(row.get("shares"), percentage=True)
        cost = decimal_value(row.get("cost_price"), percentage=True)
        current_price = quote.get("last_done") or row.get("current_price")
        price = decimal_value(current_price, percentage=True)
        stock_value = (
            shares * price
            if shares is not None and price is not None
            else decimal_value(row.get("stock_value"), percentage=True)
        )
        return ValuedPosition(
            canonical_symbol(row.get("symbol")),
            row,
            quote,
            shares,
            cost,
            current_price,
            stock_value,
            pnl_ratio(price, cost, fallback=decimal_value(row.get("pnl_ratio"), percentage=True)),
            "live"
            if quote.get("last_done")
            else "historical"
            if stock_value is not None
            else "unavailable",
        )

    def position(self, item: ValuedPosition, total_assets: Decimal) -> Decimal | None:
        # Dashboard 历史上以展示精度市值计算仓位；显式保留与 Portfolio 的精度差异。
        return position_ratio(
            decimal_value(money(item.stock_value)),
            total_assets,
            fallback=decimal_value(item.row.get("position_ratio"), percentage=True),
        )


@dataclass(frozen=True)
class PortfolioValuation:
    items: list[ValuedPosition]
    total_assets: Decimal
    cash_ratio: Decimal | None
    has_market_value: bool


def value_portfolio(
    rows: list[dict[str, Any]],
    quotes: dict[str, dict[str, Any]],
    cash: Decimal,
    policy: ValuationPolicy,
) -> PortfolioValuation:
    selected = [
        policy.select(row, quotes.get(canonical_symbol(row.get("symbol")), {})) for row in rows
    ]
    total_assets = cash + sum((item.stock_value or Decimal("0") for item in selected), Decimal("0"))
    # 所有行共享完整总资产后再计算仓位；策略只负责选价与历史回退。
    return PortfolioValuation(
        [replace(item, position=policy.position(item, total_assets)) for item in selected],
        total_assets,
        position_ratio(cash, total_assets),
        any(item.stock_value is not None for item in selected),
    )
