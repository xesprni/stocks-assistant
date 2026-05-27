"""LLM providers backed by OpenAI-compatible HTTP APIs.

The default provider keeps the existing Chat Completions behavior for OpenAI
compatible gateways. The Responses provider is used for Codex/reasoning-style
models while adapting responses back to the chat-completion-shaped chunks the
agent executor already understands.
"""

import json
import logging
from typing import Any, Dict, Generator, List

import httpx

from app.core.agent.models import LLMModel, LLMRequest

logger = logging.getLogger("stocks-assistant.llm")


def _response_error_detail(resp: httpx.Response) -> str:
    """Extract a concise upstream API error message without exposing request secrets."""
    try:
        resp.read()
    except httpx.StreamConsumed:
        pass
    except Exception as exc:
        return f"{resp.reason_phrase} (failed to read error response: {type(exc).__name__})"

    try:
        body = resp.json()
    except Exception:
        try:
            text = resp.text.strip()
        except httpx.ResponseNotRead:
            return resp.reason_phrase
        return text[:2000] if text else resp.reason_phrase

    if isinstance(body, dict):
        error = body.get("error")
        if isinstance(error, dict):
            message = error.get("message") or error.get("detail") or error.get("code")
            if message:
                return str(message)[:2000]
        if isinstance(error, str):
            return error[:2000]
        for key in ("message", "detail", "msg"):
            if body.get(key):
                return str(body[key])[:2000]

    try:
        return json.dumps(body, ensure_ascii=False)[:2000]
    except Exception:
        return str(body)[:2000]


def _raise_for_llm_status(resp: httpx.Response, provider: str) -> None:
    if resp.is_success:
        return
    detail = _response_error_detail(resp)
    logger.warning(
        "%s upstream error status=%s url=%s detail=%s",
        provider,
        resp.status_code,
        resp.request.url,
        detail,
    )
    raise httpx.HTTPStatusError(
        f"{provider} upstream error {resp.status_code}: {detail}",
        request=resp.request,
        response=resp,
    )


def _normalize_tool_choice(value: Any) -> str | None:
    normalized = str(value or "").strip().lower()
    if normalized in {"auto", "none", "required"}:
        return normalized
    return None


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
        _raise_for_llm_status(resp, "Chat Completions")
        return resp.json()

    def call_stream(self, request: LLMRequest) -> Generator[dict, None, None]:
        """流式调用 LLM，逐 chunk 返回 SSE 数据"""
        payload = self._build_payload(request, stream=True)
        headers = self._headers()
        url = f"{self.api_base}/chat/completions"

        with self.client.stream("POST", url, json=payload, headers=headers) as resp:
            _raise_for_llm_status(resp, "Chat Completions")
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
            tool_choice = _normalize_tool_choice(getattr(request, "tool_choice", None))
            if tool_choice:
                payload["tool_choice"] = tool_choice
        if getattr(request, "thinking_enabled", False):
            payload["reasoning_effort"] = getattr(request, "reasoning_effort", None) or "medium"
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


