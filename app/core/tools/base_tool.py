"""工具基类定义

所有工具必须继承 BaseTool 并实现 execute() 方法。
工具分为两个阶段：
- PRE_PROCESS: 可被 LLM 主动调用的工具（大多数工具）
- POST_PROCESS: 在 Agent 执行完成后自动运行的工具
"""

import logging
from enum import Enum
from typing import Any

from app.core.tools.call_context import AgentCancelledError, ToolCallContext, bind_legacy_tool

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
    model: Any | None = None
    read_only = False

    def is_read_only(self, params: dict[str, Any]) -> bool:
        """未知工具默认构成屏障；混合读写工具按本次 action 声明能力。"""
        return self.read_only

    @classmethod
    def get_json_schema(cls) -> dict:
        return {"name": cls.name, "description": cls.description, "parameters": cls.params}

    def execute_tool(self, params: dict, context: ToolCallContext | None = None) -> ToolResult:
        try:
            context = context if context is not None else ToolCallContext.from_legacy_tool(self)
            context.raise_if_cancelled()
            return self.invoke(params, context)
        except AgentCancelledError:
            # 取消是运行生命周期信号，不能转换成可继续执行的普通工具错误。
            raise
        except Exception as e:
            logger.error("Tool %s error: %s", self.name, e)
            return ToolResult.fail(str(e))

    def invoke(self, params: dict, context: ToolCallContext) -> ToolResult:
        """新工具可覆盖此入口；旧 execute(params) 通过单向适配保持兼容。"""
        return bind_legacy_tool(self, context).execute(params)

    def execute(self, params: dict) -> ToolResult:
        raise NotImplementedError

    def close(self):
        pass
