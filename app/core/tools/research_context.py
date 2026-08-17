"""读取当前用户的公司研究上下文。"""

from typing import Any, Optional

from app.core.tools.base_tool import BaseTool, ToolResult
from app.core.tools.evidence import evidence_for_source, evidence_metadata, source_reference


class GetResearchContextTool(BaseTool):
    name = "get_research_context"
    description = "Read a symbol's current Thesis, saved evidence, decisions, documents, position context, and alert counts."
    params = {"type": "object", "properties": {"symbol": {"type": "string"}}, "required": ["symbol"]}

    def __init__(self, *, research_service=None, user_id: Optional[str] = None):
        self.research_service = research_service
        self.user_id = user_id

    def execute(self, args: dict[str, Any]) -> ToolResult:
        symbol = str(args.get("symbol") or "").strip().upper()
        if not symbol:
            return ToolResult.fail("Error: symbol is required")
        try:
            if self.research_service is None:
                from app.deps import get_research_service

                self.research_service = get_research_service()
            summary = self.research_service.security_summary(self.user_id or "", symbol)
            summary["evidence"] = self.research_service.list_evidence(self.user_id or "", symbol)
            summary["documents_list"] = self.research_service.list_documents(self.user_id or "", symbol)
            source = source_reference(
                source_type="local_research_workspace", provider="Stocks Assistant Research",
                title=f"{symbol} research workspace", symbol=symbol, locator="latest Thesis, evidence, decisions, documents and alerts",
            )
            return ToolResult.success(summary, ext_data=evidence_metadata([evidence_for_source(source)]))
        except Exception as exc:
            return ToolResult.fail(f"Failed to read research context: {exc}")
