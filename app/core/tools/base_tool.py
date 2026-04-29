"""工具基类定义

所有工具必须继承 BaseTool 并实现 execute() 方法。
工具分为两个阶段：
- PRE_PROCESS: 可被 LLM 主动调用的工具（大多数工具）
- POST_PROCESS: 在 Agent 执行完成后自动运行的工具
"""
from enum import Enum
from typing import Any, Optional

import logging

logger = logging.getLogger("stocks-assistant.tools")


class ToolStage(Enum):
    PRE_PROCESS = "pre_process"
    POST_PROCESS = "post_process"


class ToolResult:
    def __init__(self, status: str = None, result: Any = None, ext_data: Any = None):
        self.status = status
        self.result = result
        self.ext_data = ext_data

    @staticmethod
    def success(result, ext_data: Any = None):
        return ToolResult(status="success", result=result, ext_data=ext_data)

    @staticmethod
    def fail(result, ext_data: Any = None):
        return ToolResult(status="error", result=result, ext_data=ext_data)


class BaseTool:
    stage = ToolStage.PRE_PROCESS
    name: str = "base_tool"
    description: str = "Base tool"
    params: dict = {}
    model: Optional[Any] = None

    @classmethod
    def get_json_schema(cls) -> dict:
        return {"name": cls.name, "description": cls.description, "parameters": cls.params}

    def execute_tool(self, params: dict) -> ToolResult:
        try:
            return self.execute(params)
        except Exception as e:
            logger.error(f"Tool {self.name} error: {e}")
            return ToolResult.fail(str(e))

    def execute(self, params: dict) -> ToolResult:
        raise NotImplementedError

    def close(self):
        pass
