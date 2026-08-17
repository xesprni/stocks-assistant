"""面向 Agent 的只读 Investment Labs 工具。"""

from typing import Any, Optional

from app.core.tools.base_tool import BaseTool, ToolResult
from app.schemas.labs import GreaterChinaRequest, PeerComparisonRequest, PortfolioLabRequest


class GetInvestmentLabsTool(BaseTool):
    name = "get_investment_labs"
    description = "Run read-only portfolio risk/attribution, peer valuation, or Greater China market-context analysis."
    params = {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["portfolio", "peers", "valuation_models", "greater_china"]},
            "symbol": {"type": "string"},
            "symbols": {"type": "array", "items": {"type": "string"}},
            "benchmark_symbol": {"type": "string"},
            "lookback_days": {"type": "integer", "minimum": 30, "maximum": 1000},
            "paired_symbol": {"type": "string"},
            "china_related_us_listing": {"type": "boolean"},
        },
        "required": ["action"],
    }

    def __init__(self, *, user_id: Optional[str] = None, settings=None, service=None):
        self.user_id = user_id or ""
        self.settings = settings
        self.service = service

    def execute(self, args: dict[str, Any]) -> ToolResult:
        try:
            service = self.service
            if service is None:
                from app.deps import get_investment_lab_service

                service = get_investment_lab_service()
            action = str(args.get("action") or "")
            if action == "portfolio":
                request = PortfolioLabRequest(
                    benchmark_symbol=args.get("benchmark_symbol") or "SPY.US",
                    lookback_days=args.get("lookback_days") or 252,
                )
                return ToolResult.success(service.analyze_portfolio(self.user_id, request, settings=self.settings))
            if action == "peers":
                return ToolResult.success(service.compare_peers(PeerComparisonRequest(symbols=args.get("symbols") or []), settings=self.settings))
            if action == "valuation_models":
                return ToolResult.success({"models": service.list_valuation_models(self.user_id, args.get("symbol"))})
            if action == "greater_china":
                request = GreaterChinaRequest(
                    symbol=args.get("symbol") or "", paired_symbol=args.get("paired_symbol") or None,
                    china_related_us_listing=bool(args.get("china_related_us_listing")),
                )
                return ToolResult.success(service.greater_china_context(request, settings=self.settings))
            return ToolResult.fail("Unknown action")
        except Exception as exc:
            return ToolResult.fail(f"Investment Labs failed: {exc}")

