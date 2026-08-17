"""Longbridge 新闻和公司研究数据工具。"""

from typing import Any

from app.core.tools.base_tool import BaseTool, ToolResult
from app.core.tools.evidence import (
    evidence_for_source,
    evidence_metadata,
    longbridge_evidence,
    source_reference,
)


def _linked_record_evidence(payload: Any, *, symbol: str, source_type: str) -> list:
    """从 Longbridge 记录中提取原文 URL；没有链接时由调用方回退到 API 文档来源。"""
    evidence = []

    def visit(value: Any) -> None:
        if len(evidence) >= 50:
            return
        if isinstance(value, list):
            for item in value:
                visit(item)
            return
        if not isinstance(value, dict):
            return
        url = str(value.get("url") or value.get("link") or value.get("source_url") or "").strip()
        if url.startswith(("http://", "https://")):
            title = str(value.get("title") or value.get("name") or url).strip()
            source = source_reference(
                source_type=source_type,
                provider="Longbridge OpenAPI",
                title=title,
                url=url,
                published_at=str(value.get("published_at") or "").strip() or None,
                as_of=str(value.get("as_of") or "").strip() or None,
                symbol=symbol,
            )
            evidence.append(
                evidence_for_source(
                    source,
                    excerpt=str(value.get("description") or value.get("summary") or "").strip()[:1000] or None,
                )
            )
        for item in value.values():
            if isinstance(item, (dict, list)):
                visit(item)

    visit(payload)
    return evidence


class GetSecurityNewsTool(BaseTool):
    name = "get_security_news"
    description = "Get recent Longbridge news for a stock symbol with source and timestamp metadata."
    params = {
        "type": "object",
        "properties": {
            "symbol": {"type": "string", "description": "Security symbol such as AAPL.US or 700.HK."},
            "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 20},
        },
        "required": ["symbol"],
    }

    def __init__(self, *, settings: Any = None, service: Any = None):
        self.settings = settings
        self.service = service

    def execute(self, args: dict[str, Any]) -> ToolResult:
        symbol = str(args.get("symbol") or "").strip().upper()
        if not symbol:
            return ToolResult.fail("Error: symbol is required")
        limit = min(max(int(args.get("limit") or 20), 1), 50)
        try:
            if self.service is None:
                from app.deps import get_news_service

                self.service = get_news_service()
            payload = self.service.get_security_news(symbol, limit=limit, settings=self.settings)
            evidence = _linked_record_evidence(payload, symbol=symbol, source_type="news")
            return ToolResult.success(
                payload,
                ext_data=evidence_metadata(evidence) if evidence else longbridge_evidence(
                    title=f"{symbol} recent news", data=payload, symbols=[symbol], source_type="news"
                ),
            )
        except Exception as exc:
            return ToolResult.fail(f"Failed to fetch security news: {exc}")


class GetSecurityInsightsTool(BaseTool):
    name = "get_security_insights"
    description = (
        "Get Longbridge filings, company profile, valuation, dividends, analyst ratings, "
        "and corporate actions for a stock symbol."
    )
    params = {
        "type": "object",
        "properties": {
            "symbol": {"type": "string", "description": "Security symbol such as AAPL.US or 700.HK."},
        },
        "required": ["symbol"],
    }

    def __init__(self, *, settings: Any = None, service: Any = None):
        self.settings = settings
        self.service = service

    def execute(self, args: dict[str, Any]) -> ToolResult:
        symbol = str(args.get("symbol") or "").strip().upper()
        if not symbol:
            return ToolResult.fail("Error: symbol is required")
        try:
            if self.service is None:
                from app.deps import get_fundamental_service

                self.service = get_fundamental_service()
            payload = self.service.get_security_insights(symbol, settings=self.settings)
            evidence = _linked_record_evidence(payload, symbol=symbol, source_type="company_research")
            return ToolResult.success(
                payload,
                ext_data=evidence_metadata(evidence) if evidence else longbridge_evidence(
                    title=f"{symbol} company research data", data=payload, symbols=[symbol], source_type="company_research"
                ),
            )
        except Exception as exc:
            return ToolResult.fail(f"Failed to fetch security insights: {exc}")
