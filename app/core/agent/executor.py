"""Agent 流式执行器

基于工具调用的多轮推理引擎，核心执行循环：
1. LLM 生成回复（可能包含工具调用）
2. 解析并执行工具
3. 将工具结果返回给 LLM
4. 重复直到 LLM 不再调用工具或达到最大步数

还负责上下文管理：消息裁剪、token 估算、溢出恢复、工具失败重试保护。
"""

import copy as _copy
import hashlib
import json
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional, Tuple

from app.core.agent.models import LLMRequest
from app.core.agent.message_utils import sanitize_claude_messages, compress_turn_to_text_only
from app.core.tools.base_tool import BaseTool, ToolResult

import logging

logger = logging.getLogger("stocks-assistant.agent")

# 存入对话历史的推理内容最大字符数（过长会截断为头+尾）
MAX_STORED_REASONING_CHARS = 4 * 1024
_REASONING_TRUNCATE_MARKER = "\n\n... [reasoning truncated, {omitted} chars omitted] ...\n\n"

_CONTEXT_SUMMARY_SYSTEM_PROMPT = """你是一个对话压缩助手。请将对话历史压缩为简洁的要点摘要。

要求：
- 每条一行，用 "- " 开头
- 只保留关键信息：用户需求、重要决策、已完成的操作、待办事项
- 忽略闲聊和重复内容
- 保持精炼，控制在 300 字以内"""

_CONTEXT_SUMMARY_USER_PROMPT = """请压缩以下对话历史：

{conversation}"""


class AgentCancelledError(RuntimeError):
    """Raised when a streaming agent run is cancelled by the client."""


def _truncate_reasoning_for_storage(text: str) -> str:
    """截断过长的推理内容，保留首尾各 2K 字符"""
    if not text:
        return text
    if len(text) <= MAX_STORED_REASONING_CHARS:
        return text
    half = MAX_STORED_REASONING_CHARS // 2
    head = text[:half]
    tail = text[-half:]
    omitted = len(text) - len(head) - len(tail)
    return head + _REASONING_TRUNCATE_MARKER.format(omitted=omitted) + tail


