"""Agent 智能体核心类

Agent 是系统的核心组件，负责：
- 管理对话历史和上下文
- 协调 LLM 调用与工具执行
- 集成技能系统、记忆系统和工具系统
- 估算 token 消耗并进行上下文裁剪
"""

import json
import threading
from typing import Any, Dict, List, Optional

from app.core.agent.models import LLMRequest, LLMModel
from app.core.agent.executor import AgentStreamExecutor
from app.core.agent.result import AgentAction, AgentActionType, ToolResultData
from app.core.tools.base_tool import BaseTool, ToolStage

import logging

logger = logging.getLogger("stocks-assistant.agent")


class Agent:
    """AI 智能体

    通过多轮工具调用实现复杂任务的自动化执行。
    每轮循环：LLM 生成回复 -> 解析工具调用 -> 执行工具 -> 返回结果 -> 下一轮。
    """

    def __init__(
        self,
        system_prompt: str,
        model: LLMModel = None,
        tools: Optional[List[BaseTool]] = None,
        max_steps: int = 100,
        max_context_tokens: Optional[int] = None,
        max_context_turns: int = 30,
        memory_manager=None,
        workspace_dir: Optional[str] = None,
        skill_manager=None,
        enable_skills: bool = True,
    ):
        self.system_prompt = system_prompt  # 系统提示词
        self.model: LLMModel = model  # LLM 模型实例
        self.max_steps = max_steps  # 最大工具调用轮数
        self.max_context_tokens = max_context_tokens  # 上下文 token 上限
        self.max_context_turns = max_context_turns  # 上下文对话轮数上限
        self.captured_actions: List[AgentAction] = []  # 已捕获的动作记录
        self.messages: List[Dict] = []  # 对话消息历史
        self.messages_lock = threading.Lock()  # 消息列表线程锁
        self.memory_manager = memory_manager  # 记忆管理器
        self.workspace_dir = workspace_dir  # 工作空间目录
        self.enable_skills = enable_skills  # 是否启用技能

        # 技能管理器（从 Markdown 文件加载技能定义）
        self.skill_manager = None
        if enable_skills:
            self.skill_manager = skill_manager

        # 注册工具
        self.tools: List[BaseTool] = []
        if tools:
            for tool in tools:
                self.add_tool(tool)

    def add_tool(self, tool: BaseTool):
        """注册一个工具到 Agent"""
        tool.model = self.model
        self.tools.append(tool)

    def get_skills_prompt(self, skill_filter=None) -> str:
        """获取技能提示词（追加到系统提示词后）"""
        if not self.skill_manager:
            return ""
        try:
            return self.skill_manager.build_skills_prompt(skill_filter=skill_filter)
        except Exception as e:
            logger.warning(f"Failed to build skills prompt: {e}")
            return ""

    def get_full_system_prompt(self, skill_filter=None) -> str:
        """构建完整的系统提示词（基础提示词 + 技能提示词）"""
        parts = [self.system_prompt]
        skills_prompt = self.get_skills_prompt(skill_filter=skill_filter)
        if skills_prompt:
            parts.append(skills_prompt)
        return "\n\n".join(parts)

    def _get_model_context_window(self) -> int:
        """根据模型名称自动推断上下文窗口大小

        支持的模型：
        - Claude 3/3.5/3.7: 200K
        - GPT-4 Turbo: 128K
        - GPT-4: 8K-32K
        - DeepSeek: 64K
        - 默认: 128K
        """
        if self.model and hasattr(self.model, 'model'):
            model_name = self.model.model.lower()
            if 'claude-3' in model_name or 'claude-sonnet' in model_name:
                return 200000
            elif 'gpt-4' in model_name:
                if 'turbo' in model_name or '128k' in model_name:
                    return 128000
                elif '32k' in model_name:
                    return 32000
                else:
                    return 8000
            elif 'gpt-3.5' in model_name:
                return 16000 if '16k' in model_name else 4000
            elif 'deepseek' in model_name:
                return 64000
        return 128000  # 保守默认值

    def _get_context_reserve_tokens(self) -> int:
        """获取上下文预留 token 数（约 10%，用于模型生成回复）"""
        context_window = self._get_model_context_window()
        reserve = int(context_window * 0.1)
        return max(10000, min(200000, reserve))

    def _estimate_message_tokens(self, message: dict) -> int:
        """估算单条消息的 token 消耗

        按内容块类型分别计算：
        - text: 按 CJK 1.5 token/字符、ASCII 0.25 token/字符估算
        - image: 固定 1200 token
        - tool_use: 结构开销 50 + 输入参数 token
        - tool_result: 结构开销 30 + 结果内容 token
        """
        content = message.get('content', '')
        if isinstance(content, str):
            return max(1, self._estimate_text_tokens(content))
        elif isinstance(content, list):
            total_tokens = 0
            for part in content:
                if not isinstance(part, dict):
                    continue
                block_type = part.get('type', '')
                if block_type == 'text':
                    total_tokens += self._estimate_text_tokens(part.get('text', ''))
                elif block_type == 'image':
                    total_tokens += 1200
                elif block_type == 'tool_use':
                    total_tokens += 50  # 工具调用结构开销
                    input_data = part.get('input', {})
                    if isinstance(input_data, dict):
                        input_str = json.dumps(input_data, ensure_ascii=False)
                        total_tokens += self._estimate_text_tokens(input_str)
                elif block_type == 'tool_result':
                    total_tokens += 30  # 工具结果结构开销
                    result_content = part.get('content', '')
                    if isinstance(result_content, str):
                        total_tokens += self._estimate_text_tokens(result_content)
                else:
                    total_tokens += 10
            return max(1, total_tokens)
        return 1

    @staticmethod
    def _estimate_text_tokens(text: str) -> int:
        """估算文本的 token 数

        CJK 字符约 1.5 token/字符，ASCII 约 0.25 token/字符。
        """
        if not text:
            return 0
        non_ascii = sum(1 for c in text if ord(c) > 127)
        ascii_count = len(text) - non_ascii
        return int(non_ascii * 1.5 + ascii_count * 0.25) + 1

    def _find_tool(self, tool_name: str) -> Optional[BaseTool]:
        """按名称查找工具（仅返回可主动调用的 PRE_PROCESS 阶段工具）"""
        for tool in self.tools:
            if tool.name == tool_name:
                if tool.stage == ToolStage.PRE_PROCESS:
                    tool.model = self.model
                    return tool
                return None
        return None

    def capture_tool_use(self, tool_name, input_params, output, status, thought=None,
                         error_message=None, execution_time=0.0):
        """记录一次工具调用动作，用于追踪和调试"""
        tool_result = ToolResultData(
            tool_name=tool_name, input_params=input_params, output=output,
            status=status, error_message=error_message, execution_time=execution_time,
        )
        action = AgentAction(
            agent_id=str(id(self)), agent_name="Agent",
            action_type=AgentActionType.TOOL_USE, tool_result=tool_result, thought=thought,
        )
        self.captured_actions.append(action)
        return action

    def run_stream(self, user_message: str, on_event=None, clear_history: bool = False,
                   skill_filter=None) -> str:
        """执行一次流式对话

        完整流程：
        1. 可选清空历史记录
        2. 构建完整系统提示词（含技能）
        3. 复制消息历史，创建 AgentStreamExecutor
        4. 执行多轮工具调用循环
        5. 同步执行结果回 Agent 的消息列表

        Args:
            user_message: 用户消息
            on_event: 事件回调（用于 SSE 流式输出）
            clear_history: 是否清空历史记录
            skill_filter: 技能过滤列表

        Returns:
            Agent 最终回复文本
        """
        if clear_history:
            with self.messages_lock:
                self.messages = []

        if not self.model:
            raise ValueError("No model available for agent")

        full_system_prompt = self.get_full_system_prompt(skill_filter=skill_filter)

        # 复制消息列表，避免并发修改
        with self.messages_lock:
            messages_copy = self.messages.copy()
            original_length = len(self.messages)

        # 创建流式执行器
        executor = AgentStreamExecutor(
            agent=self,
            model=self.model,
            system_prompt=full_system_prompt,
            tools=self.tools,
            max_turns=self.max_steps,
            on_event=on_event,
            messages=messages_copy,
            max_context_turns=self.max_context_turns,
        )

        try:
            response = executor.run_stream(user_message)
        except Exception:
            # 如果执行器清空了消息（上下文溢出恢复），同步回 Agent
            if len(executor.messages) == 0:
                with self.messages_lock:
                    self.messages.clear()
            raise

        # 将执行器的消息列表同步回 Agent（可能已被裁剪）
        with self.messages_lock:
            self.messages = list(executor.messages)
            trim_adjusted_start = min(original_length, len(executor.messages))
            self._last_run_new_messages = list(executor.messages[trim_adjusted_start:])

        self.stream_executor = executor
        return response

    def clear_history(self):
        """清空对话历史和动作记录"""
        self.messages = []
        self.captured_actions = []
