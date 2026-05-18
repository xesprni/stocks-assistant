"""记忆搜索工具

搜索 Agent 的长期记忆（语义搜索 + 关键词搜索混合）。
支持从 Agent 上下文自动获取 MemoryManager 实例。
"""

import asyncio
import concurrent.futures
from typing import Optional

from app.core.tools.base_tool import BaseTool, ToolResult

import logging

logger = logging.getLogger("stocks-assistant.tools.memory_search")

_pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)


class MemorySearchTool(BaseTool):
    name: str = "memory_search"
    description: str = "Search agent's long-term memory using semantic and keyword search."
    params: dict = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Search query"},
            "max_results": {"type": "integer", "description": "Max results (default: 10)", "default": 10},
            "min_score": {"type": "number", "description": "Min score 0-1 (default: 0.1)", "default": 0.1},
        },
        "required": ["query"],
    }

    def __init__(self, memory_manager=None, user_id: Optional[str] = None):
        super().__init__()
        self.memory_manager = memory_manager
        self.user_id = user_id

    def _get_memory_manager(self):
        if self.memory_manager:
            return self.memory_manager
        # Try to get from agent context
        ctx = getattr(self, 'context', None)
        if ctx and hasattr(ctx, 'memory_manager'):
            return ctx.memory_manager
        return None

    def execute(self, args: dict) -> ToolResult:
        mgr = self._get_memory_manager()
        if not mgr:
            return ToolResult.fail("Memory not initialized")
        query = args.get("query")
        if not query:
            return ToolResult.fail("Error: query is required")
        try:
            loop = _get_or_create_loop()
            results = loop.run_until_complete(mgr.search(
                query=query, user_id=self.user_id,
                max_results=args.get("max_results", 10),
                min_score=args.get("min_score", 0.1),
                include_shared=True,
            ))
            if not results:
                return ToolResult.success(f"No memories found for '{query}'")
            output = [f"Found {len(results)} memories:\n"]
            for i, r in enumerate(results, 1):
                output.append(f"\n{i}. {r.path} (lines {r.start_line}-{r.end_line})")
                output.append(f"   Score: {r.score:.3f}")
                output.append(f"   Snippet: {r.snippet}")
            return ToolResult.success("\n".join(output))
        except Exception as e:
            return ToolResult.fail(f"Error searching memory: {e}")


def _get_or_create_loop():
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import threading
            result = [None]
            exc = [None]

            def run():
                new_loop = asyncio.new_event_loop()
                try:
                    result[0] = new_loop.run_until_complete(asyncio.sleep(0))
                except Exception as e:
                    exc[0] = e
                finally:
                    new_loop.close()

            return asyncio.new_event_loop()
        return loop
    except RuntimeError:
        return asyncio.new_event_loop()
