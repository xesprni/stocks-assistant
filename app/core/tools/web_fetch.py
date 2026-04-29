"""网页抓取工具

抓取指定 URL 的网页内容，提取纯文本供 Agent 分析。
"""
import re
from typing import Any, Dict
from urllib.parse import urlparse

import httpx

from app.core.tools.base_tool import BaseTool, ToolResult

import logging

logger = logging.getLogger("stocks-assistant.tools.web_fetch")


class WebFetchTool(BaseTool):
    name: str = "web_fetch"
    description: str = "Fetch content from a URL. Extracts readable text from HTML pages."
    params: dict = {
        "type": "object",
        "properties": {"url": {"type": "string", "description": "HTTP/HTTPS URL to fetch"}},
        "required": ["url"],
    }

    def __init__(self, config: dict = None):
        super().__init__()
        self.config = config or {}

    def execute(self, args: Dict[str, Any]) -> ToolResult:
        url = args.get("url", "").strip()
        if not url:
            return ToolResult.fail("Error: url is required")
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return ToolResult.fail("Error: URL must start with http:// or https://")
        try:
            resp = httpx.get(url, headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
            }, timeout=30, follow_redirects=True)
            resp.raise_for_status()
            html = resp.text
            title = self._extract_title(html)
            text = self._extract_text(html)
            return ToolResult.success(f"Title: {title}\n\nContent:\n{text}")
        except httpx.TimeoutException:
            return ToolResult.fail("Error: Request timed out")
        except httpx.HTTPStatusError as e:
            return ToolResult.fail(f"Error: HTTP {e.response.status_code}")
        except Exception as e:
            return ToolResult.fail(f"Error: {e}")

    @staticmethod
    def _extract_title(html: str) -> str:
        m = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
        return m.group(1).strip() if m else "Untitled"

    @staticmethod
    def _extract_text(html: str) -> str:
        text = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.IGNORECASE | re.DOTALL)
        text = re.sub(r"<style[^>]*>.*?</style>", "", text, flags=re.IGNORECASE | re.DOTALL)
        text = re.sub(r"<[^>]+>", "", text)
        for old, new in [("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"'), ("&nbsp;", " ")]:
            text = text.replace(old, new)
        text = re.sub(r"[^\S\n]+", " ", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        return "\n".join(line.strip() for line in text.splitlines()).strip()
