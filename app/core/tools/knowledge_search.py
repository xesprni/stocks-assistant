"""搜索当前用户的个人知识库。"""

import asyncio
from typing import Optional

from app.core.tools.base_tool import BaseTool, ToolResult
from app.core.tools.evidence import evidence_for_source, evidence_metadata, source_reference


class KnowledgeSearchTool(BaseTool):
    name = "knowledge_search"
    description = (
        "Search the current user's imported knowledge files using keyword and semantic search. "
        "Returns file paths, exact line ranges, excerpts, scores, and citation metadata."
    )
    params = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Focused query for the user's knowledge base."},
            "max_results": {"type": "integer", "minimum": 1, "maximum": 20, "default": 8},
            "min_score": {"type": "number", "minimum": 0, "maximum": 1, "default": 0.1},
        },
        "required": ["query"],
    }

    def __init__(self, memory_manager=None, user_id: Optional[str] = None):
        self.memory_manager = memory_manager
        self.user_id = user_id

    def execute(self, args: dict) -> ToolResult:
        query = str(args.get("query") or "").strip()
        if not query:
            return ToolResult.fail("Error: query is required")
        if not self.memory_manager:
            return ToolResult.fail("Knowledge index is not initialized")

        max_results = min(max(int(args.get("max_results", 8)), 1), 20)
        try:
            results = _run_async(
                self.memory_manager.search(
                    query=query,
                    user_id=self.user_id,
                    max_results=max(max_results * 5, 20),
                    min_score=float(args.get("min_score", 0.1)),
                    include_shared=self.user_id is None,
                )
            )
            knowledge_results = [item for item in results if item.source == "knowledge"][:max_results]
            payload = []
            evidence = []
            for item in knowledge_results:
                locator = f"lines {item.start_line}-{item.end_line}"
                source = source_reference(
                    source_type="user_knowledge",
                    provider="Stocks Assistant Knowledge",
                    title=item.path.rsplit("/", 1)[-1],
                    locator=locator,
                )
                evidence_item = evidence_for_source(
                    source,
                    excerpt=item.snippet,
                    data={"path": item.path, "start_line": item.start_line, "end_line": item.end_line},
                )
                evidence.append(evidence_item)
                payload.append(
                    {
                        "path": item.path,
                        "start_line": item.start_line,
                        "end_line": item.end_line,
                        "score": round(float(item.score), 4),
                        "excerpt": item.snippet,
                        "evidence_id": evidence_item.id,
                    }
                )
            return ToolResult.success(
                {"query": query, "count": len(payload), "results": payload},
                ext_data=evidence_metadata(evidence),
            )
        except Exception as exc:
            return ToolResult.fail(f"Error searching knowledge: {exc}")


def _run_async(awaitable):
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(awaitable)

    # 工具通常在线程池执行；如果调用线程已有事件循环，使用独立线程避免嵌套运行。
    import concurrent.futures

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(lambda: asyncio.run(awaitable)).result()

