"""Agent 智能体核心类

Agent 是系统的核心组件，负责：
- 管理对话历史和上下文
- 协调 LLM 调用与工具执行
- 集成技能系统、记忆系统和工具系统
- 估算 token 消耗并进行上下文裁剪
"""

import copy
import json
import logging
import threading
import weakref
from pathlib import Path
from typing import Any

from app.core.agent.delegation_runtime import DelegationRuntime
from app.core.agent.executor import AgentStreamExecutor
from app.core.agent.input_channel import AgentInputChannel
from app.core.agent.models import LLMModel
from app.core.agent.result import AgentAction, AgentActionType, ToolResultData
from app.core.agent.run_resources import Closeable, ResourceLease, RunResources
from app.core.tools.base_tool import BaseTool, ToolStage

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
        tools: list[BaseTool] | None = None,
        max_steps: int = 100,
        max_context_tokens: int | None = None,
        max_context_turns: int = 30,
        memory_manager=None,
        workspace_dir: str | None = None,
        skill_manager=None,
        enable_skills: bool = True,
        multi_agent_depth: int = 0,
        settings: Any = None,
        runtime_resources: Closeable | None = None,
        user_id: str | None = None,
    ):
        self.system_prompt = system_prompt  # 系统提示词
        self.model: LLMModel = model  # LLM 模型实例
        self.max_steps = max_steps  # 最大工具调用轮数
        self.max_context_tokens = max_context_tokens  # 上下文 token 上限
        self.max_context_turns = max_context_turns  # 上下文对话轮数上限
        self.captured_actions: list[AgentAction] = []  # 已捕获的动作记录
        self.messages: list[dict] = []  # 对话消息历史
        self.messages_lock = threading.Lock()  # 消息列表线程锁
        self.memory_manager = memory_manager  # 记忆管理器
        self.workspace_dir = workspace_dir  # 工作空间目录
        self.enable_skills = enable_skills  # 是否启用技能
        self.active_skill_filter = None  # 当前请求允许读取的技能集合
        self.active_cancel_event = None
        self.input_channel: AgentInputChannel | None = None
        self.active_thinking_enabled = False
        self.delegation_runtime: DelegationRuntime | None = None
        self.multi_agent_depth = multi_agent_depth  # 多 Agent 委派深度
        self.settings = settings  # 当前请求/用户的有效配置
        self.user_id = user_id
        # 装配器借出的资源只归此 Agent 所有；未执行的实例也能释放租约。
        self._runtime_resources = (
            RunResources(runtime_resources) if runtime_resources is not None else None
        )
        self._runtime_finalizer = (
            weakref.finalize(self, self._runtime_resources.close)
            if self._runtime_resources is not None
            else None
        )
        self.last_evidence: list[dict[str, Any]] = []
        self.last_sources: list[dict[str, Any]] = []
        self.last_rendered_images: list[dict[str, Any]] = []

        # 技能管理器（从 Markdown 文件加载技能定义）
        self.skill_manager = None
        if enable_skills:
            self.skill_manager = skill_manager

        # 注册工具
        self.tools: list[BaseTool] = []
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
            logger.warning("Failed to build skills prompt: %s", e)
            return ""

    def get_memory_prompt(self) -> str:
        """获取长期记忆检索策略提示词。"""
        if not self.memory_manager:
            return ""
        return """<long_term_memory_policy>
Long-term memory is available through the memory_search and memory_get tools.

Use memory_search proactively before answering when the request may depend on prior context, including:
- the user's preferences, holdings, watchlists, risk tolerance, recurring workflows, saved configurations, or prior decisions;
- follow-up wording such as "continue", "last time", "之前", "上次", "我的", "按老规则", or similar references;
- tasks where personalization or continuity would materially improve the answer.

    Use targeted queries based on the current request. If search results are relevant but snippets are insufficient, use memory_get to read the cited file and line range. Do not claim to remember private facts unless they are present in the current conversation or retrieved from memory in this turn. If no relevant memory is found, continue normally without over-explaining the miss.
    </long_term_memory_policy>"""

    def get_workspace_prompt(self) -> str:
        """每次请求重申真实工作目录，避免把上下文/子进程重建误判为文件丢失。"""
        if not self.workspace_dir:
            return ""
        workspace = str(Path(self.workspace_dir).expanduser().resolve())
        available = {tool.name for tool in self.tools if tool.stage == ToolStage.PRE_PROCESS}
        parts = [
            "<workspace_context>",
            f"Current on-disk workspace (absolute path, JSON string): "
            f"{json.dumps(workspace, ensure_ascii=False)}",
            "This is the configured workspace for this Agent. Relative file paths for "
            "read_file, write_file, view_image, and render_image, when available, refer to this "
            "directory, as does the initial working directory of each bash call. Other tools "
            "use the path rules in their own descriptions. "
            "Keep paths inside this workspace; do not assume paths from another environment "
            "such as /mnt/data are available here.",
            "Continuing a conversation creates a new Agent instance and restores saved chat "
            "messages. Earlier tool calls, outputs, and in-memory variables may be absent from "
            "that history. A new Agent instance, context compaction, or a backend process restart "
            "does not itself delete files saved in this on-disk workspace. Files can be reused "
            "across turns while the same workspace and underlying storage remain available.",
            "Do not infer that files were lost or that a process reset occurred from missing "
            "conversation context. Before reporting a file missing or recreating prior work, "
            "verify the exact path with available tools. A failed lookup establishes only what "
            "that tool actually checked; it does not prove that the whole workspace was cleared "
            "or explain why a file is missing. Distinguish a missing path, access denial, and "
            "an unavailable tool. If the cause is unknown, say so.",
            "Save scripts, data snapshots, intermediate results, and final artifacts needed "
            "for later turns inside this workspace. Temporary directories such as /tmp may be "
            "cleaned up and are not reliable storage for continued work. Include reusable "
            "artifact paths in the final response so subsequent turns can locate them.",
        ]
        if "bash" in available:
            parts.append(
                "bash is available. Each call starts a separate shell process in the workspace; "
                "cd changes, exported variables, and Python variables do not carry over to the "
                "next call, but files written to disk do. Use workspace-relative paths or an "
                "explicit cd in each command. On continuation, use targeted, read-only directory "
                "or file checks to locate earlier artifacts before recreating them."
            )
        if "read_file" in available:
            parts.append(
                "read_file is available: read the known workspace-relative or absolute path "
                "to verify and reuse an existing text artifact."
            )
        if "view_image" in available:
            parts.append(
                "view_image is available: reopen an existing image by its workspace path "
                "when visual inspection is needed."
            )
        if not available.intersection({"bash", "read_file", "view_image"}):
            parts.append(
                "Built-in workspace inspection tools (bash, read_file, view_image) are "
                "unavailable to this Agent. Use another available tool only if its declared "
                "scope supports checking this workspace. Otherwise state that file existence "
                "cannot currently be verified; do not claim that files are lost or bypass "
                "the tool permissions."
            )
        parts.append("</workspace_context>")
        return "\n\n".join(parts)

    def get_multi_agent_prompt(self) -> str:
        """获取多 Agent 委派策略提示词。"""
        if self.multi_agent_depth > 0 or not any(
            tool.name == "delegate_agent" for tool in self.tools
        ):
            return ""
        settings = self.settings
        if settings is None:
            try:
                from app.config import get_settings

                settings = get_settings()
            except Exception:
                return ""
        if not getattr(settings, "multi_agent_enabled", False):
            return ""

        if int(getattr(settings, "multi_agent_max_depth", 1) or 0) == 0:
            return ""
        roles = getattr(settings, "multi_agent_roles", {}) or {}
        available = {tool.name for tool in self.tools} - {"delegate_agent"}
        dangerous = set(getattr(settings, "multi_agent_dangerous_tools", []) or [])
        role_lines = []
        for name, role in roles.items():
            if not isinstance(role, dict):
                continue
            description = role.get("description", "")
            tools = role.get("tool_allowlist", [])
            tool_names = (
                [tool for tool in tools if tool in available] if isinstance(tools, list) else []
            )
            if role.get("allow_all_mcp_tools"):
                tool_names.extend(sorted(tool for tool in available if tool.startswith("mcp_")))
            tool_names = list(
                dict.fromkeys(
                    tool
                    for tool in tool_names
                    if role.get("allow_dangerous_tools") or tool not in dangerous
                )
            )
            tools_text = ", ".join(tool_names) if tool_names else "(none)"
            role_lines.append(f"- {name}: {description} Tools: {tools_text}")

        roles_text = "\n".join(role_lines) if role_lines else "- No sub-agent roles configured."
        return f"""<multi_agent_delegation_policy>
You can use the delegate_agent tool for complex tasks that benefit from independent research, parallel analysis, or critique.

Use delegation when the request has separable workstreams, such as fundamentals vs. technicals vs. risks. Do not delegate simple factual or single-step questions.
Sub-agents are isolated workers: they return findings to you, and you remain responsible for the final answer. Ask sub-agents for concise, evidence-grounded briefs.
Submit up to {getattr(settings, "multi_agent_max_tasks_per_batch", 12)} tasks per batch; up to {getattr(settings, "multi_agent_max_parallel_agents", 3)} children may run at once across all of your batches. Extra tasks queue. Each child has {getattr(settings, "multi_agent_task_timeout_seconds", 180)} seconds of execution time.
Give tasks unique ids. Use depends_on for review/synthesis tasks that need earlier results; prerequisites may be listed in any order, and failed prerequisites skip their dependents.
Use shared_context to provide the objective, constraints, as-of time, source references and a common data snapshot. Children do not inherit this conversation. Do not ask multiple children to refetch the same snapshot unnecessarily.
Child tools are limited to the available names below; skill visibility can only narrow your own scope. Check every task status, source reference and truncation notice. Reconcile conflicting findings before writing the final answer. A timeout does not prove an external side effect was rolled back; never blindly repeat side-effecting work.
Available sub-agent roles:
{roles_text}
</multi_agent_delegation_policy>"""

    def get_rendering_prompt(self) -> str:
        """按实际可用工具注入制图策略，兼容旧配置和子 Agent 的权限裁剪。"""
        available = {tool.name for tool in self.tools if tool.stage == ToolStage.PRE_PROCESS}
        if not available.intersection({"render_image", "view_image", "bash", "write_file"}):
            return ""

        parts = [
            "<image_rendering_policy>",
            "For static reports, data charts, dashboards exported as images, and infographics, "
            "prefer render_image with HTML/CSS/inline SVG when available. Do not default to bash, "
            "Python, Matplotlib, Pillow, browser screenshot scripts, or other shell commands "
            "to draw, rasterize, crop, or upscale the image, even if an older skill suggests them. "
            "Bash may still be used for data processing and calculations. If the user explicitly "
            "requests plotting code or a different rendering workflow, follow that request with "
            "available tools. For a requirement that static HTML/SVG truly cannot support, "
            "explain the limitation before choosing an appropriate available alternative. "
            "A missing tool or a rendering error alone is not a reason to silently switch to bash.",
        ]
        if "render_image" in available:
            parts.append(
                "render_image is available: call it with a self-contained static HTML fragment "
                "in html, using CSS and inline SVG. Prefer passing html directly; do not create "
                "a helper script or install plotting packages to prepare it. Use html_path only "
                "for an existing workspace HTML fragment, or prepare that fragment with "
                "write_file if available. Use the same data snapshot, sources, timestamp and "
                "units for prose and chart. Inspect layout.issues and fix the HTML/SVG before "
                "rendering again. For missing rendering dependencies or Chromium, report the "
                "tool's setup instructions; do not silently install packages or replace the "
                "renderer with a shell script. Never claim an image was generated after a "
                "failed render. This tool renders static content; it is not a generative image "
                "model for photographs or artwork. Use an appropriate available image tool "
                "for those requests, or explain the capability limitation."
            )
            if "view_image" in available:
                parts.append(
                    "After a successful render_image, use view_image on the final PNG, the "
                    "top/middle/bottom review crops and the mobile preview. Check Chinese text, "
                    "labels, units, clipping, readability and numerical consistency; fix and "
                    "render again when needed. If visual inspection fails, state that it is "
                    "incomplete; metadata and layout diagnostics alone cannot prove visual quality."
                )
            else:
                parts.append(
                    "view_image is not available to this Agent. You may render the image, but "
                    "must state that visual inspection is incomplete; do not claim the result "
                    "has been visually verified or use a shell workaround to inspect it."
                )
        else:
            parts.append(
                "render_image is not available to this Agent; do not call it. If another "
                "dedicated image/chart tool is available, including an MCP tool, use it only "
                "when its declared capabilities fit the request. Otherwise follow the "
                "missing-tool guidance below."
            )
            if self.multi_agent_depth > 0:
                parts.append(
                    "When no suitable rendering tool is available, return the data snapshot, "
                    "sources and layout requirements to the parent "
                    "Agent so it can handle rendering with its own available tools. Do not "
                    "bypass your tool permissions or ask the user to expand a child role."
                )
            else:
                parts.append(
                    "For a static image request without another suitable tool, explain that "
                    "local rendering is not enabled "
                    "and point to the Agent tool configuration to enable render_image and "
                    "view_image. Existing saved allowlists do not automatically gain new tools. "
                    "Do not change tool permissions yourself."
                )
        parts.append("</image_rendering_policy>")
        return "\n\n".join(parts)

    def get_full_system_prompt(self, skill_filter=None) -> str:
        """构建完整的系统提示词（基础提示词 + 技能提示词）"""
        parts = [self.system_prompt]
        memory_prompt = self.get_memory_prompt()
        if memory_prompt:
            parts.append(memory_prompt)
        multi_agent_prompt = self.get_multi_agent_prompt()
        if multi_agent_prompt:
            parts.append(multi_agent_prompt)
        parts.append("""<evidence_and_citation_policy>
When tool results include evidence or sources metadata:
- treat source, publication time, as-of time, fetch time, and stale state as part of the claim;
- cite external web sources with descriptive Markdown links placed immediately after the supported claim;
- cite user knowledge with its file name and exact line range;
- never invent a URL, timestamp, locator, or source that the tool did not return;
- clearly separate verified facts/data from inference and opinion;
- if a material claim cannot be verified, label it as unverified instead of presenting it as fact.
</evidence_and_citation_policy>""")
        skills_prompt = self.get_skills_prompt(skill_filter=skill_filter)
        if skills_prompt:
            parts.append(skills_prompt)
        # 运行时目录和生命周期不依赖持久化提示词，主/子 Agent 都使用当前有效工作区。
        workspace_prompt = self.get_workspace_prompt()
        if workspace_prompt:
            parts.append(workspace_prompt)
        if self.input_channel is not None:
            parts.append("""<conversation_steering_policy>
The user may send additional instructions while this task is running. They arrive as user
messages between model calls in the same task. Treat them as updates to the current objective;
retain earlier requirements unless the user explicitly replaces or cancels them. Reuse the
tool results and work already completed. Do not repeat side effects just because a new message
arrived. Acknowledge relevant changes in your next response and account for all applied user
messages in the final answer. Work already performed cannot be undone by a steering message.
</conversation_steering_policy>""")
        # 运行时追加，避免旧的持久化系统提示词或技能仍把制图导向通用 shell。
        rendering_prompt = self.get_rendering_prompt()
        if rendering_prompt:
            parts.append(rendering_prompt)
        return "\n\n".join(parts)

    def _get_model_context_window(self) -> int:
        """根据模型名称自动推断上下文窗口大小

        支持的模型：
        - Claude 3/3.5/3.7: 200K
        - GPT-4 Turbo: 128K
        - GPT-4: 8K-32K
        - DeepSeek: 64K
        - GLM-5.1: 200K
        - 默认: 128K
        """
        if self.model and hasattr(self.model, "model"):
            model_name = self.model.model.lower()
            if "claude-3" in model_name or "claude-sonnet" in model_name:
                return 200000
            elif "gpt-4" in model_name:
                if "turbo" in model_name or "128k" in model_name:
                    return 128000
                elif "32k" in model_name:
                    return 32000
                else:
                    return 8000
            elif "glm-5.3" in model_name:
                return 1000000
            elif "gpt-3.5" in model_name:
                return 16000 if "16k" in model_name else 4000
            elif "deepseek" in model_name:
                return 64000
        return 1000000  # 保守默认值

    def _get_context_reserve_tokens(self) -> int:
        """获取上下文预留 token 数（约 10%，用于模型生成回复）"""
        context_window = self._get_model_context_window()
        reserve = int(context_window * 0.1)
        return max(10000, min(1000000, reserve))

    def _estimate_message_tokens(self, message: dict) -> int:
        """估算单条消息的 token 消耗

        按内容块类型分别计算：
        - text: 按 CJK 1.5 token/字符、ASCII 0.25 token/字符估算
        - image: 固定 1200 token
        - tool_use: 结构开销 50 + 输入参数 token
        - tool_result: 结构开销 30 + 结果内容 token
        """
        content = message.get("content", "")
        if isinstance(content, str):
            return max(1, self._estimate_text_tokens(content))
        elif isinstance(content, list):
            total_tokens = 0
            for part in content:
                if not isinstance(part, dict):
                    continue
                block_type = part.get("type", "")
                if block_type == "text":
                    total_tokens += self._estimate_text_tokens(part.get("text", ""))
                elif block_type == "image":
                    total_tokens += 1200
                elif block_type == "tool_use":
                    total_tokens += 50  # 工具调用结构开销
                    input_data = part.get("input", {})
                    if isinstance(input_data, dict):
                        input_str = json.dumps(input_data, ensure_ascii=False)
                        total_tokens += self._estimate_text_tokens(input_str)
                elif block_type == "tool_result":
                    total_tokens += 30  # 工具结果结构开销
                    result_content = part.get("content", "")
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

    def _find_tool(self, tool_name: str) -> BaseTool | None:
        """按名称查找工具（仅返回可主动调用的 PRE_PROCESS 阶段工具）"""
        for tool in self.tools:
            if tool.name == tool_name:
                if tool.stage == ToolStage.PRE_PROCESS:
                    tool.model = self.model
                    return tool
                return None
        return None

    def capture_tool_use(
        self,
        tool_name,
        input_params,
        output,
        status,
        thought=None,
        error_message=None,
        execution_time=0.0,
    ):
        """记录一次工具调用动作，用于追踪和调试"""
        tool_result = ToolResultData(
            tool_name=tool_name,
            input_params=input_params,
            output=output,
            status=status,
            error_message=error_message,
            execution_time=execution_time,
        )
        action = AgentAction(
            agent_id=str(id(self)),
            agent_name="Agent",
            action_type=AgentActionType.TOOL_USE,
            tool_result=tool_result,
            thought=thought,
        )
        self.captured_actions.append(action)
        return action

    def borrow_runtime_resources(self) -> ResourceLease | None:
        return self._runtime_resources.retain() if self._runtime_resources is not None else None

    def close(self) -> None:
        if self._runtime_finalizer is not None:
            self._runtime_finalizer()

    def run_stream(
        self,
        user_message: str,
        on_event=None,
        clear_history: bool = False,
        skill_filter=None,
        cancel_event=None,
        thinking_enabled: bool = False,
    ) -> str:
        try:
            return self._run_stream(
                user_message, on_event, clear_history, skill_filter, cancel_event, thinking_enabled
            )
        finally:
            self.close()

    def _run_stream(
        self,
        user_message: str,
        on_event=None,
        clear_history: bool = False,
        skill_filter=None,
        cancel_event=None,
        thinking_enabled: bool = False,
    ) -> str:
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
            thinking_enabled: 是否向模型请求推理/思考模式

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
            messages_copy = copy.deepcopy(self.messages)
            original_length = len(self.messages)

        previous_skill_filter = self.active_skill_filter
        previous_cancel_event = self.active_cancel_event
        previous_thinking_enabled = self.active_thinking_enabled
        previous_delegation_runtime = self.delegation_runtime
        runtime = DelegationRuntime(
            max(1, int(getattr(self.settings, "multi_agent_max_parallel_agents", 3) or 1))
        )
        self.active_skill_filter = set(skill_filter) if skill_filter is not None else None
        self.active_cancel_event = cancel_event
        self.active_thinking_enabled = thinking_enabled
        self.delegation_runtime = runtime

        executor = None
        try:
            # 每轮运行重新创建共享容量，取消与思考设置随工具调用传给子 Agent。
            executor = AgentStreamExecutor(
                agent=self,
                model=self.model,
                system_prompt=full_system_prompt,
                tools=self.tools,
                max_turns=self.max_steps,
                on_event=on_event,
                messages=messages_copy,
                max_context_turns=self.max_context_turns,
                cancel_event=cancel_event,
                thinking_enabled=thinking_enabled,
            )
            response = executor.run_stream(user_message)
        finally:
            if executor is not None:
                # 子任务失败或取消后，已取得的来源与图像仍应交给父任务复用。
                self.stream_executor = executor
                self.last_evidence = list(executor.evidence)
                self.last_sources = list(executor.sources)
                self.last_rendered_images = list(executor.rendered_images)
            self.active_skill_filter = previous_skill_filter
            self.active_cancel_event = previous_cancel_event
            self.active_thinking_enabled = previous_thinking_enabled
            self.delegation_runtime = previous_delegation_runtime

        # 将执行器的消息列表同步回 Agent（可能已被裁剪）
        with self.messages_lock:
            self.messages = list(executor.messages)
            trim_adjusted_start = min(original_length, len(executor.messages))
            self._last_run_new_messages = list(executor.messages[trim_adjusted_start:])

        return response

    def clear_history(self):
        """清空对话历史和动作记录"""
        self.messages = []
        self.captured_actions = []
