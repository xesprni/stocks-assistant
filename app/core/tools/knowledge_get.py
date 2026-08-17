"""读取 knowledge_search 返回的精确知识片段。"""

from pathlib import Path
from typing import Optional

from app.core.tools.base_tool import BaseTool, ToolResult
from app.core.tools.evidence import evidence_for_source, evidence_metadata, source_reference


class KnowledgeGetTool(BaseTool):
    name = "knowledge_get"
    description = (
        "Read exact cited lines from a current user's knowledge file. "
        "Use after knowledge_search to verify context before making a claim."
    )
    params = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Path returned by knowledge_search."},
            "start_line": {"type": "integer", "minimum": 1, "default": 1},
            "num_lines": {"type": "integer", "minimum": 1, "maximum": 500, "default": 80},
        },
        "required": ["path"],
    }

    def __init__(self, memory_manager=None, user_id: Optional[str] = None):
        self.memory_manager = memory_manager
        self.user_id = user_id

    def execute(self, args: dict) -> ToolResult:
        if not self.memory_manager:
            return ToolResult.fail("Knowledge index is not initialized")
        path = str(args.get("path") or "").strip().replace("\\", "/")
        if not path:
            return ToolResult.fail("Error: path is required")

        workspace = self.memory_manager.config.get_workspace().resolve()
        if self.user_id:
            allowed_prefix = f"users/{self.user_id}/knowledge/"
            if not path.startswith(allowed_prefix):
                # 允许 Agent 使用知识库相对路径，内部仍绑定当前用户目录。
                path = f"{allowed_prefix}{path.removeprefix('knowledge/').lstrip('/')}"
        elif not path.startswith("knowledge/"):
            path = f"knowledge/{path.lstrip('/')}"

        try:
            file_path = (workspace / path).resolve()
            allowed_root = (
                workspace / "users" / self.user_id / "knowledge"
                if self.user_id
                else workspace / "knowledge"
            ).resolve()
            if not file_path.is_relative_to(allowed_root):
                return ToolResult.fail("Error: knowledge path is outside the current user's knowledge base")
            if not file_path.is_file():
                return ToolResult.fail(f"Error: file not found: {path}")

            lines = file_path.read_text(encoding="utf-8").splitlines()
            start_line = max(int(args.get("start_line", 1)), 1)
            num_lines = min(max(int(args.get("num_lines", 80)), 1), 500)
            selected = lines[start_line - 1 : start_line - 1 + num_lines]
            end_line = start_line + len(selected) - 1
            excerpt = "\n".join(selected)
            source_url = _extract_source_url(lines)
            source = source_reference(
                source_type="user_knowledge",
                provider="Stocks Assistant Knowledge",
                title=Path(path).name,
                url=source_url,
                locator=f"lines {start_line}-{end_line}",
            )
            evidence = evidence_for_source(
                source,
                excerpt=excerpt[:2000],
                data={"path": path, "start_line": start_line, "end_line": end_line},
            )
            return ToolResult.success(
                {
                    "path": path,
                    "start_line": start_line,
                    "end_line": end_line,
                    "total_lines": len(lines),
                    "content": excerpt,
                    "source_url": source_url,
                    "evidence_id": evidence.id,
                },
                ext_data=evidence_metadata([evidence]),
            )
        except (OSError, UnicodeError, ValueError) as exc:
            return ToolResult.fail(f"Error reading knowledge file: {exc}")


def _extract_source_url(lines: list[str]) -> Optional[str]:
    for line in lines[:20]:
        if line.startswith("> Source:"):
            value = line.split(":", 1)[1].strip()
            return value or None
    return None

