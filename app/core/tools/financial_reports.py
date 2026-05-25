"""Longbridge financial reports tool."""

from typing import Any, Dict

from app.core.fundamentals.service import FundamentalService
from app.core.tools.base_tool import BaseTool, ToolResult
from app.core.watchlist.service import LongbridgeUnavailableError


class GetFinancialReportsTool(BaseTool):
    name: str = "get_financial_reports"
    description: str = (
        "查询股票财报/基本面财务报表时使用此工具。Use this tool whenever the user asks for "
        "financial reports, financial statements, earnings report data, income statement, "
        "balance sheet, cash flow statement, revenue, net profit, assets, liabilities, "
        "operating cash flow, annual reports, quarterly reports, or 三大财务报表/利润表/"
        "资产负债表/现金流量表. Returns normalized Longbridge financial statement data "
        "for a security symbol."
    )
    params: dict = {
        "type": "object",
        "properties": {
            "symbol": {
                "type": "string",
                "description": (
                    "Longbridge security symbol, e.g. AAPL.US, TSLA.US, BABA.US, 700.HK. "
                    "When the user names a well-known company and the market is obvious, "
                    "convert it to the symbol before calling this tool; otherwise ask for clarification."
                ),
            },
            "kind": {
                "type": "string",
                "description": (
                    "财报类型/report kind. Use All for a complete financial report; "
                    "IncomeStatement/IS for 利润表, BalanceSheet/BS for 资产负债表, "
                    "CashFlow/CF for 现金流量表."
                ),
                "default": "All",
            },
            "period": {
                "type": "string",
                "description": (
                    "Optional report period. Annual/FY for 年报, SemiAnnual for 半年报, "
                    "Q1/Q2/Q3 for quarterly periods, ThreeQ for 三季报, QuarterlyFull for 季报."
                ),
            },
        },
        "required": ["symbol"],
    }

    def __init__(self, settings: Any = None):
        self.settings = settings

    def execute(self, args: Dict[str, Any]) -> ToolResult:
        symbol = str(args.get("symbol", "")).strip()
        kind = str(args.get("kind") or "All")
        period_value = args.get("period")
        period = str(period_value).strip() if period_value else None
        try:
            data = FundamentalService().get_financial_reports(
                symbol=symbol,
                kind=kind,
                period=period,
                settings=self.settings,
            )
        except (ValueError, LongbridgeUnavailableError) as exc:
            return ToolResult.fail(str(exc))
        return ToolResult.success(data)
