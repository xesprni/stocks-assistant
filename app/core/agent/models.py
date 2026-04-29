"""LLM 请求与模型基础定义

LLMRequest 封装了发送给大语言模型的请求参数，
LLMModel 定义了模型调用接口（call / call_stream）。
"""

from typing import Any, Dict, List, Optional


class LLMRequest:
    """LLM 请求参数

    封装发送给大语言模型的所有参数，包括消息列表、温度、工具定义等。
    """

    def __init__(
        self,
        messages: List[Dict[str, str]] = None,
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        stream: bool = False,
        tools: Optional[List] = None,
        system: Optional[str] = None,
        **kwargs,
    ):
        self.messages = messages or []  # 对话消息列表
        self.model = model  # 模型名称（为空时使用默认）
        self.temperature = temperature  # 生成温度（0=确定性，1=随机性）
        self.max_tokens = max_tokens  # 最大生成 token 数
        self.stream = stream  # 是否启用流式输出
        self.tools = tools  # 可用工具定义（OpenAI function calling 格式）
        self.system = system  # 系统提示词（独立于 messages 传递）
        for key, value in kwargs.items():
            setattr(self, key, value)


class LLMModel:
    """LLM 模型抽象基类

    子类需实现 call()（同步调用）和 call_stream()（流式调用）。
    """

    def __init__(self, model: str = None, **kwargs):
        self.model = model  # 模型标识符
        self.config = kwargs  # 额外配置

    def call(self, request: LLMRequest):
        """同步调用 LLM，返回完整响应"""
        raise NotImplementedError

    def call_stream(self, request: LLMRequest):
        """流式调用 LLM，返回 chunk 生成器"""
        raise NotImplementedError
