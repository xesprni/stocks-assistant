"""Portfolio positions tool."""

from __future__ import annotations

from typing import Any

from app.core.market.errors import LongbridgeUnavailableError
from app.core.tools.base_tool import BaseTool, ToolResult
from app.core.tools.portfolio_output import (
    portfolio_snapshot,
    sanitize_portfolio_item,
    sanitize_portfolio_list,
)


class GetPortfolioPositionsTool(BaseTool):
    read_only = True
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
                "enum": ["US", "A", "H", "ALL"],
                "description": "Portfolio market to read. Use US, A, H for Hong Kong, or ALL. Default: US.",
                "default": "US",
            },
        },
    }

    def __init__(
        self, portfolio_service: Any = None, user_id: str | None = None, settings: Any = None
    ):
        self.portfolio_service = portfolio_service
        self.user_id = user_id
        self.settings = settings

    def execute(self, args: dict[str, Any]) -> ToolResult:
        service = self._get_portfolio_service()
        if service is None:
            return ToolResult.fail("Portfolio service not initialized")

        market = str(args.get("market") or "US").strip().upper()
        if market in {"BOTH", "*"}:
            market = "ALL"
        if market not in {"US", "A", "H", "ALL"}:
            return ToolResult.fail("market must be one of: US, A, H, ALL")

        markets = ["US", "A", "H"] if market == "ALL" else [market]
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

        return ToolResult.success(portfolio_snapshot(results))

    def _get_portfolio_service(self):
        if self.portfolio_service is not None:
            return self.portfolio_service
        try:
            from app.deps import get_portfolio_service

            return get_portfolio_service()
        except Exception:
            return None

    _sanitize_portfolio_list = staticmethod(sanitize_portfolio_list)

    _sanitize_item = staticmethod(sanitize_portfolio_item)
