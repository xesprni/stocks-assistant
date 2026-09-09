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
import logging
import threading
import time
import uuid
from typing import Any

from app.core.agent.context import (
    aggressive_trim_for_overflow,
    build_summary_messages,
    format_turns_text,
    identify_complete_turns,
    omit_image_data,
    truncate_historical_tool_results,
)
from app.core.agent.delegation_runtime import AgentCancelledError
from app.core.agent.message_utils import compress_turn_to_text_only, sanitize_claude_messages
from app.core.agent.models import LLMRequest
from app.core.agent.stream_state import StreamState
from app.core.llm.errors import (
    ProviderErrorKind,
    classify_provider_error,
    error_from_chunk,
    retry_delay,
)
from app.core.tools.base_tool import BaseTool, ToolResult
from app.core.tools.batch_executor import ToolBatchExecutor
from app.core.tools.call_context import ToolCallContext
from app.core.tools.result_metadata import ToolResultMetadata, normalize_tool_metadata

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
    - 上下文溢出恢复（仅裁剪单次请求副本）
    """

    def __init__(
        self,
        agent,
        model,
        system_prompt: str,
        tools: list[BaseTool],
        max_turns: int = 50,
        on_event=None,
        messages: list[dict] | None = None,
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
        self.evidence: list[dict[str, Any]] = []
        self.sources: list[dict[str, Any]] = []
        self.rendered_images: list[dict[str, Any]] = []
        self._evidence_lock = threading.Lock()

    def _collect_evidence(self, result: dict[str, Any]) -> None:
        with self._evidence_lock:
            metadata = ToolResultMetadata.merge(
                {"evidence": self.evidence, "sources": self.sources}, result
            )
            self.evidence = metadata.evidence
            self.sources = metadata.sources

    def _collect_rendered_images(self, result: dict[str, Any], tool_name: str = "") -> None:
        metadata = normalize_tool_metadata(
            status=result.get("status", "success"),
            result=result.get("result"),
            metadata=result,
            tool_name=tool_name,
        )
        with self._evidence_lock:
            self.rendered_images = ToolResultMetadata.merge(
                {"rendered_images": self.rendered_images}, metadata
            ).rendered_images

    def _raise_if_cancelled(self):
        if self.cancel_event is not None and self.cancel_event.is_set():
            raise AgentCancelledError("Agent run cancelled")

    def _consume_steering(
        self,
        *,
        finish: bool = False,
        close: bool = False,
        request_messages: list[dict[str, Any]] | None = None,
    ) -> bool:
        """仅在完整工具结果之后注入用户输入，保持工具调用/结果配对。"""
        self._raise_if_cancelled()
        channel = getattr(self.agent, "input_channel", None)
        if channel is None:
            return False
        inputs = channel.finish() if finish else channel.drain(close=close)
        for item in inputs:
            message = {"role": "user", "content": [{"type": "text", "text": item["message"]}]}
            self.messages.append(message)
            if request_messages is not None:
                request_messages.append(_copy.deepcopy(message))
        if inputs:
            self._trim_messages()
        return bool(inputs)

    def _runtime_llm_params(self) -> dict[str, Any]:
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

        reasoning_effort = (
            str(getattr(settings, "llm_reasoning_effort", "medium") or "medium").strip().lower()
        )
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

    def _check_consecutive_failures(self, tool_name: str, args: dict) -> tuple[bool, str, bool]:
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
        for name, ahash, _success in reversed(self.tool_failure_history):
            if name == tool_name and ahash == args_hash:
                same_args_calls += 1
            else:
                break
        if same_args_calls >= 5:
            return (
                True,
                f"Tool '{tool_name}' called {same_args_calls} times with same args, stopping.",
                False,
            )

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
            return (
                True,
                f"Tool '{tool_name}' failed {same_args_failures} times with same args, stopping.",
                False,
            )

        same_tool_failures = 0
        for name, _ahash, success in reversed(self.tool_failure_history):
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
            return (
                True,
                f"Tool '{tool_name}' failed {same_tool_failures} times consecutively, stopping.",
                False,
            )

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

        self.messages.append(
            {
                "role": "user",
                "content": [{"type": "text", "text": user_message}],
            }
        )

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
                            reminder = {
                                "role": "user",
                                "content": [
                                    {
                                        "type": "text",
                                        "text": "Please respond to the user based on the tool results.",
                                    }
                                ],
                            }
                            self.messages.append(reminder)
                            assistant_msg, tool_calls = self._call_llm_stream(retry_on_empty=False)
                            final_response = assistant_msg

                            # 补充输入可能触发裁剪；按对象移除临时提示，不能用旧索引删用户消息。
                            self.messages = [msg for msg in self.messages if msg is not reminder]

                            if tool_calls:
                                pass  # continue to tool execution
                            elif not assistant_msg:
                                final_response = (
                                    "Sorry, I'm unable to generate a response. Please try again."
                                )
                        else:
                            final_response = (
                                "Sorry, I'm unable to generate a response. Please try again."
                            )
                    else:
                        logger.info(
                            "Response: %s",
                            assistant_msg[:150] + ("..." if len(assistant_msg) > 150 else ""),
                        )

                    if not tool_calls:
                        self._emit_event("turn_end", {"turn": turn, "has_tool_calls": False})
                        # 完成判断与接收端共用原子封口；末个 token 期间提交的输入不能漏掉。
                        if self._consume_steering(finish=True):
                            continue
                        break

                # Log tool calls
                tool_calls_str = []
                for tc in tool_calls:
                    args = tc.get("arguments") or {}
                    if isinstance(args, dict):
                        parts = []
                        for k, v in args.items():
                            v_str = str(v)
                            if len(v_str) > 200:
                                v_str = v_str[:200] + f"...({len(v_str)} chars)"
                            parts.append(f"{k}={v_str}")
                        args_str = ", ".join(parts)
                        tool_calls_str.append(
                            f"{tc['name']}({args_str})" if args_str else tc["name"]
                        )
                    else:
                        tool_calls_str.append(tc["name"])
                logger.info("Tool calls: %s", ", ".join(tool_calls_str))

                # Execute tools (parallel when 2+ calls)
                tool_result_blocks = []
                try:
                    results = self._execute_tool_calls_batch(tool_calls)
                    for tool_call, result in zip(tool_calls, results, strict=False):
                        image_blocks = result.pop("_image_blocks", [])
                        self._collect_rendered_images(result, tool_call["name"])
                        self._collect_evidence(result)
                        if result.get("status") == "critical_error":
                            final_response = result.get("result", "Task execution failed")
                            return final_response

                        is_error = result.get("status") == "error"
                        result_data = result.get("result", "")

                        evidence_items = result.get("evidence") or []
                        source_items = result.get("sources") or []
                        rendered_images = result.get("rendered_images") or []
                        if evidence_items or source_items or rendered_images:
                            result_content = json.dumps(
                                {
                                    "error" if is_error else "data": result_data,
                                    "evidence": evidence_items,
                                    "sources": source_items,
                                    "rendered_images": rendered_images,
                                },
                                ensure_ascii=False,
                            )
                        elif is_error:
                            result_content = f"Error: {result_data}"
                        elif isinstance(result_data, dict):
                            result_content = json.dumps(result_data, ensure_ascii=False)
                        elif isinstance(result_data, str):
                            result_content = result_data
                        else:
                            result_content = json.dumps(result, ensure_ascii=False)

                        MAX_CURRENT_TURN_RESULT_CHARS = 50000
                        if len(result_content) > MAX_CURRENT_TURN_RESULT_CHARS:
                            result_content = (
                                result_content[:MAX_CURRENT_TURN_RESULT_CHARS]
                                + f"\n\n[Output truncated: {len(result_content)} chars total]"
                            )

                        tool_result_block = {
                            "type": "tool_result",
                            "tool_use_id": tool_call["id"],
                            "content": result_content,
                        }
                        if is_error:
                            tool_result_block["is_error"] = True
                        tool_result_blocks.append(tool_result_block)
                        if not is_error:
                            tool_result_blocks.extend(image_blocks)

                finally:
                    if tool_result_blocks:
                        self.messages.append({"role": "user", "content": tool_result_blocks})
                    elif tool_calls:
                        emergency_blocks = []
                        for tool_call in tool_calls:
                            emergency_blocks.append(
                                {
                                    "type": "tool_result",
                                    "tool_use_id": tool_call["id"],
                                    "content": "Error: Tool execution was interrupted",
                                    "is_error": True,
                                }
                            )
                        self.messages.append({"role": "user", "content": emergency_blocks})

                self._emit_event(
                    "turn_end",
                    {
                        "turn": turn,
                        "has_tool_calls": True,
                        "tool_count": len(tool_calls),
                    },
                )

            if turn >= self.max_turns:
                self._raise_if_cancelled()
                # 到达步数上限只再总结一次；封口后新补充由 API 明确拒绝，可改为排队。
                self._consume_steering(close=True)
                logger.warning("Max steps reached: %d", self.max_turns)
                reminder = {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": f"You have reached the maximum step limit ({turn} steps). Please summarize the current progress.",
                        }
                    ],
                }
                self.messages.append(reminder)
                try:
                    summary_response, _ = self._call_llm_stream(retry_on_empty=False)
                    if summary_response:
                        final_response = summary_response
                    else:
                        final_response = (
                            f"Reached maximum steps ({turn}). The task may not be fully complete."
                        )
                except AgentCancelledError:
                    # 汇总也属于同一次运行，显式停止不能被普通失败兜底转换成成功。
                    raise
                except Exception:
                    final_response = (
                        f"Reached maximum steps ({turn}). The task may not be fully complete."
                    )
                finally:
                    self.messages = [msg for msg in self.messages if msg is not reminder]

        except AgentCancelledError:
            cancelled = True
            logger.info("Agent execution cancelled")
            raise
        except Exception as e:
            logger.error("Agent execution error: %s", e)
            self._emit_event("error", {"error": str(e)})
            raise
        finally:
            # 运行结束后不把图片字节带入会话历史、记忆整理或下次对话。
            self.messages = omit_image_data(self.messages)
            final_response = final_response.strip() if final_response else final_response
            logger.info("[Agent] Done (%s turns)", turn)
            if not cancelled:
                self._emit_event("agent_end", {"final_response": final_response})

        return final_response

    def _call_llm_stream(
        self,
        retry_on_empty=True,
        retry_count=0,
        max_retries=3,
        _overflow_retry: bool = False,
        _request_messages: list[dict[str, Any]] | None = None,
    ) -> tuple[str, list[dict]]:
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
        # 包括空响应和连接重试：下一次模型调用前统一收取，工具执行中不改动消息。
        request_copy = _copy.deepcopy(_request_messages) if _request_messages is not None else None
        self._consume_steering(request_messages=request_copy)
        # 每次请求独立复制；重试期间 drain 的新输入先追加到副本，不能依赖裁剪后消息长度。
        messages = (
            _copy.deepcopy(self._prepare_messages()) if request_copy is None else request_copy
        )
        sanitize_claude_messages(messages)
        turns = self._identify_complete_turns()
        logger.info("Sending %s messages (%s turns) to LLM", len(messages), len(turns))

        tools_schema = None
        if self.tools:
            tools_schema = []
            for tool in self.tools.values():
                tools_schema.append(
                    {
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": tool.params,
                    }
                )

        runtime_params = self._runtime_llm_params()
        request = LLMRequest(
            messages=messages,
            temperature=runtime_params["temperature"],
            max_tokens=runtime_params["max_tokens"],
            stream=True,
            tools=tools_schema,
            system=self.system_prompt,
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
        self._emit_event(
            "llm_call_start",
            {
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
                    "messages": omit_image_data(messages),
                    "tools": tools_summary,
                    "thinking_enabled": self.thinking_enabled,
                    "reasoning_effort": getattr(request, "reasoning_effort", None),
                    "tool_choice": getattr(request, "tool_choice", None),
                },
            },
        )
        self._emit_event("message_start", {"role": "assistant"})

        state = StreamState()

        try:
            self._raise_if_cancelled()
            stream = self.model.call_stream(request)

            try:
                for chunk in stream:
                    self._raise_if_cancelled()
                    if isinstance(chunk, dict) and chunk.get("error"):
                        raise error_from_chunk(chunk)

                    if isinstance(chunk, dict):
                        for event_type, event_data in state.consume(chunk):
                            self._emit_event(event_type, event_data)
            finally:
                close_stream = getattr(stream, "close", None)
                if close_stream is not None:
                    try:
                        close_stream()
                    except Exception:
                        logger.warning("Failed to release model stream", exc_info=True)

        except AgentCancelledError:
            raise
        except Exception as e:
            self._emit_event(
                "llm_call_error",
                {
                    "llm_call_id": llm_call_id,
                    "retry_count": retry_count,
                    "error": str(e),
                    "duration_ms": (time.time() - llm_started_at) * 1000,
                },
            )
            kind = classify_provider_error(e)
            if kind == ProviderErrorKind.CONTEXT and not _overflow_retry:
                recovered = _copy.deepcopy(messages)
                if aggressive_trim_for_overflow(recovered):
                    if state.content:
                        self._emit_event("message_reset", {"discarded_content": state.content})
                    return self._call_llm_stream(
                        retry_on_empty=retry_on_empty,
                        retry_count=retry_count,
                        max_retries=max_retries,
                        _overflow_retry=True,
                        _request_messages=recovered,
                    )
            wait_time = retry_delay(kind, retry_count)
            if wait_time is not None and retry_count < max_retries:
                logger.warning("LLM API error (attempt %s/%s): %s", retry_count + 1, max_retries, e)
                if state.content:
                    self._emit_event("message_reset", {"discarded_content": state.content})
                self._emit_event(
                    "status_update", {"message": "Model connection interrupted. Retrying..."}
                )
                if self.cancel_event is not None:
                    self.cancel_event.wait(wait_time)
                    self._raise_if_cancelled()
                else:
                    time.sleep(wait_time)
                # 只重试尚未提交的模型调用，保留此前工具结果，避免重做有副作用的工具。
                return self._call_llm_stream(
                    retry_on_empty=retry_on_empty,
                    retry_count=retry_count + 1,
                    max_retries=max_retries,
                    _overflow_retry=_overflow_retry,
                    _request_messages=messages,
                )
            else:
                raise

        full_content = state.content
        full_reasoning = state.reasoning
        stop_reason = state.stop_reason
        tool_calls = state.parsed_tool_calls()
        for call in tool_calls:
            if "_parse_error" in call:
                logger.error(
                    "Failed to parse tool arguments for %s: %s", call["name"], call["_parse_error"]
                )

        if retry_on_empty and not full_content and not tool_calls:
            logger.warning("LLM returned empty response, retrying once...")
            self._emit_event(
                "llm_call_end",
                {
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
                },
            )
            return self._call_llm_stream(
                retry_on_empty=False,
                retry_count=retry_count,
                max_retries=max_retries,
                _overflow_retry=_overflow_retry,
                _request_messages=messages,
            )

        # Build assistant message for history
        assistant_msg = {"role": "assistant", "content": []}

        if full_reasoning:
            stored_reasoning = _truncate_reasoning_for_storage(full_reasoning)
            assistant_msg["content"].append({"type": "thinking", "thinking": stored_reasoning})

        if full_content:
            assistant_msg["content"].append({"type": "text", "text": full_content})

        if tool_calls:
            for tc in tool_calls:
                assistant_msg["content"].append(
                    {
                        "type": "tool_use",
                        "id": tc.get("id", ""),
                        "name": tc.get("name", ""),
                        "input": tc.get("arguments", {}),
                    }
                )

        if assistant_msg["content"]:
            self.messages.append(assistant_msg)

        self._emit_event("message_end", {"content": full_content, "tool_calls": tool_calls})
        self._emit_event(
            "llm_call_end",
            {
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
            },
        )
        return full_content, tool_calls

    def _execute_tool(self, tool_call: dict) -> dict[str, Any]:
        """执行单个工具调用

        包含参数解析失败处理、连续失败保护、工具不存在提示。
        """
        return self._execute_tool_calls_batch([tool_call])[0]

    def _execute_tool_calls_batch(self, tool_calls: list[dict]) -> list[dict[str, Any]]:
        results = ToolBatchExecutor(
            self.tools, self._execute_tool_impl, self._raise_if_cancelled
        ).run(tool_calls)
        # 模型一轮批次完成后按请求顺序记账，避免并行完成顺序影响下一轮失败保护。
        for call, result in zip(tool_calls, results, strict=True):
            self._record_tool_result(
                call["name"], call["arguments"], result.get("status") == "success"
            )
        return results

    def _execute_tool_impl(self, tool_call: dict) -> dict[str, Any]:
        """单个工具的实际执行逻辑（含参数解析、失败保护、事件发射）。"""
        tool_name = tool_call["name"]
        tool_id = tool_call["id"]
        arguments = tool_call["arguments"]

        if "_parse_error" in tool_call:
            parse_error = tool_call["_parse_error"]
            logger.error("Skipping tool due to parse error: %s", parse_error)
            result = {
                "status": "error",
                "result": f"Failed to parse tool arguments. {parse_error}",
                "execution_time": 0,
            }
            return result

        should_stop, stop_reason, is_critical = self._check_consecutive_failures(
            tool_name, arguments
        )
        if should_stop:
            if is_critical:
                return {"status": "critical_error", "result": stop_reason, "execution_time": 0}
            return {"status": "error", "result": stop_reason, "execution_time": 0}

        self._emit_event(
            "tool_execution_start",
            {
                "tool_call_id": tool_id,
                "tool_name": tool_name,
                "arguments": arguments,
            },
        )

        try:
            tool = self.tools.get(tool_name)
            if not tool:
                available = list(self.tools.keys())
                raise ValueError(f"Tool '{tool_name}' not found. Available: {available}")

            skill_filter = getattr(self.agent, "active_skill_filter", None)
            context = ToolCallContext(
                tool_call_id=tool_id,
                tool_name=tool_name,
                model=self.model,
                parent_agent=self.agent,
                user_id=getattr(self.agent, "user_id", None),
                event_emitter=self._emit_event,
                cancel_event=self.cancel_event,
                thinking_enabled=self.thinking_enabled,
                delegation_runtime=getattr(self.agent, "delegation_runtime", None),
                memory_manager=getattr(self.agent, "memory_manager", None),
                skill_manager=getattr(self.agent, "skill_manager", None),
                skill_filter=frozenset(skill_filter) if skill_filter is not None else None,
                settings=getattr(self.agent, "settings", None),
                workspace_dir=getattr(self.agent, "workspace_dir", None),
            )
            start_time = time.monotonic()
            result: ToolResult = tool.execute_tool(arguments, context)
            execution_time = time.monotonic() - start_time

            result_dict = {
                "status": result.status,
                "result": result.result,
                "execution_time": execution_time,
            }
            result_dict.update(
                normalize_tool_metadata(
                    status=result.status,
                    result=result.result,
                    metadata=result.ext_data,
                    tool_name=tool_name,
                )
            )
            if isinstance(result.ext_data, dict) and result.ext_data.get("preserve_partial"):
                result_dict["preserve_partial"] = True

            # 提前归集已完成工具的元数据，避免同批另一个工具取消后丢失这些结果。
            self._collect_evidence(result_dict)
            self._collect_rendered_images(result_dict, tool_name)
            self._raise_if_cancelled()
            self._emit_event(
                "tool_execution_end",
                {
                    "tool_call_id": tool_id,
                    "tool_name": tool_name,
                    **result_dict,
                    "source_count": len(result_dict.get("sources", [])),
                },
            )
            if (
                result.status == "success"
                and isinstance(result.ext_data, dict)
                and result.ext_data.get("image_blocks")
            ):
                # 公共事件发射完成后才附加私有字段，避免 SSE/追踪泄露 base64。
                result_dict["_image_blocks"] = result.ext_data.get("image_blocks", [])
            return result_dict

        except AgentCancelledError as exc:
            metadata = getattr(exc, "metadata", None)
            if isinstance(metadata, dict):
                # 委派停止可携带已完成子任务的引用；仅归集，不发布成功事件。
                completed = {
                    "status": "success",
                    "evidence": metadata.get("evidence", []),
                    "sources": metadata.get("sources", []),
                    "rendered_images": metadata.get("rendered_images", []),
                }
                self._collect_evidence(completed)
                self._collect_rendered_images(completed, tool_name)
            self._emit_event(
                "tool_execution_end",
                {
                    "tool_call_id": tool_id,
                    "tool_name": tool_name,
                    "status": "cancelled",
                    "result": "Tool execution cancelled",
                    "execution_time": 0,
                },
            )
            raise
        except Exception as e:
            logger.error("Tool execution error: %s", e)
            error_result = {"status": "error", "result": str(e), "execution_time": 0}
            self._emit_event(
                "tool_execution_end",
                {
                    "tool_call_id": tool_id,
                    "tool_name": tool_name,
                    **error_result,
                },
            )
            return error_result

    def _validate_and_fix_messages(self):
        """验证并修复消息历史（修复孤立的 tool_use/tool_result）"""
        sanitize_claude_messages(self.messages)

    def _identify_complete_turns(self) -> list[dict[str, Any]]:
        return identify_complete_turns(self.messages)

    def _estimate_turn_tokens(self, turn: dict) -> int:
        """估算一轮对话的 token 消耗"""
        return sum(self.agent._estimate_message_tokens(msg) for msg in turn["messages"])

    def _truncate_historical_tool_results(self) -> None:
        return truncate_historical_tool_results(self.messages)

    def _aggressive_trim_for_overflow(self) -> bool:
        return aggressive_trim_for_overflow(self.messages)

    def _summarize_turns_for_context(self, turns: list[dict]) -> str | None:
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
                messages=[
                    {
                        "role": "user",
                        "content": _CONTEXT_SUMMARY_USER_PROMPT.format(conversation=conversation),
                    }
                ],
                temperature=0,
                max_tokens=500,
                stream=False,
                system=_CONTEXT_SUMMARY_SYSTEM_PROMPT,
            )
            response = self.agent.model.call(request)
            text = self._extract_response_text(response)
            if text and text.strip() and text.strip() != "无":
                logger.info(
                    "[ContextSummarize] Summarized %s turns into %s chars", len(turns), len(text)
                )
                return text.strip()
            return None
        except Exception as e:
            logger.warning("[ContextSummarize] LLM summarization failed: %s", e)
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

    _format_turns_text = staticmethod(format_turns_text)

    _build_summary_messages = staticmethod(build_summary_messages)

    def _summarize_or_flush(self, discarded_turns: list[dict]) -> list[dict]:
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
                    messages=omit_image_data(discarded_messages),
                    reason="trim",
                    max_messages=0,
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
            logger.info(
                "Context turns exceeded: keeping %s, removing %s", keep_count, removed_count
            )

            summary_messages = self._summarize_or_flush(discarded_turns)

        context_window = self.agent._get_model_context_window()
        if self.agent.max_context_tokens:
            max_tokens = self.agent.max_context_tokens
        else:
            reserve_tokens = int(context_window * 0.1)
            max_tokens = context_window - reserve_tokens

        system_tokens = self.agent._estimate_message_tokens(
            {"role": "system", "content": self.system_prompt}
        )
        summary_tokens = sum(self.agent._estimate_message_tokens(m) for m in summary_messages)
        current_tokens = sum(self._estimate_turn_tokens(turn) for turn in turns)

        if current_tokens + system_tokens + summary_tokens <= max_tokens:
            new_messages = list(summary_messages)
            for turn in turns:
                new_messages.extend(turn["messages"])
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
            logger.info("Compressed all turns to text-only (%s turns)", len(turns))
            return

        removed_count = len(turns) // 2
        keep_count = len(turns) - removed_count
        discarded_turns = turns[:removed_count]
        kept_turns = turns[-keep_count:]

        logger.info(
            "Token limit exceeded: keeping %s turns, removing %s", keep_count, removed_count
        )

        extra_summary = self._summarize_or_flush(discarded_turns)

        new_messages = summary_messages + extra_summary
        for turn in kept_turns:
            new_messages.extend(turn["messages"])
        self.messages = new_messages

    def _prepare_messages(self) -> list[dict[str, Any]]:
        """准备发送给 LLM 的消息列表（不含系统提示词，由 provider 单独处理）"""
        return self.messages
