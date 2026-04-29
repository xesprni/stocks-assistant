"""文件写入工具

向工作空间中写入或创建文件，带有路径安全检查。
"""

from pathlib import Path
from typing import Any, Dict, Optional

from app.core.tools.base_tool import BaseTool, ToolResult

import logging

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

    def execute(self, args: Dict[str, Any]) -> ToolResult:
        path = args.get("path", "").strip()
        content = args.get("content", "")
        if not path:
            return ToolResult.fail("Error: path is required")
        file_path = (self.workspace_dir / path).resolve()
        if not str(file_path).startswith(str(self.workspace_dir)):
            return ToolResult.fail("Error: path outside workspace")
        try:
            file_path.parent.mkdir(parents=True, exist_ok=True)
            file_path.write_text(content, encoding="utf-8")
            return ToolResult.success(f"Written {len(content)} chars to {path}")
        except Exception as e:
            return ToolResult.fail(f"Error writing file: {e}")