class OpenAIResponsesProvider(LLMModel):
    """OpenAI Responses API provider for Codex and reasoning models.

    The rest of the agent stack consumes Chat Completions style deltas. This
    provider converts local Claude-style message blocks to Responses input items,
    then converts Responses output/function-call events back to that internal
    shape.
    """

    def __init__(
        self,
        api_key: str,
        api_base: str = "https://api.openai.com/v1",
        model: str = "gpt-5.2-codex",
        timeout: int = 180,
        extra_headers: Dict[str, str] | None = None,
        store_response: bool | None = None,
    ):
        super().__init__(model=model)
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.timeout = timeout
        self.extra_headers = extra_headers or {}
        self.store_response = store_response
        self.client = httpx.Client(timeout=timeout)

    def call(self, request: LLMRequest) -> dict:
        """Call the Responses API and return a Chat Completions shaped response."""
        payload = self._build_payload(request, stream=False)
        headers = self._headers()
        url = f"{self.api_base}/responses"
        resp = self.client.post(url, json=payload, headers=headers)
        _raise_for_llm_status(resp, "Responses")
        return self._adapt_response_to_chat(resp.json())

    def call_stream(self, request: LLMRequest) -> Generator[dict, None, None]:
        """Stream Responses API events as Chat Completions shaped chunks."""
        payload = self._build_payload(request, stream=True)
        headers = self._headers()
        url = f"{self.api_base}/responses"

        state: Dict[str, Any] = {"saw_function_call": False, "argument_buffers": {}}
        with self.client.stream("POST", url, json=payload, headers=headers) as resp:
            _raise_for_llm_status(resp, "Responses")
            for line in resp.iter_lines():
                if not line or not line.startswith("data: "):
                    continue
                data = line[6:]
                if data.strip() == "[DONE]":
                    break
                try:
                    event = json.loads(data)
                except json.JSONDecodeError:
                    continue
                for chunk in self._stream_event_to_chat_chunks(event, state):
                    yield chunk

    def _build_payload(self, request: LLMRequest, stream: bool = False) -> dict:
        payload: Dict[str, Any] = {
            "model": request.model or self.model,
            "input": self._convert_messages_to_responses(request.messages),
        }
        if self.store_response is not None:
            payload["store"] = self.store_response
        if request.system:
            payload["instructions"] = request.system
        if stream:
            payload["stream"] = True
        if request.max_tokens:
            payload["max_output_tokens"] = request.max_tokens
        if request.tools:
            payload["tools"] = [
                {
                    "type": "function",
                    "name": t.get("name", ""),
                    "description": t.get("description", ""),
                    "parameters": t.get("parameters", {}),
                }
                for t in request.tools
            ]
            payload["parallel_tool_calls"] = True
            tool_choice = _normalize_tool_choice(getattr(request, "tool_choice", None))
            if tool_choice:
                payload["tool_choice"] = tool_choice
        if getattr(request, "thinking_enabled", False):
            payload["reasoning"] = {
                "effort": getattr(request, "reasoning_effort", None) or "medium",
                "summary": "auto",
            }
        if request.temperature is not None and not self._model_prefers_default_temperature(request.model or self.model):
            payload["temperature"] = request.temperature
        return payload

    def _convert_messages_to_responses(self, messages: List[dict]) -> List[dict]:
        """Convert local message blocks to Responses API input items."""
        response_items: List[dict] = []

        for msg in messages:
            role = msg.get("role") or "user"
            content = msg.get("content")

            if isinstance(content, str):
                if content:
                    response_items.append(self._message_item(role, content))
                continue

            if not isinstance(content, list):
                if content:
                    response_items.append(self._message_item(role, str(content)))
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

            text = "\n".join(part for part in text_parts if part)
            if text:
                response_items.append(self._message_item(role, text))

            if role == "assistant":
                for tool_use in tool_uses:
                    call_id = tool_use.get("id") or tool_use.get("call_id") or ""
                    response_items.append({
                        "type": "function_call",
                        "call_id": call_id,
                        "name": tool_use.get("name", ""),
                        "arguments": json.dumps(tool_use.get("input", {}), ensure_ascii=False),
                        "status": "completed",
                    })

            if role == "user":
                for tool_result in tool_results:
                    response_items.append({
                        "type": "function_call_output",
                        "call_id": tool_result.get("tool_use_id", ""),
                        "output": tool_result.get("content", ""),
                    })

        return response_items

    def _message_item(self, role: str, text: str) -> dict:
        normalized_role = role if role in {"user", "assistant", "system", "developer"} else "user"
        content_type = "output_text" if normalized_role == "assistant" else "input_text"
        if normalized_role == "system":
            normalized_role = "developer"
        return {
            "type": "message",
            "role": normalized_role,
            "content": [{"type": content_type, "text": text}],
        }

    def _adapt_response_to_chat(self, response: dict) -> dict:
        text = self._extract_response_text(response)
        tool_calls = self._extract_response_tool_calls(response)
        message: Dict[str, Any] = {
            "role": "assistant",
            "content": text or None,
        }
        if tool_calls:
            message["tool_calls"] = tool_calls
        return {
            "id": response.get("id"),
            "object": "chat.completion",
            "model": response.get("model", self.model),
            "choices": [
                {
                    "index": 0,
                    "message": message,
                    "finish_reason": "tool_calls" if tool_calls else "stop",
                }
            ],
            "_raw_response": response,
        }

    def _extract_response_text(self, response: dict) -> str:
        output_text = response.get("output_text")
        if isinstance(output_text, str) and output_text:
            return output_text

        parts: List[str] = []
        for item in response.get("output") or []:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "message":
                content = item.get("content") or []
                for block in content:
                    if not isinstance(block, dict):
                        continue
                    if block.get("type") in {"output_text", "text"}:
                        text = block.get("text")
                        if text:
                            parts.append(str(text))
            elif item.get("type") in {"output_text", "text"} and item.get("text"):
                parts.append(str(item.get("text")))
        return "\n".join(parts)

    def _extract_response_tool_calls(self, response: dict) -> List[dict]:
        tool_calls = []
        for item in response.get("output") or []:
            if not isinstance(item, dict) or item.get("type") != "function_call":
                continue
            call_id = item.get("call_id") or item.get("id") or ""
            tool_calls.append({
                "id": call_id,
                "type": "function",
                "function": {
                    "name": item.get("name", ""),
                    "arguments": item.get("arguments", "") or "{}",
                },
            })
        return tool_calls

    def _stream_event_to_chat_chunks(self, event: dict, state: Dict[str, Any]) -> List[dict]:
        event_type = event.get("type")
        chunks: List[dict] = []

        if event_type == "response.output_text.delta":
            delta = event.get("delta") or ""
            if delta:
                chunks.append({"choices": [{"delta": {"content": delta}}]})
            return chunks

        if event_type in {"response.reasoning_text.delta", "response.reasoning_summary_text.delta"}:
            delta = event.get("delta") or ""
            if delta:
                chunks.append({"choices": [{"delta": {"reasoning_content": delta}}]})
            return chunks

        if event_type == "response.output_item.added":
            item = event.get("item") or {}
            if item.get("type") == "function_call":
                index = int(event.get("output_index") or 0)
                call_id = item.get("call_id") or item.get("id") or ""
                arguments = item.get("arguments") or ""
                state["saw_function_call"] = True
                state["argument_buffers"][index] = arguments
                chunks.append(self._tool_call_chunk(index, call_id, item.get("name", ""), arguments))
            return chunks

        if event_type == "response.function_call_arguments.delta":
            index = int(event.get("output_index") or 0)
            delta = event.get("delta") or ""
            state["saw_function_call"] = True
            state["argument_buffers"][index] = state["argument_buffers"].get(index, "") + delta
            if delta:
                chunks.append(self._tool_call_chunk(index, "", "", delta))
            return chunks

        if event_type == "response.function_call_arguments.done":
            index = int(event.get("output_index") or 0)
            item = event.get("item") or {}
            arguments = event.get("arguments") or item.get("arguments") or ""
            if arguments and not state["argument_buffers"].get(index):
                state["argument_buffers"][index] = arguments
                chunks.append(self._tool_call_chunk(
                    index,
                    item.get("call_id") or item.get("id") or "",
                    item.get("name", ""),
                    arguments,
                ))
            state["saw_function_call"] = True
            return chunks

        if event_type == "response.completed":
            finish_reason = "tool_calls" if state.get("saw_function_call") else "stop"
            chunks.append({"choices": [{"delta": {}, "finish_reason": finish_reason}]})
            return chunks

        if event_type in {"response.failed", "error"}:
            error = event.get("error") or event.get("response", {}).get("error") or {}
            message = error.get("message") if isinstance(error, dict) else str(error)
            chunks.append({"error": {"message": message or "Responses API call failed"}})

        return chunks

    def _tool_call_chunk(self, index: int, call_id: str, name: str, arguments: str) -> dict:
        function: Dict[str, str] = {}
        if name:
            function["name"] = name
        if arguments:
            function["arguments"] = arguments
        tool_call: Dict[str, Any] = {
            "index": index,
            "type": "function",
            "function": function,
        }
        if call_id:
            tool_call["id"] = call_id
        return {"choices": [{"delta": {"tool_calls": [tool_call]}}]}

    def _model_prefers_default_temperature(self, model: str) -> bool:
        normalized = (model or "").lower()
        return "codex" in normalized or normalized.startswith(("gpt-5", "o1", "o3", "o4"))

    def _headers(self) -> dict:
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }
        headers.update(self.extra_headers)
        return headers
