"""Shared portfolio projections for management and read-only tools."""

from datetime import datetime
from typing import Any

PORTFOLIO_FIELDS = (
    "id",
    "market",
    "symbol",
    "name",
    "shares",
    "cost_price",
    "currency",
    "current_price",
    "change_value",
    "change_rate",
    "pe_ttm_ratio",
    "stock_value",
    "position_ratio",
    "pnl_ratio",
    "note",
    "created_at",
    "updated_at",
)


def sanitize_portfolio_item(item: dict[str, Any]) -> dict[str, Any]:
    # 只投影持仓业务字段，内部用户标识和存储信息不得进入 LLM 上下文。
    return {field: item.get(field) for field in PORTFOLIO_FIELDS if field in item}


def sanitize_portfolio_list(data: dict[str, Any]) -> dict[str, Any]:
    return {
        "market": data.get("market"),
        "total_capital": data.get("total_capital", "0"),
        "total_assets": data.get("total_assets", "0"),
        "cash_ratio": data.get("cash_ratio"),
        "items": [sanitize_portfolio_item(item) for item in data.get("items", [])],
        "total": data.get("total", 0),
        "quote_error": data.get("quote_error"),
    }


def portfolio_snapshot(results: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "source": "portfolio",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "markets": results,
        "total_positions": sum(int(item.get("total", 0) or 0) for item in results),
        "quote_errors": [
            {"market": item["market"], "error": item["quote_error"]}
            for item in results
            if item.get("quote_error")
        ],
    }
