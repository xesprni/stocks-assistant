"""Agent 执行结果与动作定义

定义了 Agent 执行过程中产生的各类数据结构：
- AgentActionType: 动作类型枚举（工具调用/思考/最终回答）
- ToolResultData: 工具执行结果
- AgentAction: Agent 动作记录
- AgentResult: Agent 执行最终结果
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class AgentActionType(Enum):
    """Agent 动作类型"""
    TOOL_USE = "tool_use"  # 调用工具
    THINKING = "thinking"  # 思考/推理
    FINAL_ANSWER = "final_answer"  # 最终回答


@dataclass
class ToolResultData:
    """工具执行结果数据

    记录工具调用的完整信息：输入参数、输出结果、执行状态和耗时。
    """
    tool_name: str  # 工具名称
    input_params: Dict[str, Any]  # 输入参数
    output: Any  # 输出结果
    status: str  # 执行状态（success/error）
    error_message: Optional[str] = None  # 错误信息
    execution_time: float = 0.0  # 执行耗时（秒）


@dataclass
class AgentAction:
    """Agent 动作记录

    记录 Agent 在执行过程中的每一个动作，用于追踪和调试。
    """
    agent_id: str  # Agent 实例标识
    agent_name: str  # Agent 名称
    action_type: AgentActionType  # 动作类型
    id: str = field(default_factory=lambda: str(uuid.uuid4()))  # 动作唯一 ID
    content: str = ""  # 动作内容文本
    tool_result: Optional[ToolResultData] = None  # 工具执行结果（仅 TOOL_USE 类型）
    thought: Optional[str] = None  # 思考内容（仅 THINKING 类型）
    timestamp: float = field(default_factory=time.time)  # 动作时间戳


@dataclass
class AgentResult:
    """Agent 执行最终结果"""
    final_answer: str  # 最终回答文本
    step_count: int  # 执行步骤数
    status: str = "success"  # 执行状态（success/error）
    error_message: Optional[str] = None  # 错误信息

    @classmethod
    def success(cls, final_answer: str, step_count: int) -> "AgentResult":
        """创建成功结果"""
        return cls(final_answer=final_answer, step_count=step_count)

    @classmethod
    def error(cls, error_message: str, step_count: int = 0) -> "AgentResult":
        """创建错误结果"""
        return cls(
            final_answer=f"Error: {error_message}",
            step_count=step_count,
            status="error",
            error_message=error_message,
        )

    @property
    def is_error(self) -> bool:
        """是否为错误结果"""
        return self.status == "error"
