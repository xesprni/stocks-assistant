"""Portfolio positions tool."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional

from app.core.tools.base_tool import BaseTool, ToolResult
from app.core.watchlist.service import LongbridgeUnavailableError


class GetPortfolioPositionsTool(BaseTool):
    name: str = "get_portfolio_positions"
    description: str = (
        "查询当前用户本地持仓列表时使用此工具。Use this read-only internal tool when the user "
        "asks about their portfolio, positions, holdings, asset allocation, exposure, P/L, "
        "仓位、持仓、组合、资产配置或盈亏. It returns data from the portfolio module and, when "
        "Longbridge is configured, enriched quote/valuation fields. This tool never places trades."
    )
    params: dict = {
        "type": "object",
        "properties": {
            "market": {
                "type": "string",
                "enum": ["US", "A", "ALL"],
                "description": "Portfolio market to read. Use US for US stocks, A for A-shares, or ALL for both. Default: US.",
                "default": "US",
            },
        },
    }

    def __init__(self, portfolio_service: Any = None, user_id: Optional[str] = None, settings: Any = None):
        self.portfolio_service = portfolio_service
        self.user_id = user_id
        self.settings = settings

    def execute(self, args: Dict[str, Any]) -> ToolResult:
        service = self._get_portfolio_service()
        if service is None:
            return ToolResult.fail("Portfolio service not initialized")

        market = str(args.get("market") or "US").strip().upper()
        if market in {"BOTH", "*"}:
            market = "ALL"
        if market not in {"US", "A", "ALL"}:
            return ToolResult.fail("market must be one of: US, A, ALL")

        markets = ["US", "A"] if market == "ALL" else [market]
        try:
            results = [
                self._sanitize_portfolio_list(
                    service.list_items(item_market, user_id=self.user_id, settings=self.settings)
                )
                for item_market in markets
            ]
        except LongbridgeUnavailableError as exc:
            return ToolResult.fail(str(exc))
        except ValueError as exc:
            return ToolResult.fail(str(exc))

        quote_errors = [
            {"market": item["market"], "error": item["quote_error"]}
            for item in results
            if item.get("quote_error")
        ]
        return ToolResult.success(
            {
                "source": "portfolio",
                "generated_at": datetime.now().isoformat(timespec="seconds"),
                "markets": results,
                "total_positions": sum(int(item.get("total", 0) or 0) for item in results),
                "quote_errors": quote_errors,
            }
        )

    def _get_portfolio_service(self):
        if self.portfolio_service is not None:
            return self.portfolio_service
        try:
            from app.deps import get_portfolio_service

            return get_portfolio_service()
        except Exception:
            return None

    def _sanitize_portfolio_list(self, data: dict[str, Any]) -> dict[str, Any]:
        return {
            "market": data.get("market"),
            "total_capital": data.get("total_capital", "0"),
            "total_assets": data.get("total_assets", "0"),
            "cash_ratio": data.get("cash_ratio"),
            "items": [self._sanitize_item(item) for item in data.get("items", [])],
            "total": data.get("total", 0),
            "quote_error": data.get("quote_error"),
        }

    def _sanitize_item(self, item: dict[str, Any]) -> dict[str, Any]:
        # 工具返回给 LLM 的是持仓业务字段，避免暴露内部用户标识等存储细节。
        allowed_fields = (
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
        return {field: item.get(field) for field in allowed_fields if field in item}
