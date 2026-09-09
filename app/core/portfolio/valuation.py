"""Pure Decimal calculations; callers retain price selection and fallback policies."""

from decimal import Decimal


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
