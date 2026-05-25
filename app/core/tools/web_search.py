"""网页搜索工具

通过 HTTP API 执行网页搜索，返回搜索结果摘要。
使用 SEARCH_API_KEY 环境变量配置 API 密钥。
"""

import os
from typing import Any, Dict, Optional

import httpx

from app.core.tools.base_tool import BaseTool, ToolResult

import logging

logger = logging.getLogger("stocks-assistant.tools.web_search")


class WebSearchTool(BaseTool):
    name: str = "web_search"
    description: str = "Search the web for real-time information. Returns titles, URLs, and snippets."
    params: dict = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Search query string"},
            "count": {"type": "integer", "description": "Number of results (1-50, default: 10)"},
        },
        "required": ["query"],
    }

    def __init__(self, config: dict = None):
        super().__init__()
        self.config = config or {}

    def execute(self, args: Dict[str, Any]) -> ToolResult:
        query = args.get("query", "").strip()
        if not query:
            return ToolResult.fail("Error: query is required")
        count = min(max(args.get("count", 10), 1), 50)
        api_url = os.environ.get("SEARCH_API_URL", "https://api.bocha.cn/v1/web-search")
        api_key = os.environ.get("SEARCH_API_KEY") or os.environ.get("BOCHA_API_KEY", "")
        if not api_key:
            return ToolResult.fail("Error: No SEARCH_API_KEY or BOCHA_API_KEY configured")
        try:
            resp = httpx.post(
                api_url,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"query": query, "count": count},
                timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()
            pages = data.get("data", {}).get("webPages", {}).get("value", [])
            results = [
                {"title": p.get("name", ""), "url": p.get("url", ""), "snippet": p.get("snippet", "")}
                for p in pages
            ]
            return ToolResult.success({"query": query, "count": len(results), "results": results})
        except httpx.HTTPStatusError as e:
            return ToolResult.fail(f"Search API error: HTTP {e.response.status_code}")
        except Exception as e:
            return ToolResult.fail(f"Search failed: {e}")
