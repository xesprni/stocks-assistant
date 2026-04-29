"""文件读取工具

从工作空间中读取指定文件的内容，支持行号范围和路径安全检查。
"""

from pathlib import Path
from typing import Any, Dict, Optional

from app.core.tools.base_tool import BaseTool, ToolResult

import logging

logger = logging.getLogger("stocks-assistant.tools.read_file")


class ReadFileTool(BaseTool):
    name: str = "read_file"
    description: str = "Read file content from workspace. Returns content with line numbers."
    params: dict = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "File path relative to workspace"},
            "start_line": {"type": "integer", "description": "Start line (default: 1)"},
            "num_lines": {"type": "integer", "description": "Number of lines to read (default: all)"},
        },
        "required": ["path"],
    }

    def __init__(self, workspace_dir: str = ".", config: dict = None):
        super().__init__()
        self.config = config or {}
        self.workspace_dir = Path(workspace_dir).resolve()

    def execute(self, args: Dict[str, Any]) -> ToolResult:
        path = args.get("path", "").strip()
        if not path:
            return ToolResult.fail("Error: path is required")
        start_line = args.get("start_line", 1)
        num_lines = args.get("num_lines")
        file_path = (self.workspace_dir / path).resolve()
        if not str(file_path).startswith(str(self.workspace_dir)):
            return ToolResult.fail("Error: path outside workspace")
        if not file_path.exists():
            return ToolResult.fail(f"Error: file not found: {path}")
        try:
            content = file_path.read_text(encoding="utf-8")
            lines = content.split('\n')
            start_idx = max(0, start_line - 1)
            selected = lines[start_idx:start_idx + num_lines] if num_lines else lines[start_idx:]
            result = "\n".join(f"{start_idx + i + 1}: {line}" for i, line in enumerate(selected))
            return ToolResult.success(f"File: {path} (lines {start_idx + 1}-{start_idx + len(selected)} of {len(lines)})\n\n{result}")
        except Exception as e:
            return ToolResult.fail(f"Error reading file: {e}")
