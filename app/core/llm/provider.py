"""OpenAI 兼容 LLM 提供商

基于 httpx 实现，支持所有兼容 OpenAI Chat Completions API 的模型服务：
- OpenAI (GPT-4, GPT-3.5)
- DeepSeek
- Qwen (通义千问)
- 其他 OpenAI 兼容接口

支持同步调用（call）和流式调用（call_stream），
以及 function calling（工具调用）。
"""

import json
import logging
from typing import Any, Dict, Generator, List, Optional, Tuple

import httpx

from app.core.agent.models import LLMModel, LLMRequest

logger = logging.getLogger("stocks-assistant.llm")


class OpenAICompatibleProvider(LLMModel):
    """OpenAI 兼容 LLM 提供商

    通过 OpenAI Chat Completions API 与大语言模型交互，
    支持流式输出和 function calling。
    """

    def __init__(
        self,
        api_key: str,
        api_base: str = "https://api.openai.com/v1",
        model: str = "gpt-4o",
        timeout: int = 180,
    ):
        super().__init__(model=model)
        self.api_key = api_key  # API 密钥
        self.api_base = api_base.rstrip("/")  # API 基础地址
        self.timeout = timeout  # 请求超时（秒）
        self.client = httpx.Client(timeout=timeout)

    def call(self, request: LLMRequest) -> dict:
        """同步调用 LLM，返回完整响应"""
        payload = self._build_payload(request, stream=False)
        headers = self._headers()
        url = f"{self.api_base}/chat/completions"
        resp = self.client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        return resp.json()

    def call_stream(self, request: LLMRequest) -> Generator[dict, None, None]:
        """流式调用 LLM，逐 chunk 返回 SSE 数据"""
        payload = self._build_payload(request, stream=True)
        headers = self._headers()
        url = f"{self.api_base}/chat/completions"

        with self.client.stream("POST", url, json=payload, headers=headers) as resp:
            resp.raise_for_status()
            for line in resp.iter_lines():
                if not line or not line.startswith("data: "):
                    continue
                data = line[6:]
                if data.strip() == "[DONE]":  # 流结束标记
                    break
                try:
                    chunk = json.loads(data)
                    yield chunk
                except json.JSONDecodeError:
                    continue

    def _build_payload(self, request: LLMRequest, stream: bool = False) -> dict:
        """构建 API 请求体

        将 LLMRequest 转换为 OpenAI Chat Completions API 格式：
        - system 提示词作为第一条 system 消息
        - tools 转换为 function calling 格式
        - 消息从 Claude 内容块格式转换为 OpenAI 格式
        """
        messages = []
        if request.system:
            messages.append({"role": "system", "content": request.system})
        messages.extend(self._convert_messages_to_openai(request.messages))

        payload: Dict[str, Any] = {
            "model": request.model or self.model,
            "messages": messages,
            "temperature": request.temperature,
            "stream": stream,
        }
        if request.max_tokens:
            payload["max_tokens"] = request.max_tokens
        if request.tools:
            payload["tools"] = [
                {"type": "function", "function": t} for t in request.tools
            ]
        return payload

    def _convert_messages_to_openai(self, messages: List[dict]) -> List[dict]:
        """将 Claude 风格的消息转换为 OpenAI 格式

        转换规则：
        - content 为字符串：直接使用
        - content 为列表：
          - text 块 -> 提取文本
          - thinking 块 -> 丢弃（OpenAI 不支持）
          - tool_use 块 -> 转为 assistant.tool_calls
          - tool_result 块 -> 转为 role:"tool" 消息
        """
        openai_messages = []

        for msg in messages:
            role = msg.get("role")
            content = msg.get("content")

            if isinstance(content, str):
                openai_messages.append({"role": role, "content": content})
                continue

            if not isinstance(content, list):
                openai_messages.append({"role": role, "content": content})
                continue

            text_parts = []
            tool_uses = []
            tool_results = []

            for block in content:
                if not isinstance(block, dict):
                    continue
                block_type = block.get("type")
                if block_type == "text":
                    text_parts.append(block.get("text", ""))
                elif block_type == "tool_use":
                    tool_uses.append(block)
                elif block_type == "tool_result":
                    tool_results.append(block)
                # thinking 块忽略

            if role == "assistant":
                assistant_msg = {
                    "role": "assistant",
                    "content": "\n".join(text_parts) if text_parts else None,
                }
                if tool_uses:
                    assistant_msg["tool_calls"] = [
                        {
                            "id": tu.get("id", ""),
                            "type": "function",
                            "function": {
                                "name": tu.get("name", ""),
                                "arguments": json.dumps(tu.get("input", {}), ensure_ascii=False),
                            },
                        }
                        for tu in tool_uses
                    ]
                openai_messages.append(assistant_msg)

            elif role == "user":
                if tool_results:
                    for tr in tool_results:
                        openai_messages.append({
                            "role": "tool",
                            "tool_call_id": tr.get("tool_use_id", ""),
                            "content": tr.get("content", ""),
                        })
                if text_parts:
                    openai_messages.append({
                        "role": "user",
                        "content": "\n".join(text_parts),
                    })
            else:
                text = "\n".join(text_parts) if text_parts else ""
                openai_messages.append({"role": role, "content": text})

        return openai_messages

    def _headers(self) -> dict:
        """构建 API 请求头"""
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }
