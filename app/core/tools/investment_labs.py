"""面向 Agent 的只读 Investment Labs 工具。"""

from typing import Any, Callable, Optional

from app.core.tools.base_tool import BaseTool, ToolResult
from app.schemas.labs import GreaterChinaRequest, LabAIValuationRequest, LabDataRequest, PeerComparisonRequest, PortfolioLabRequest


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


class LabAIDataTool(BaseTool):
    """仅由 Labs 请求动态注册，不能通过通用 ToolManager 提升权限。"""

    name = "get_lab_data"
    description = (
        "Read data for the current experiment using the signed-in user's services. "
        "Returns an artifact ID and source data. Portfolio is analyzed separately in each market's native currency; "
        "never invent FX rates. Use financial_reports, security_insights and quotes to collect actual valuation inputs; "
        "peers computes medians for the supplied comparable companies. Other actions may be unavailable for this lab."
    )
    params = LabDataRequest.model_json_schema()

    def __init__(self, execute: Callable[[dict], ToolResult], actions: list[str]):
        import copy

        self._execute = execute
        self.params = copy.deepcopy(type(self).params)
        self.params["properties"]["action"]["enum"] = actions

    def execute(self, args: dict[str, Any]) -> ToolResult:
        return self._execute(args)


class LabAIValuationTool(BaseTool):
    name = "calculate_lab_valuation"
    description = (
        "Calculate a reproducible DCF, reverse DCF or relative valuation from collected evidence. "
        "Every numeric input requires evidence: source artifact ID + JSON Pointer + unit note for historical facts, "
        "or kind=assumption + an explicit rationale for forecast choices. Revenue, shares_outstanding, cash and debt "
        "must all be present with actual source evidence; never default missing cash/debt to zero. "
        "All amounts must use the declared currency in single currency units; shares use single shares. "
        "Source inputs may apply a documented unit scale and optionally divide by another source numeric field. "
        "Relative valuation target_metric must be TOTAL net income/book equity/revenue, not a per-share metric; "
        "peer_median must come from a peers artifact excluding the target. Output is total implied equity value. "
        "The model is saved only when the experiment completes and the user has knowledge:write permission."
    )
    params = LabAIValuationRequest.model_json_schema()

    def __init__(self, execute: Callable[[dict], ToolResult]):
        self._execute = execute

    def execute(self, args: dict[str, Any]) -> ToolResult:
        return self._execute(args)
