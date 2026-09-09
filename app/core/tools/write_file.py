"""文件写入工具

向工作空间中写入或创建文件，带有路径安全检查。
"""

import logging
from pathlib import Path
from typing import Any

from app.core.tools.base_tool import BaseTool, ToolResult
from app.core.tools.paths import resolve_workspace_path

logger = logging.getLogger("stocks-assistant.tools.write_file")


class WriteFileTool(BaseTool):
    name: str = "write_file"
    description: str = "Write content to a file in the workspace."
    params: dict = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "File path relative to workspace"},
            "content": {"type": "string", "description": "Content to write"},
        },
        "required": ["path", "content"],
    }

    def __init__(self, workspace_dir: str = ".", config: dict = None):
        super().__init__()
        self.config = config or {}
        self.workspace_dir = Path(workspace_dir).resolve()

    def execute(self, args: dict[str, Any]) -> ToolResult:
        path = args.get("path", "").strip()
        content = args.get("content", "")
        if not path:
            return ToolResult.fail("Error: path is required")
        try:
            file_path = resolve_workspace_path(self.workspace_dir, path)
        except ValueError as exc:
            return ToolResult.fail(str(exc))
        try:
            file_path.parent.mkdir(parents=True, exist_ok=True)
            file_path.write_text(content, encoding="utf-8")
            return ToolResult.success(f"Written {len(content)} chars to {path}")
        except Exception as e:
            return ToolResult.fail(f"Error writing file: {e}")