class AgentStreamExecutor:
    """Agent 流式执行器

    处理 LLM 多轮工具调用的核心循环，包含：
    - 流式 LLM 调用与 SSE 事件发射
    - 工具执行与失败重试保护
    - 上下文裁剪（轮数限制 + token 限制）
    - 上下文溢出恢复（激进裁剪 + 清空历史）
    """

    def __init__(
        self,
        agent,
        model,
        system_prompt: str,
        tools: List[BaseTool],
        max_turns: int = 50,
        on_event=None,
        messages: Optional[List[Dict]] = None,
        max_context_turns: int = 30,
        cancel_event=None,
        thinking_enabled: bool = False,
    ):
        self.agent = agent
        self.model = model
        self.system_prompt = system_prompt
        self.tools = {tool.name: tool for tool in tools} if isinstance(tools, list) else tools
        self.max_turns = max_turns
        self.on_event = on_event
        self.max_context_turns = max_context_turns
        self.messages = messages if messages is not None else []
        self.cancel_event = cancel_event
        self.thinking_enabled = thinking_enabled
        self.tool_failure_history = []  # 工具执行历史（用于失败重试保护）

    def _raise_if_cancelled(self):
        if self.cancel_event is not None and self.cancel_event.is_set():
            raise AgentCancelledError("Agent run cancelled")

    def _runtime_llm_params(self) -> Dict[str, Any]:
        """读取当前用户的主 Agent LLM 运行参数。"""
        settings = getattr(self.agent, "settings", None)

        try:
            temperature = float(getattr(settings, "llm_temperature", 0.0))
        except (TypeError, ValueError):
            temperature = 0.0
        temperature = max(0.0, min(2.0, temperature))

        try:
            max_output_tokens = int(getattr(settings, "llm_max_output_tokens", 0) or 0)
        except (TypeError, ValueError):
            max_output_tokens = 0

        reasoning_effort = str(getattr(settings, "llm_reasoning_effort", "medium") or "medium").strip().lower()
        if reasoning_effort not in {"minimal", "low", "medium", "high"}:
            reasoning_effort = "medium"

        tool_choice = str(getattr(settings, "llm_tool_choice", "auto") or "auto").strip().lower()
        if tool_choice not in {"auto", "none", "required"}:
            tool_choice = "auto"

        return {
            "temperature": temperature,
            "max_tokens": max_output_tokens if max_output_tokens > 0 else None,
            "reasoning_effort": reasoning_effort,
            "tool_choice": tool_choice,
        }

    def _emit_event(self, event_type: str, data: dict = None):
        """发射事件到回调函数（用于 SSE 流式输出）"""
        if self.on_event:
            try:
                self.on_event({"type": event_type, "timestamp": time.time(), "data": data or {}})
            except Exception as e:
                logger.error("Event callback error: %s", e)

    def _hash_args(self, args: dict) -> str:
        """生成工具参数的哈希值（用于重复调用检测）"""
        args_str = json.dumps(args, sort_keys=True, ensure_ascii=False)
        return hashlib.md5(args_str.encode()).hexdigest()[:8]

    def _check_consecutive_failures(self, tool_name: str, args: dict) -> Tuple[bool, str, bool]:
        """检查工具是否存在连续失败或无限循环

        保护策略：
        - 相同参数连续调用 5 次 -> 停止
        - 相同参数连续失败 3 次 -> 停止
        - 同一工具连续失败 6 次 -> 停止
        - 同一工具连续失败 8 次 -> 终止整个对话

        Returns:
            (should_stop, reason, is_critical)
        """
        args_hash = self._hash_args(args)

        same_args_calls = 0
        for name, ahash, success in reversed(self.tool_failure_history):
            if name == tool_name and ahash == args_hash:
                same_args_calls += 1
            else:
                break
        if same_args_calls >= 5:
            return True, f"Tool '{tool_name}' called {same_args_calls} times with same args, stopping.", False

        same_args_failures = 0
        for name, ahash, success in reversed(self.tool_failure_history):
            if name == tool_name and ahash == args_hash:
                if not success:
                    same_args_failures += 1
                else:
                    break
            else:
                break
        if same_args_failures >= 3:
            return True, f"Tool '{tool_name}' failed {same_args_failures} times with same args, stopping.", False

        same_tool_failures = 0
        for name, ahash, success in reversed(self.tool_failure_history):
            if name == tool_name:
                if not success:
                    same_tool_failures += 1
                else:
                    break
            else:
                break
        if same_tool_failures >= 8:
            return True, "Too many consecutive failures, aborting.", True
        if same_tool_failures >= 6:
            return True, f"Tool '{tool_name}' failed {same_tool_failures} times consecutively, stopping.", False

        return False, "", False

    def _record_tool_result(self, tool_name: str, args: dict, success: bool):
        """记录工具执行结果（仅保留最近 50 条）"""
        args_hash = self._hash_args(args)
        self.tool_failure_history.append((tool_name, args_hash, success))
        if len(self.tool_failure_history) > 50:
            self.tool_failure_history = self.tool_failure_history[-50:]

    def run_stream(self, user_message: str) -> str:
        """执行流式推理主循环

        完整流程：
        1. 添加用户消息到历史
        2. 裁剪上下文（轮数 + token 限制）
        3. 进入工具调用循环：
           a. 调用 LLM（流式）
           b. 如果无工具调用 -> 返回回复
           c. 如果有工具调用 -> 执行工具 -> 返回结果 -> 继续循环
        4. 达到最大步数时请求 LLM 总结

        Args:
            user_message: 用户消息

        Returns:
            最终回复文本
        """
        logger.info("User: %s", user_message)

        self.messages.append({
            "role": "user",
            "content": [{"type": "text", "text": user_message}],
        })

        self._trim_messages()
        self._validate_and_fix_messages()

        self._emit_event("agent_start")
        final_response = ""
        turn = 0
        cancelled = False

        try:
            while turn < self.max_turns:
                self._raise_if_cancelled()
                turn += 1
                logger.info("[Agent] Turn %d", turn)
                self._emit_event("turn_start", {"turn": turn})

                assistant_msg, tool_calls = self._call_llm_stream(retry_on_empty=True)
                final_response = assistant_msg

                if not tool_calls:
                    if not assistant_msg:
                        if turn > 1:
                            prompt_insert_idx = len(self.messages)
                            self.messages.append({
                                "role": "user",
                                "content": [{"type": "text", "text": "Please respond to the user based on the tool results."}],
                            })
                            assistant_msg, tool_calls = self._call_llm_stream(retry_on_empty=False)
                            final_response = assistant_msg

                            if (prompt_insert_idx < len(self.messages)
                                    and self.messages[prompt_insert_idx].get("role") == "user"):
                                self.messages.pop(prompt_insert_idx)

                            if tool_calls:
                                pass  # continue to tool execution
                            elif not assistant_msg:
                                final_response = "Sorry, I'm unable to generate a response. Please try again."
                        else:
                            final_response = "Sorry, I'm unable to generate a response. Please try again."
                    else:
                        logger.info("Response: %s", assistant_msg[:150] + ("..." if len(assistant_msg) > 150 else ""))

                    if not tool_calls:
                        self._emit_event("turn_end", {"turn": turn, "has_tool_calls": False})
                        break

                # Log tool calls
                tool_calls_str = []
                for tc in tool_calls:
                    args = tc.get('arguments') or {}
                    if isinstance(args, dict):
                        parts = []
                        for k, v in args.items():
                            v_str = str(v)
                            if len(v_str) > 200:
                                v_str = v_str[:200] + f"...({len(v_str)} chars)"
                            parts.append(f"{k}={v_str}")
                        args_str = ', '.join(parts)
                        tool_calls_str.append(f"{tc['name']}({args_str})" if args_str else tc['name'])
                    else:
                        tool_calls_str.append(tc['name'])
                logger.info("Tool calls: %s", ", ".join(tool_calls_str))

                # Execute tools (parallel when 2+ calls)
                tool_result_blocks = []
                try:
                    results = self._execute_tool_calls_batch(tool_calls)
                    for tool_call, result in zip(tool_calls, results):
                        if result.get("status") == "critical_error":
                            final_response = result.get('result', 'Task execution failed')
                            return final_response

                        is_error = result.get("status") == "error"
                        result_data = result.get('result', '')

                        if is_error:
                            result_content = f"Error: {result_data}"
                        elif isinstance(result_data, dict):
                            result_content = json.dumps(result_data, ensure_ascii=False)
                        elif isinstance(result_data, str):
                            result_content = result_data
                        else:
                            result_content = json.dumps(result, ensure_ascii=False)

                        MAX_CURRENT_TURN_RESULT_CHARS = 50000
                        if len(result_content) > MAX_CURRENT_TURN_RESULT_CHARS:
                            result_content = result_content[:MAX_CURRENT_TURN_RESULT_CHARS] + \
                                f"\n\n[Output truncated: {len(result_content)} chars total]"

                        tool_result_block = {
                            "type": "tool_result",
                            "tool_use_id": tool_call["id"],
                            "content": result_content,
                        }
                        if is_error:
                            tool_result_block["is_error"] = True
                        tool_result_blocks.append(tool_result_block)

                finally:
                    if tool_result_blocks:
                        self.messages.append({"role": "user", "content": tool_result_blocks})
                    elif tool_calls:
                        emergency_blocks = []
                        for tool_call in tool_calls:
                            emergency_blocks.append({
                                "type": "tool_result",
                                "tool_use_id": tool_call["id"],
                                "content": "Error: Tool execution was interrupted",
                                "is_error": True,
                            })
                        self.messages.append({"role": "user", "content": emergency_blocks})

                self._emit_event("turn_end", {
                    "turn": turn, "has_tool_calls": True, "tool_count": len(tool_calls),
                })

            if turn >= self.max_turns:
                self._raise_if_cancelled()
                logger.warning("Max steps reached: %d", self.max_turns)
                prompt_insert_idx = len(self.messages)
                self.messages.append({
                    "role": "user",
                    "content": [{"type": "text", "text": f"You have reached the maximum step limit ({turn} steps). Please summarize the current progress."}],
                })
                try:
                    summary_response, _ = self._call_llm_stream(retry_on_empty=False)
                    if summary_response:
                        final_response = summary_response
                    else:
                        final_response = f"Reached maximum steps ({turn}). The task may not be fully complete."
                except Exception:
                    final_response = f"Reached maximum steps ({turn}). The task may not be fully complete."
                finally:
                    if (prompt_insert_idx < len(self.messages)
                            and self.messages[prompt_insert_idx].get("role") == "user"):
                        self.messages.pop(prompt_insert_idx)

        except AgentCancelledError:
            cancelled = True
            logger.info("Agent execution cancelled")
            raise
        except Exception as e:
            logger.error(f"Agent execution error: {e}")
            self._emit_event("error", {"error": str(e)})
            raise
        finally:
            final_response = final_response.strip() if final_response else final_response
            logger.info(f"[Agent] Done ({turn} turns)")
            if not cancelled:
                self._emit_event("agent_end", {"final_response": final_response})

        return final_response

    def _call_llm_stream(self, retry_on_empty=True, retry_count=0, max_retries=3,
                         _overflow_retry: bool = False) -> Tuple[str, List[Dict]]:
        """流式调用 LLM

        处理流程：
        1. 验证并修复消息格式
        2. 构建 OpenAI 格式请求（含工具定义）
        3. 逐 chunk 解析流式响应（文本/推理/工具调用）
        4. 错误处理：上下文溢出裁剪、消息格式错误恢复、API 错误重试

        Args:
            retry_on_empty: 空响应时是否重试一次
            retry_count: 当前重试次数
            max_retries: 最大重试次数
            _overflow_retry: 是否为上下文溢出后的重试

        Returns:
            (回复文本, 工具调用列表)
        """
        self._validate_and_fix_messages()

        messages = self._prepare_messages()
        turns = self._identify_complete_turns()
        logger.info(f"Sending {len(messages)} messages ({len(turns)} turns) to LLM")

        tools_schema = None
        if self.tools:
            tools_schema = []
            for tool in self.tools.values():
                tools_schema.append({
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.params,
                })

        runtime_params = self._runtime_llm_params()
        request = LLMRequest(
            messages=messages,
            temperature=runtime_params["temperature"],
            max_tokens=runtime_params["max_tokens"],
            stream=True,
            tools=tools_schema, system=self.system_prompt,
            thinking_enabled=self.thinking_enabled,
            reasoning_effort=runtime_params["reasoning_effort"] if self.thinking_enabled else None,
            tool_choice=runtime_params["tool_choice"],
        )

        llm_call_id = f"llm_{uuid.uuid4().hex[:12]}"
        llm_started_at = time.time()
        tools_summary = [
            {"name": tool.get("name", ""), "description": tool.get("description", "")}
            for tool in (tools_schema or [])
        ]
        self._emit_event("llm_call_start", {
            "llm_call_id": llm_call_id,
            "retry_count": retry_count,
            "message_count": len(messages),
            "turn_count": len(turns),
            "request": {
                "model": request.model or getattr(self.model, "model", None),
                "temperature": request.temperature,
                "max_tokens": request.max_tokens,
                "stream": request.stream,
                "system": request.system,
                "messages": messages,
                "tools": tools_summary,
                "thinking_enabled": self.thinking_enabled,
                "reasoning_effort": getattr(request, "reasoning_effort", None),
                "tool_choice": getattr(request, "tool_choice", None),
            },
        })
        self._emit_event("message_start", {"role": "assistant"})

        full_content = ""
        full_reasoning = ""
        tool_calls_buffer = {}
        stop_reason = None

        try:
            self._raise_if_cancelled()
            stream = self.model.call_stream(request)

            for chunk in stream:
                self._raise_if_cancelled()
                if isinstance(chunk, dict) and chunk.get("error"):
                    error_data = chunk.get("error", {})
                    if isinstance(error_data, dict):
                        error_msg = error_data.get("message", chunk.get("message", "Unknown error"))
                    else:
                        error_msg = chunk.get("message", str(error_data))
                    status_code = chunk.get("status_code", "N/A")

                    error_msg_lower = error_msg.lower()
                    is_overflow = any(kw in error_msg_lower for kw in [
                        'context length exceeded', 'maximum context length', 'prompt is too long',
                        'context overflow', 'context window', 'too large', 'exceeds model context',
                        'request_too_large', 'request exceeds the maximum size', 'tokens exceed',
                    ])

                    if is_overflow:
                        raise Exception(f"[CONTEXT_OVERFLOW] {error_msg} (Status: {status_code})")
                    else:
                        raise Exception(f"{error_msg} (Status: {status_code})")

                if isinstance(chunk, dict) and chunk.get("choices"):
                    choice = chunk["choices"][0]
                    delta = choice.get("delta", {})

                    finish_reason = choice.get("finish_reason")
                    if finish_reason:
                        stop_reason = finish_reason

                    reasoning_delta = delta.get("reasoning_content") or ""
                    if reasoning_delta:
                        full_reasoning += reasoning_delta
                        self._emit_event("reasoning_update", {"delta": reasoning_delta})

                    content_delta = delta.get("content") or ""
                    if content_delta:
                        full_content += content_delta
                        if content_delta:
                            self._emit_event("message_update", {"delta": content_delta})

                    if "tool_calls" in delta and delta["tool_calls"]:
                        for tc_delta in delta["tool_calls"]:
                            index = tc_delta.get("index", 0)
                            if index not in tool_calls_buffer:
                                tool_calls_buffer[index] = {"id": "", "name": "", "arguments": ""}
                            if tc_delta.get("id"):
                                tool_calls_buffer[index]["id"] = tc_delta["id"]
                            if "function" in tc_delta:
                                func = tc_delta["function"]
                                if func.get("name"):
                                    tool_calls_buffer[index]["name"] = func["name"]
                                if func.get("arguments"):
                                    tool_calls_buffer[index]["arguments"] += func["arguments"]

        except Exception as e:
            self._emit_event("llm_call_error", {
                "llm_call_id": llm_call_id,
                "retry_count": retry_count,
                "error": str(e),
                "duration_ms": (time.time() - llm_started_at) * 1000,
            })
            error_str = str(e)
            error_str_lower = error_str.lower()

            is_context_overflow = '[context_overflow]' in error_str_lower
            if not is_context_overflow:
                is_context_overflow = any(kw in error_str_lower for kw in [
                    'context length exceeded', 'maximum context length', 'prompt is too long',
                    'context overflow', 'context window', 'too large', 'exceeds model context',
                    'request_too_large', 'request exceeds the maximum size',
                ])

            is_message_format_error = any(kw in error_str_lower for kw in [
                'tool_use', 'tool_result', 'tool result', 'without', 'immediately after',
                'corresponding', 'must have', 'tool_call_id', 'tool id', 'not found',
            ]) and ('400' in error_str_lower or 'invalid_request' in error_str_lower)

            if is_context_overflow or is_message_format_error:
                logger.error(f"Context error: {e}")

                if is_context_overflow and self.agent.memory_manager:
                    self.agent.memory_manager.flush_memory(
                        messages=self.messages, reason="overflow", max_messages=0,
                    )

                if is_context_overflow and not _overflow_retry:
                    trimmed = self._aggressive_trim_for_overflow()
                    if trimmed:
                        return self._call_llm_stream(
                            retry_on_empty=retry_on_empty, retry_count=retry_count,
                            max_retries=max_retries, _overflow_retry=True,
                        )

                self.messages.clear()
                if is_context_overflow:
                    raise Exception("Context overflow. History has been cleared.")
                else:
                    raise Exception("Message format error. History has been cleared.")

            is_retryable = any(kw in error_str_lower for kw in [
                'timeout', 'timed out', 'connection', 'network',
                'rate limit', 'overloaded', 'unavailable', 'busy', 'retry',
                '429', '500', '502', '503', '504',
            ])

            if is_retryable and retry_count < max_retries:
                is_rate_limit = '429' in error_str_lower or 'rate limit' in error_str_lower
                wait_time = (30 + retry_count * 15) if is_rate_limit else (retry_count + 1) * 2
                logger.warning(f"LLM API error (attempt {retry_count + 1}/{max_retries}): {e}")
                time.sleep(wait_time)
                return self._call_llm_stream(
                    retry_on_empty=retry_on_empty, retry_count=retry_count + 1, max_retries=max_retries,
                )
            else:
                raise

        # Parse tool calls
        tool_calls = []
        for idx in sorted(tool_calls_buffer.keys()):
            tc = tool_calls_buffer[idx]
            tool_id = tc.get("id") or f"call_{uuid.uuid4().hex[:24]}"

            try:
                args_str = tc.get("arguments") or ""
                arguments = json.loads(args_str) if args_str else {}
            except json.JSONDecodeError as e:
                args_preview = (tc.get('arguments') or "")[:200]
                logger.error(f"Failed to parse tool arguments for {tc['name']}: {e}")
                tool_calls.append({
                    "id": tool_id, "name": tc["name"], "arguments": {},
                    "_parse_error": f"Invalid JSON in tool arguments: {args_preview}...",
                })
                continue

            tool_calls.append({"id": tool_id, "name": tc["name"], "arguments": arguments})

        if retry_on_empty and not full_content and not tool_calls:
            logger.warning("LLM returned empty response, retrying once...")
            self._emit_event("llm_call_end", {
                "llm_call_id": llm_call_id,
                "retry_count": retry_count,
                "status": "empty",
                "duration_ms": (time.time() - llm_started_at) * 1000,
                "stop_reason": stop_reason,
                "response": {
                    "content": full_content,
                    "tool_calls": tool_calls,
                    "assistant_message": None,
                },
            })
            return self._call_llm_stream(retry_on_empty=False, retry_count=retry_count, max_retries=max_retries)

        # Build assistant message for history
        assistant_msg = {"role": "assistant", "content": []}

        if full_reasoning:
            stored_reasoning = _truncate_reasoning_for_storage(full_reasoning)
            assistant_msg["content"].append({"type": "thinking", "thinking": stored_reasoning})

        if full_content:
            assistant_msg["content"].append({"type": "text", "text": full_content})

        if tool_calls:
            for tc in tool_calls:
                assistant_msg["content"].append({
                    "type": "tool_use", "id": tc.get("id", ""),
                    "name": tc.get("name", ""), "input": tc.get("arguments", {}),
                })

        if assistant_msg["content"]:
            self.messages.append(assistant_msg)

        self._emit_event("message_end", {"content": full_content, "tool_calls": tool_calls})
        self._emit_event("llm_call_end", {
            "llm_call_id": llm_call_id,
            "retry_count": retry_count,
            "status": "success",
            "duration_ms": (time.time() - llm_started_at) * 1000,
            "stop_reason": stop_reason,
            "response": {
                "content": full_content,
                "tool_calls": tool_calls,
                "assistant_message": assistant_msg,
            },
        })
        return full_content, tool_calls

    def _execute_tool(self, tool_call: Dict) -> Dict[str, Any]:
        """执行单个工具调用

        包含参数解析失败处理、连续失败保护、工具不存在提示。
        """
        return self._execute_tool_calls_batch([tool_call])[0]

    def _execute_tool_calls_batch(self, tool_calls: List[Dict]) -> List[Dict[str, Any]]:
        """批量执行工具调用。

        2 个以上工具时用线程池并行执行独立调用，缩短多工具场景延迟。
        单工具走串行路径，避免线程池开销。
        """
        if not tool_calls:
            return []
        if len(tool_calls) == 1:
            self._raise_if_cancelled()
            return [self._execute_tool_impl(tool_calls[0])]

        max_workers = min(len(tool_calls), 4)
        results: List[Optional[Dict]] = [None] * len(tool_calls)

        def _run(idx: int, tc: Dict) -> tuple[int, Dict[str, Any]]:
            self._raise_if_cancelled()
            return idx, self._execute_tool_impl(tc)

        with ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="agent-tool") as pool:
            futures = {pool.submit(_run, i, tc): i for i, tc in enumerate(tool_calls)}
            for future in as_completed(futures):
                idx, result = future.result()
                results[idx] = result

        return results  # type: ignore[return-value]

    def _execute_tool_impl(self, tool_call: Dict) -> Dict[str, Any]:
        """单个工具的实际执行逻辑（含参数解析、失败保护、事件发射）。"""
        tool_name = tool_call["name"]
        tool_id = tool_call["id"]
        arguments = tool_call["arguments"]

        if "_parse_error" in tool_call:
            parse_error = tool_call["_parse_error"]
            logger.error(f"Skipping tool due to parse error: {parse_error}")
            result = {
                "status": "error",
                "result": f"Failed to parse tool arguments. {parse_error}",
                "execution_time": 0,
            }
            self._record_tool_result(tool_name, arguments, False)
            return result

        should_stop, stop_reason, is_critical = self._check_consecutive_failures(tool_name, arguments)
        if should_stop:
            self._record_tool_result(tool_name, arguments, False)
            if is_critical:
                return {"status": "critical_error", "result": stop_reason, "execution_time": 0}
            return {"status": "error", "result": stop_reason, "execution_time": 0}

        self._emit_event("tool_execution_start", {
            "tool_call_id": tool_id, "tool_name": tool_name, "arguments": arguments,
        })

        try:
            tool = self.tools.get(tool_name)
            if not tool:
                available = list(self.tools.keys())
                raise ValueError(f"Tool '{tool_name}' not found. Available: {available}")

            # 浅拷贝工具实例，使并行执行时每个调用的 per-call 属性互不干扰。
            # 重型依赖（service 等）通过引用共享，开销仅一次 dict 分配。
            tool = _copy.copy(tool)
            tool.model = self.model
            tool.context = self.agent
            tool.event_emitter = self._emit_event
            tool.current_tool_call = {"id": tool_id, "name": tool_name}

            start_time = time.time()
            try:
                result: ToolResult = tool.execute_tool(arguments)
            finally:
                tool.current_tool_call = None
            execution_time = time.time() - start_time

            result_dict = {
                "status": result.status,
                "result": result.result,
                "execution_time": execution_time,
            }

            self._record_tool_result(tool_name, arguments, result.status == "success")
            self._emit_event("tool_execution_end", {
                "tool_call_id": tool_id, "tool_name": tool_name, **result_dict,
            })
            return result_dict

        except Exception as e:
            logger.error(f"Tool execution error: {e}")
            self._record_tool_result(tool_name, arguments, False)
            error_result = {"status": "error", "result": str(e), "execution_time": 0}
            self._emit_event("tool_execution_end", {
                "tool_call_id": tool_id, "tool_name": tool_name, **error_result,
            })
            return error_result

    def _validate_and_fix_messages(self):
        """验证并修复消息历史（修复孤立的 tool_use/tool_result）"""
        sanitize_claude_messages(self.messages)

    def _identify_complete_turns(self) -> List[Dict]:
        """识别完整对话轮次

        一个完整轮次包含：用户消息 -> AI 回复 -> 工具结果（如有）-> 后续 AI 回复。
        以用户文本消息作为轮次分界点。
        """
        turns = []
        current_turn = {'messages': []}

        for msg in self.messages:
            role = msg.get('role')
            content = msg.get('content', [])

            if role == 'user':
                is_user_query = False
                if isinstance(content, list):
                    has_text = any(isinstance(b, dict) and b.get('type') == 'text' for b in content)
                    has_tool_result = any(isinstance(b, dict) and b.get('type') == 'tool_result' for b in content)
                    is_user_query = has_text and not has_tool_result
                elif isinstance(content, str):
                    is_user_query = True

                if is_user_query:
                    if current_turn['messages']:
                        turns.append(current_turn)
                    current_turn = {'messages': [msg]}
                else:
                    current_turn['messages'].append(msg)
            else:
                current_turn['messages'].append(msg)

        if current_turn['messages']:
            turns.append(current_turn)
        return turns

    def _estimate_turn_tokens(self, turn: Dict) -> int:
        """估算一轮对话的 token 消耗"""
        return sum(self.agent._estimate_message_tokens(msg) for msg in turn['messages'])

    def _truncate_historical_tool_results(self):
        """截断历史工具结果，减小上下文体积

        当前轮次的工具结果保留完整（最大 50K 字符），
        历史轮次的工具结果截断到 20K 字符。
        """
        MAX_HISTORY_RESULT_CHARS = 20000
        if len(self.messages) < 2:
            return

        current_turn_start = len(self.messages)
        for i in range(len(self.messages) - 1, -1, -1):
            msg = self.messages[i]
            if msg.get("role") == "user":
                content = msg.get("content", [])
                if isinstance(content, list) and any(
                    isinstance(b, dict) and b.get("type") == "text" for b in content
                ):
                    current_turn_start = i
                    break
                elif isinstance(content, str):
                    current_turn_start = i
                    break

        truncated_count = 0
        for i in range(current_turn_start):
            msg = self.messages[i]
            if msg.get("role") != "user":
                continue
            content = msg.get("content", [])
            if not isinstance(content, list):
                continue
            for block in content:
                if not isinstance(block, dict) or block.get("type") != "tool_result":
                    continue
                result_str = block.get("content", "")
                if isinstance(result_str, str) and len(result_str) > MAX_HISTORY_RESULT_CHARS:
                    original_len = len(result_str)
                    block["content"] = result_str[:MAX_HISTORY_RESULT_CHARS] + \
                        f"\n\n[Historical output truncated: {original_len} -> {MAX_HISTORY_RESULT_CHARS} chars]"
                    truncated_count += 1

        if truncated_count > 0:
            logger.info(f"Truncated {truncated_count} historical tool result(s)")

    def _aggressive_trim_for_overflow(self) -> bool:
        """上下文溢出时的激进裁剪策略

        三步裁剪：
        1. 将所有工具结果截断到 10K 字符
        2. 将过长的用户消息截断到 10K 字符
        3. 仅保留最近 5 个完整对话轮次

        Returns:
            True 表示有内容被裁剪（值得重试），False 表示无内容可裁剪
        """
        if not self.messages:
            return False

        original_count = len(self.messages)
        AGGRESSIVE_LIMIT = 10000
        truncated = 0

        for msg in self.messages:
            content = msg.get("content", [])
            if not isinstance(content, list):
                continue
            for block in content:
                if not isinstance(block, dict):
                    continue
                if block.get("type") == "tool_result":
                    result_str = block.get("content", "")
                    if isinstance(result_str, str) and len(result_str) > AGGRESSIVE_LIMIT:
                        block["content"] = result_str[:AGGRESSIVE_LIMIT] + \
                            f"\n\n[Truncated for context recovery: {len(result_str)} -> {AGGRESSIVE_LIMIT} chars]"
                        truncated += 1
                if block.get("type") == "tool_use" and isinstance(block.get("input"), dict):
                    for key, val in block["input"].items():
                        if isinstance(val, str) and len(val) > 1000:
                            block["input"][key] = val[:1000] + f"... [truncated {len(val)} chars]"
                            truncated += 1

        USER_MSG_LIMIT = 10000
        for msg in self.messages:
            if msg.get("role") != "user":
                continue
            content = msg.get("content", [])
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "text":
                        text = block.get("text", "")
                        if len(text) > USER_MSG_LIMIT:
                            block["text"] = text[:USER_MSG_LIMIT] + \
                                f"\n\n[Message truncated: {len(text)} -> {USER_MSG_LIMIT} chars]"
                            truncated += 1
            elif isinstance(content, str) and len(content) > USER_MSG_LIMIT:
                msg["content"] = content[:USER_MSG_LIMIT] + \
                    f"\n\n[Message truncated: {len(content)} -> {USER_MSG_LIMIT} chars]"
                truncated += 1

        turns = self._identify_complete_turns()
        if len(turns) > 5:
            kept_turns = turns[-5:]
            new_messages = []
            for turn in kept_turns:
                new_messages.extend(turn["messages"])
            self.messages[:] = new_messages
            logger.info(f"Aggressive trim: {original_count} -> {len(self.messages)} messages")
            return True

        if truncated > 0:
            return True

        return False

    def _summarize_turns_for_context(self, turns: List[Dict]) -> Optional[str]:
        """通过 LLM 摘要压缩需要裁剪的对话轮次

        Returns:
            摘要文本，失败返回 None
        """
        if not turns or not self.agent or not self.agent.model:
            return None

        conversation = self._format_turns_text(turns)
        if not conversation.strip():
            return None

        try:
            request = LLMRequest(
                messages=[{"role": "user", "content": _CONTEXT_SUMMARY_USER_PROMPT.format(conversation=conversation)}],
                temperature=0,
                max_tokens=500,
                stream=False,
                system=_CONTEXT_SUMMARY_SYSTEM_PROMPT,
            )
            response = self.agent.model.call(request)
            text = self._extract_response_text(response)
            if text and text.strip() and text.strip() != "无":
                logger.info(f"[ContextSummarize] Summarized {len(turns)} turns into {len(text)} chars")
                return text.strip()
            return None
        except Exception as e:
            logger.warning(f"[ContextSummarize] LLM summarization failed: {e}")
            return None

    @staticmethod
    def _extract_response_text(response) -> str:
        """从 LLM 非流式响应中提取文本"""
        if not response:
            return ""
        if isinstance(response, dict):
            if response.get("error"):
                return ""
            content = response.get("content")
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "text":
                        return block.get("text", "")
            choices = response.get("choices", [])
            if choices:
                return choices[0].get("message", {}).get("content", "")
        if hasattr(response, "choices") and response.choices:
            return response.choices[0].message.content or ""
        return ""

    @staticmethod
    def _format_turns_text(self, turns: List[Dict]) -> str:
        """将对话轮次格式化为文本用于 LLM 摘要"""
        lines = []
        for turn in turns:
            for msg in turn.get("messages", []):
                role = msg.get("role", "")
                content = msg.get("content", "")
                if isinstance(content, str):
                    text = content.strip()
                elif isinstance(content, list):
                    parts = []
                    for block in content:
                        if isinstance(block, dict) and block.get("type") == "text":
                            parts.append(block.get("text", ""))
                    text = "\n".join(p for p in parts if p).strip()
                else:
                    continue
                if not text:
                    continue
                label = "用户" if role == "user" else "助手"
                lines.append(f"{label}: {text[:300]}")
        return "\n".join(lines)[:12000]

    @staticmethod
    def _build_summary_messages(self, summary: str) -> List[Dict]:
        """将摘要文本构建为紧凑的消息对插入对话历史"""
        return [
            {
                "role": "user",
                "content": [{"type": "text", "text": f"[之前的对话摘要]\n{summary}"}],
            },
            {
                "role": "assistant",
                "content": [{"type": "text", "text": "好的，我已了解之前的对话内容，让我们继续。"}],
            },
        ]

    def _summarize_or_flush(self, discarded_turns: List[Dict]) -> List[Dict]:
        """尝试通过 LLM 摘要压缩被裁剪的轮次，失败则写入记忆

        无论摘要是否成功，被裁剪的内容都会异步写入记忆文件。
        摘要成功时额外返回摘要消息，使当前对话保留关键上下文。

        Returns:
            摘要消息列表（成功时）或空列表（失败时）
        """
        if self.agent.memory_manager:
            discarded_messages = []
            for turn in discarded_turns:
                discarded_messages.extend(turn["messages"])
            if discarded_messages:
                self.agent.memory_manager.flush_memory(
                    messages=discarded_messages, reason="trim", max_messages=0,
                )

        summary = self._summarize_turns_for_context(discarded_turns)
        if summary:
            return self._build_summary_messages(summary)

        return []

    def _trim_messages(self):
        """智能裁剪消息历史，保持对话完整性

        裁剪策略（按优先级执行）：
        1. 截断历史工具结果（50K -> 20K）
        2. 轮数限制：超出时先尝试 LLM 摘要压缩，失败则移除并写入记忆
        3. Token 限制：
           - 轮次 < 5：压缩所有轮次为纯文本（不丢弃轮次）
           - 轮次 >= 5：先尝试 LLM 摘要压缩前半轮次，失败则丢弃并写入记忆
        """
        if not self.messages or not self.agent:
            return

        self._truncate_historical_tool_results()
        turns = self._identify_complete_turns()
        if not turns:
            return

        summary_messages = []

        if len(turns) > self.max_context_turns:
            removed_count = len(turns) // 2
            keep_count = len(turns) - removed_count
            discarded_turns = turns[:removed_count]
            turns = turns[-keep_count:]
            logger.info(f"Context turns exceeded: keeping {keep_count}, removing {removed_count}")

            summary_messages = self._summarize_or_flush(discarded_turns)

        context_window = self.agent._get_model_context_window()
        if self.agent.max_context_tokens:
            max_tokens = self.agent.max_context_tokens
        else:
            reserve_tokens = int(context_window * 0.1)
            max_tokens = context_window - reserve_tokens

        system_tokens = self.agent._estimate_message_tokens({"role": "system", "content": self.system_prompt})
        summary_tokens = sum(self.agent._estimate_message_tokens(m) for m in summary_messages)
        current_tokens = sum(self._estimate_turn_tokens(turn) for turn in turns)

        if current_tokens + system_tokens + summary_tokens <= max_tokens:
            new_messages = list(summary_messages)
            for turn in turns:
                new_messages.extend(turn['messages'])
            self.messages = new_messages
            return

        COMPRESS_THRESHOLD = 5
        if len(turns) < COMPRESS_THRESHOLD:
            compressed_turns = []
            for t in turns:
                compressed = compress_turn_to_text_only(t)
                if compressed["messages"]:
                    compressed_turns.append(compressed)
            new_messages = list(summary_messages)
            for turn in compressed_turns:
                new_messages.extend(turn["messages"])
            self.messages = new_messages
            logger.info(f"Compressed all turns to text-only ({len(turns)} turns)")
            return

        removed_count = len(turns) // 2
        keep_count = len(turns) - removed_count
        discarded_turns = turns[:removed_count]
        kept_turns = turns[-keep_count:]

        logger.info(f"Token limit exceeded: keeping {keep_count} turns, removing {removed_count}")

        extra_summary = self._summarize_or_flush(discarded_turns)

        new_messages = summary_messages + extra_summary
        for turn in kept_turns:
            new_messages.extend(turn['messages'])
        self.messages = new_messages

    def _prepare_messages(self) -> List[Dict[str, Any]]:
        """准备发送给 LLM 的消息列表（不含系统提示词，由 provider 单独处理）"""
        return self.messages
