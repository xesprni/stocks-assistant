"""Bash 命令执行工具

允许 Agent 执行 shell 命令，带有安全限制和输出截断。
"""

import logging
import math
import os
import signal
import subprocess
import time
from typing import Any

from app.core.tools.base_tool import BaseTool, ToolResult
from app.core.tools.call_context import AgentCancelledError, ToolCallContext

logger = logging.getLogger("stocks-assistant.tools.bash")

MAX_LINES = 500
MAX_BYTES = 30 * 1024


class BashTool(BaseTool):
    name: str = "bash"
    description: str = (
        "Execute a bash command. Returns stdout/stderr. Output truncated to last 500 lines or 30KB. "
        "Each call starts a new shell in the configured workspace: cd and environment changes "
        "do not persist between calls, but files saved in the workspace do. Save reusable "
        "artifacts there instead of temporary directories. "
        "For static chart/report images, follow image_rendering_policy and use render_image when "
        "available; do not default to Python/Matplotlib/Pillow or screenshot scripts, including "
        "scripts just to prepare the HTML. Data processing and calculations are still appropriate. "
        "A user-requested plotting script or different rendering workflow remains supported."
    )
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

    def execute(self, args: dict[str, Any]) -> ToolResult:
        return self.invoke(args, ToolCallContext.from_legacy_tool(self))

    def invoke(self, args: dict[str, Any], context: ToolCallContext) -> ToolResult:
        command = args.get("command", "").strip()
        try:
            timeout = float(args.get("timeout", self.default_timeout))
            if not math.isfinite(timeout) or timeout <= 0:
                raise ValueError
        except (TypeError, ValueError):
            return ToolResult.fail("Error: timeout must be a finite positive number")
        if not command:
            return ToolResult.fail("Error: command is required")
        dangerous = ["rm -rf /", "rm -rf /*", "shutdown", "reboot", "mkfs", "dd if=/dev/zero"]
        if any(p in command.lower() for p in dangerous):
            return ToolResult.fail("Safety: command blocked")
        process = None
        try:
            context.raise_if_cancelled()
            process = subprocess.Popen(
                command,
                shell=True,
                cwd=self.cwd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                start_new_session=os.name == "posix",
            )
            deadline = time.monotonic() + timeout
            while True:
                context.raise_if_cancelled()
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise subprocess.TimeoutExpired(command, timeout)
                try:
                    stdout, stderr = process.communicate(timeout=min(0.1, remaining))
                    break
                except subprocess.TimeoutExpired:
                    continue
            context.raise_if_cancelled()
            output = stdout
            if stderr:
                output += ("\n" + stderr) if stdout else stderr
            lines = output.split("\n")
            if len(lines) > MAX_LINES:
                lines = lines[-MAX_LINES:]
                output = "\n".join(lines) + f"\n\n[Truncated: showing last {MAX_LINES} lines]"
            total_bytes = len(output.encode("utf-8"))
            if total_bytes > MAX_BYTES:
                output = output[-MAX_BYTES:] + f"\n\n[Truncated to {MAX_BYTES} bytes]"
            if process.returncode != 0:
                return ToolResult.fail({"output": output, "exit_code": process.returncode})
            return ToolResult.success({"output": output, "exit_code": process.returncode})
        except AgentCancelledError:
            if process is not None:
                _stop_process_group(process)
            raise
        except subprocess.TimeoutExpired:
            if process is not None:
                _stop_process_group(process)
            return ToolResult.fail(f"Command timed out after {timeout}s")
        except Exception as e:
            return ToolResult.fail(f"Error: {e}")

        finally:
            if process is not None and process.poll() is None:
                _stop_process_group(process)


def _stop_process_group(process: subprocess.Popen[str]) -> None:
    """停止整个 shell 进程组，避免只杀 shell 后遗留继续写文件的子进程。"""
    try:
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGTERM)
        else:
            process.terminate()
    except ProcessLookupError:
        pass
    try:
        process.communicate(timeout=0.3)
    except subprocess.TimeoutExpired:
        pass
    finally:
        # shell 可能先退出但其子进程忽略 TERM；即便主进程已完成也回收整个组。
        try:
            if os.name == "posix":
                os.killpg(process.pid, signal.SIGKILL)
            elif process.poll() is None:
                process.kill()
        except ProcessLookupError:
            pass
        process.communicate()
