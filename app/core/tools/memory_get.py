"""记忆文件读取工具

读取工作空间中的记忆文件（MEMORY.md、memory/、knowledge/ 目录下的 Markdown 文件）。
"""

from pathlib import Path
from typing import Optional

from app.core.tools.base_tool import BaseTool, ToolResult


class MemoryGetTool(BaseTool):
    name: str = "memory_get"
    description: str = "Read content from memory or knowledge files."
    params: dict = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Relative path (e.g. 'MEMORY.md', 'memory/2026-01-01.md')"},
            "start_line": {"type": "integer", "description": "Start line (default: 1)", "default": 1},
            "num_lines": {"type": "integer", "description": "Number of lines to read"},
        },
        "required": ["path"],
    }

    def __init__(self, memory_manager=None, user_id: Optional[str] = None):
        super().__init__()
        self.memory_manager = memory_manager
        self.user_id = user_id

    def _get_memory_manager(self):
        if self.memory_manager:
            return self.memory_manager
        ctx = getattr(self, 'context', None)
        if ctx and hasattr(ctx, 'memory_manager'):
            return ctx.memory_manager
        return None

    def execute(self, args: dict) -> ToolResult:
        mgr = self._get_memory_manager()
        if not mgr:
            return ToolResult.fail("Memory not initialized")
        path = args.get("path")
        if not path:
            return ToolResult.fail("Error: path is required")
        try:
            workspace_dir = mgr.config.get_workspace()
            if not path.startswith('memory/') and not path.startswith('knowledge/') and path != 'MEMORY.md':
                path = f'memory/{path}'
            from pathlib import Path
            file_path = (workspace_dir / path).resolve()
            if not str(file_path).startswith(str(workspace_dir.resolve())):
                return ToolResult.fail("Error: path outside workspace")
            if not file_path.exists():
                return ToolResult.fail(f"Error: file not found: {path}")
            content = file_path.read_text(encoding='utf-8')
            lines = content.split('\n')
            start_line = max(1, args.get("start_line", 1))
            start_idx = start_line - 1
            num_lines = args.get("num_lines")
            selected = lines[start_idx:start_idx + num_lines] if num_lines else lines[start_idx:]
            output = f"File: {path}\nLines: {start_line}-{start_line + len(selected) - 1} (total: {len(lines)})\n\n" + '\n'.join(selected)
            return ToolResult.success(output)
        except Exception as e:
            return ToolResult.fail(f"Error reading memory file: {e}")
