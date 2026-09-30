"""Shared portfolio projections for management and read-only tools."""

from datetime import datetime
from typing import Any

from app.constants.tools import (
    PORTFOLIO_FIELDS as PORTFOLIO_FIELDS,
)
from app.schemas.portfolio import PortfolioItem, PortfolioListResponse, PortfolioPositionFields
from app.schemas.tool_outputs import PortfolioQuoteError, PortfolioSnapshot, PortfolioToolMarket


def sanitize_portfolio_item(item: PortfolioItem | dict[str, Any]) -> PortfolioPositionFields:
    # 较窄的模型声明公开字段，不会自动带入数据库用户标识或新增内部字段。
    return PortfolioPositionFields.model_validate(item)


def sanitize_portfolio_list(data: dict[str, Any] | PortfolioListResponse) -> PortfolioToolMarket:
    payload = PortfolioListResponse.model_validate(data)
    return PortfolioToolMarket(
        market=payload.market,
        total_capital=payload.total_capital,
        total_assets=payload.total_assets,
        cash_ratio=payload.cash_ratio,
        items=[sanitize_portfolio_item(item) for item in payload.items],
        total=payload.total,
        quote_error=payload.quote_error,
    )


def portfolio_snapshot(results: list[PortfolioToolMarket]) -> PortfolioSnapshot:
    return PortfolioSnapshot(
        source="portfolio",
        generated_at=datetime.now().isoformat(timespec="seconds"),
        markets=results,
        total_positions=sum(int(item.total or 0) for item in results),
        quote_errors=[
            PortfolioQuoteError(market=item.market, error=item.quote_error)
            for item in results
            if item.quote_error
        ],
    )
