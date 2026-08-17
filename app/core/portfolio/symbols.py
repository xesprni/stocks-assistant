"""Portfolio symbol normalization shared by HTTP and Agent entry points."""

from __future__ import annotations

from typing import Optional

from app.schemas.portfolio import PortfolioMarket


_SUFFIX_MARKETS: dict[str, PortfolioMarket] = {"US": "US", "SH": "A", "SZ": "A", "HK": "H"}


def canonical_portfolio_symbol(symbol: str, market: Optional[PortfolioMarket] = None) -> str:
    normalized = str(symbol or "").strip().upper()
    if not normalized:
        raise ValueError("symbol is required")

    base, separator, suffix = normalized.rpartition(".")
    suffix_market = _SUFFIX_MARKETS.get(suffix) if separator else None
    if suffix_market:
        if market and suffix_market != market:
            raise ValueError(f"symbol suffix .{suffix} does not match market {market}")
        if suffix == "HK" and base.isdigit():
            base = str(int(base))
        return f"{base}.{suffix}"

    if not market:
        return normalized
    if market == "US":
        return f"{normalized}.US"
    if market == "H":
        if not normalized.isdigit():
            raise ValueError("Hong Kong shorthand symbol must be numeric")
        return f"{int(normalized)}.HK"
    suffix = "SH" if normalized.startswith(("5", "6", "9")) else "SZ"
    return f"{normalized}.{suffix}"
