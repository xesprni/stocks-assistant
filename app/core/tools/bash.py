"""Bash 命令执行工具

允许 Agent 执行 shell 命令，带有安全限制和输出截断。
"""
import os
import subprocess
from typing import Any, Dict

from app.core.tools.base_tool import BaseTool, ToolResult

import logging

logger = logging.getLogger("stocks-assistant.tools.bash")

MAX_LINES = 500
MAX_BYTES = 30 * 1024


class BashTool(BaseTool):
    name: str = "bash"
    description: str = "Execute a bash command. Returns stdout/stderr. Output truncated to last 500 lines or 30KB."
    params: dict = {
        "type": "object",
        "properties": {
            "command": {"type": "string", "description": "Bash command to execute"},
            "timeout": {"type": "integer", "description": "Timeout in seconds (default: 30)"},
        },
        "required": ["command"],
    }

    def __init__(self, config: dict = None):
        super().__init__()
        self.config = config or {}
        self.cwd = self.config.get("cwd", os.getcwd())
        self.default_timeout = self.config.get("timeout", 30)

    def execute(self, args: Dict[str, Any]) -> ToolResult:
        command = args.get("command", "").strip()
        timeout = args.get("timeout", self.default_timeout)
        if not command:
            return ToolResult.fail("Error: command is required")
        dangerous = ["rm -rf /", "rm -rf /*", "shutdown", "reboot", "mkfs", "dd if=/dev/zero"]
        if any(p in command.lower() for p in dangerous):
            return ToolResult.fail("Safety: command blocked")
        try:
            result = subprocess.run(
                command, shell=True, cwd=self.cwd,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                text=True, encoding="utf-8", errors="replace", timeout=timeout,
            )
            output = result.stdout
            if result.stderr:
                output += ("\n" + result.stderr) if result.stdout else result.stderr
            lines = output.split('\n')
            if len(lines) > MAX_LINES:
                lines = lines[-MAX_LINES:]
                output = '\n'.join(lines) + f"\n\n[Truncated: showing last {MAX_LINES} lines]"
            total_bytes = len(output.encode('utf-8'))
            if total_bytes > MAX_BYTES:
                output = output[-MAX_BYTES:] + f"\n\n[Truncated to {MAX_BYTES} bytes]"
            if result.returncode != 0:
                return ToolResult.fail({"output": output, "exit_code": result.returncode})
            return ToolResult.success({"output": output, "exit_code": result.returncode})
        except subprocess.TimeoutExpired:
            return ToolResult.fail(f"Command timed out after {timeout}s")
        except Exception as e:
            return ToolResult.fail(f"Error: {e}")
