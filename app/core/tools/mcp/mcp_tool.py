"""MCP（Model Context Protocol）工具适配器。

将外部 MCP 服务器提供的工具包装为内部 BaseTool 实例，
支持 streamable_http、SSE、stdio 三种传输模式及 OAuth 鉴权。
"""

from __future__ import annotations

import asyncio
import logging
import shutil
import threading
from typing import Any, Dict, List, Optional

from app.core.tools.base_tool import BaseTool, ToolResult
from app.core.tools.mcp.config import (
    LEGACY_SSE_TRANSPORT,
    STANDARD_HTTP_TRANSPORT,
    STDIO_TRANSPORT,
    is_mcp_server_enabled,
    normalize_mcp_servers,
    normalize_transport,
)
from app.core.tools.mcp.errors import MCPErrorFormatterMixin
from app.core.tools.mcp.oauth import MCPOAuthMixin
from app.core.tools.mcp.token_store import MCPTokenStore

logger = logging.getLogger("stocks-assistant.mcp")


class MCPToolAdapter(BaseTool):
    """将单个 MCP 服务器工具包装为 BaseTool 实例。

    每个工具对应 MCP 服务器中的一个可调用工具。
    """

    name: str = "mcp_tool"
    description: str = "MCP tool adapter"
    params: dict = {"type": "object", "properties": {}}

    def __init__(
        self,
        server_name: str,
        tool_name: str,
        tool_description: str,
        tool_schema: dict,
        manager: "MCPManager",
    ):
        super().__init__()
        self.server_name = server_name
        self.tool_name = tool_name
        # 工具名格式： mcp_{server_name}_{tool_name}
        self.name = f"mcp_{server_name}_{tool_name}"
        self.description = tool_description
        self.params = tool_schema.get("inputSchema", {"type": "object", "properties": {}})
        self._manager = manager

    def execute(self, params: dict) -> ToolResult:
        """\u540c\u6b65执行 MCP 工具调用，内部将异步调用托管给 MCPManager。"""
        try:
            result = self._manager.call_tool_sync(self.server_name, self.tool_name, params)
            return ToolResult.success(result)
        except Exception as e:
            error = self._manager._format_tool_error(e)
            logger.warning(
                "MCP tool '%s' on server '%s' failed: %s",
                self.tool_name,
                self.server_name,
                error,
            )
            logger.debug("MCP tool exception detail", exc_info=True)
            return ToolResult.fail(f"MCP tool error: {error}")


class MCPManager(MCPOAuthMixin, MCPErrorFormatterMixin):
    """管理所有 MCP 服务器连接并内居已发现工具。

    内部在一个独立守护线程上运行一个持久异步事件循环，
    以实现长连接和工具调用。对外提供同步接口。
    """

    def __init__(
        self,
        server_configs: Dict[str, Dict[str, Any]],
        workspace_dir: Optional[str] = None,
        tool_timeout_seconds: float = 60.0,
        user_id: Optional[str] = None,
    ):
        # 对配置字典进行归一化处理
        self.server_configs = normalize_mcp_servers(server_configs)
        self.tool_timeout_seconds = self._normalize_tool_timeout(tool_timeout_seconds)
        # 持久化令牌存储（传入 workspace_dir 时启用）
        self._token_store = MCPTokenStore(workspace_dir, user_id=user_id) if workspace_dir else None
        self.user_id = user_id
        # 已发现工具映射：工具全名 -> MCPToolAdapter
        self.tools: Dict[str, MCPToolAdapter] = {}
        # 已建立的客户端会话：服务器名 -> ClientSession
        self._sessions: Dict[str, Any] = {}
        # 连接错误信息：服务器名 -> 错误描述
        self._errors: Dict[str, str] = {}
        # 连接状态：服务器名 -> connecting/connected/disconnected/error/auth_required
        self._states: Dict[str, str] = {}
        # 各服务器异步连接任务
        self._tasks: Dict[str, asyncio.Task] = {}
        # 各服务器连接超时监控任务
        self._timeout_tasks: Dict[str, asyncio.Task] = {}
        # 后台连接/重连调度 Future
        self._background_futures: List[Any] = []
        # 用于优雅关闭连接的停止事件
        self._stop_events: Dict[str, asyncio.Event] = {}
        # OAuth Client Credentials 令牌缓存：服务器名 -> (token, 过期时间戳)
        self._oauth_tokens: Dict[str, tuple[str, float]] = {}
        # OAuth Authorization Code 登录令牌：服务器名 -> OAuthToken
        self._oauth_login_tokens: Dict[str, Any] = {}
        # OAuth 已注册客户端信息
        self._oauth_client_infos: Dict[str, Any] = {}
        # 待用户打开的 OAuth 授权 URL
        self._oauth_authorization_urls: Dict[str, str] = {}
        # 等待 OAuth 授权 URL 就绪的 Future
        self._oauth_authorization_ready: Dict[str, asyncio.Future] = {}
        # 等待 OAuth 回调的 Future
        self._oauth_callback_futures: Dict[str, asyncio.Future] = {}
        # 后台异步事件循环
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        # 运行事件循环的守护线程
        self._thread: Optional[threading.Thread] = None
        # 保护共享状态的可重入锁
        self._lock = threading.RLock()
        # 启动时从磁盘恢复令牌
        self._restore_tokens()

    # ------------------------------------------------------------------ loop

    def _ensure_loop(self) -> asyncio.AbstractEventLoop:
        """确保后台事件循环已启动，若未启动则创建守护线程运行之。"""
        if self._loop and self._loop.is_running():
            return self._loop

        ready = threading.Event()

        def run_loop():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            self._loop = loop
            ready.set()
            loop.run_forever()
            loop.close()

        self._thread = threading.Thread(target=run_loop, name="mcp-manager-loop", daemon=True)
        self._thread.start()
        ready.wait(timeout=5)
        if not self._loop:
            raise RuntimeError("failed to start MCP event loop")
        return self._loop

    def _run_sync(self, coro, timeout: Optional[float] = None):
        """在后台循环中运行异步协程，并同步等待结果（限时可选）。"""
        loop = self._ensure_loop()
        future = asyncio.run_coroutine_threadsafe(coro, loop)
        return future.result(timeout=timeout)

    def _run_background(self, coro, label: str):
        """在后台循环中调度协程，不等待结果。"""
        loop = self._ensure_loop()
        future = asyncio.run_coroutine_threadsafe(coro, loop)
        with self._lock:
            self._background_futures.append(future)

        def log_result(done):
            with self._lock:
                if done in self._background_futures:
                    self._background_futures.remove(done)
            if done.cancelled():
                return
            try:
                done.result()
            except Exception as exc:
                logger.warning(f"{label} failed: {exc}")

        future.add_done_callback(log_result)
        return future

    # ------------------------------------------------------------------ public

    def connect_all_sync(self, wait: bool = False, timeout: Optional[float] = None):
        """同步地对所有已配置的 MCP 服务器发起连接。wait=True 时限时等待连接就绪。"""
        return self._run_sync(self.connect_all(wait=wait, timeout=timeout), timeout=timeout)

    def connect_all_background(self, wait: bool = False, timeout: Optional[float] = None):
        """后台发起所有 MCP 服务器连接，不阻塞调用方。"""
        with self._lock:
            for name, config in self.server_configs.items():
                self._states[name] = "connecting" if is_mcp_server_enabled(config) else "disabled"
                self._errors.pop(name, None)
        return self._run_background(
            self.connect_all(wait=wait, timeout=timeout),
            "Background MCP connection",
        )

    def reconnect_sync(
        self,
        server_configs: Dict[str, Dict[str, Any]],
        wait: bool = False,
        timeout: Optional[float] = None,
    ):
        """更新服务器配置并重新建立所有连接。"""
        self.server_configs = normalize_mcp_servers(server_configs)
        return self.connect_all_sync(wait=wait, timeout=timeout)

    def reconnect_background(
        self,
        server_configs: Dict[str, Dict[str, Any]],
        wait: bool = False,
        timeout: Optional[float] = None,
    ):
        """后台更新服务器配置并重新连接，不阻塞调用方。"""
        self.server_configs = normalize_mcp_servers(server_configs)
        return self.connect_all_background(wait=wait, timeout=timeout)

    def close_sync(self):
        """同步关闭所有连接并停止后台事件循环。"""
        if not self._loop:
            return
        with self._lock:
            background_futures = list(self._background_futures)
        for future in background_futures:
            future.cancel()
        try:
            self._run_sync(self.close(), timeout=5)
        except Exception:
            logger.warning("Timed out while closing MCP manager")
        finally:
            if self._loop and self._loop.is_running():
                self._loop.call_soon_threadsafe(self._loop.stop)

    def get_server_state(self, server_name: str) -> tuple[str, Optional[str], int, Optional[str]]:
        """返回指定服务器的状态元组：(state, error_msg, tool_count, oauth_url)。"""
        with self._lock:
            prefix = f"mcp_{server_name}_"
            tools_count = sum(1 for name in self.tools if name.startswith(prefix))
            config = self.server_configs.get(server_name)
            if config is not None and not is_mcp_server_enabled(config):
                return "disabled", None, 0, None
            state = self._states.get(
                server_name,
                "connected" if server_name in self._sessions else "disconnected",
            )
            return state, self._errors.get(server_name), tools_count, self._oauth_authorization_urls.get(server_name)

    def call_tool_sync(self, server_name: str, tool_name: str, params: dict):
        """同步调用指定 MCP 服务器的工具并返回结果。"""
        timeout = self._get_tool_timeout(server_name)
        return self._run_sync(self._call_tool(server_name, tool_name, params), timeout=timeout + 5)

    def set_tool_timeout_seconds(self, timeout: float) -> None:
        """更新默认 MCP 工具调用超时，用于运行时配置热更新。"""
        self.tool_timeout_seconds = self._normalize_tool_timeout(timeout)

    def start_oauth_authorization_sync(self, server_name: str, redirect_uri: str, timeout: float = 20) -> str:
        """为指定服务器启动 OAuth Authorization Code 授权流程，返回授权 URL。"""
        return self._run_sync(
            self.start_oauth_authorization(server_name, redirect_uri, timeout=timeout),
            timeout=timeout + 5,
        )

    def complete_oauth_callback_sync(
        self,
        server_name: str,
        code: Optional[str],
        state: Optional[str],
        error: Optional[str] = None,
    ) -> None:
        """将 OAuth 回调参数注入持待的 Future，完成授权流程。"""
        return self._run_sync(self.complete_oauth_callback(server_name, code, state, error))

    def clear_oauth_credentials_sync(self, server_name: str) -> None:
        """停止指定服务器并清除 OAuth 相关缓存和持久化数据。"""
        return self._run_sync(self.clear_oauth_credentials(server_name))

    async def connect_all(self, wait: bool = False, timeout: Optional[float] = None):
        """异步关闭并重建所有 MCP 服务器连接。"""
        await self.close()

        with self._lock:
            # 重置所有共享状态
            self.tools = {}
            self._sessions = {}
            self._errors = {}
            self._oauth_authorization_urls = {}
            self._states = {
                name: "disconnected" if is_mcp_server_enabled(config) else "disabled"
                for name, config in self.server_configs.items()
            }

        for server_name, config in self.server_configs.items():
            if not is_mcp_server_enabled(config):
                continue
            try:
                await self._connect_server(server_name, config, wait=wait, timeout=timeout)
            except Exception as e:
                error = self._format_connect_error(e)
                with self._lock:
                    self._errors[server_name] = error
                    self._states[server_name] = "error"
                logger.warning(f"Failed to connect MCP server '{server_name}': {error}")

    async def _connect_server(
        self,
        server_name: str,
        config: dict,
        wait: bool = False,
        timeout: Optional[float] = None,
    ):
        """为单个 MCP 服务器创建异步连接任务。

        wait=True 时则限时异步等待连接就绪；
        否则后台启动一个连接超时监联任务。
        """
        if not is_mcp_server_enabled(config):
            await self._stop_server(server_name)
            with self._lock:
                self._errors.pop(server_name, None)
                self._states[server_name] = "disabled"
            return
        stop_event = asyncio.Event()
        ready: asyncio.Future = asyncio.get_running_loop().create_future()
        ready.add_done_callback(lambda future: future.exception() if not future.cancelled() else None)
        task = asyncio.create_task(self._run_server(server_name, config, stop_event, ready))
        with self._lock:
            self._tasks[server_name] = task
            self._stop_events[server_name] = stop_event
            self._states[server_name] = "connecting"
            self._errors.pop(server_name, None)
        connect_timeout = timeout or float(config.get("connect_timeout", 10))
        if wait:
            try:
                await asyncio.wait_for(ready, timeout=connect_timeout)
            except asyncio.TimeoutError:
                with self._lock:
                    self._states[server_name] = "error"
                    self._errors[server_name] = f"MCP connection timed out after {connect_timeout:.0f}s"
                task.cancel()
        else:
            # 默认异步连接：后台启动超时监联协程
            timeout_task = asyncio.create_task(self._connection_timeout(server_name, ready, task, connect_timeout))
            with self._lock:
                old_timeout_task = self._timeout_tasks.get(server_name)
                if old_timeout_task and not old_timeout_task.done():
                    old_timeout_task.cancel()
                self._timeout_tasks[server_name] = timeout_task

    async def _stop_server(self, server_name: str):
        """优雅停止指定服务器的连接任务，并清理其相关状态。"""
        stop_event = self._stop_events.pop(server_name, None)
        task = self._tasks.pop(server_name, None)
        timeout_task = self._timeout_tasks.pop(server_name, None)
        if stop_event:
            stop_event.set()
        if timeout_task and not timeout_task.done():
            timeout_task.cancel()
            await asyncio.gather(timeout_task, return_exceptions=True)
        if task:
            try:
                await asyncio.wait_for(asyncio.gather(task, return_exceptions=True), timeout=3)
            except asyncio.TimeoutError:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)

        with self._lock:
            self._sessions.pop(server_name, None)
            for name in [name for name in self.tools if name.startswith(f"mcp_{server_name}_")]:
                self.tools.pop(name, None)
            self._oauth_authorization_urls.pop(server_name, None)
            ready = self._oauth_authorization_ready.pop(server_name, None)
            if ready and not ready.done():
                ready.cancel()
            callback = self._oauth_callback_futures.pop(server_name, None)
            if callback and not callback.done():
                callback.cancel()
            self._states[server_name] = "disconnected"

    async def _connection_timeout(
        self,
        server_name: str,
        ready: asyncio.Future,
        task: asyncio.Task,
        timeout: float,
    ):
        """异步连接超时监联：超时后将状态设为 error 并取消任务。"""
        try:
            await asyncio.sleep(timeout)
            if ready.done():
                return
            with self._lock:
                if self._states.get(server_name) == "connecting":
                    self._states[server_name] = "error"
                    self._errors[server_name] = f"MCP connection timed out after {timeout:.0f}s"
            if not ready.done():
                ready.set_exception(RuntimeError(f"MCP connection timed out after {timeout:.0f}s"))
            task.cancel()
        finally:
            try:
                current = asyncio.current_task()
            except RuntimeError:
                current = None
            with self._lock:
                if self._timeout_tasks.get(server_name) is current:
                    self._timeout_tasks.pop(server_name, None)

    async def _run_server(
        self,
        server_name: str,
        config: dict,
        stop_event: asyncio.Event,
        ready: asyncio.Future,
    ):
        """运行单个服务器连接入口，处理常规成功/失败及连接清理。"""
        try:
            await self._run_server_connection(server_name, config, stop_event, ready)
            if not ready.done():
                ready.set_result(None)
        except Exception as exc:
            error = self._format_connect_error(exc)
            with self._lock:
                self._errors[server_name] = error
                self._states[server_name] = "error"
                self._sessions.pop(server_name, None)
            authorization_ready = self._oauth_authorization_ready.get(server_name)
            if authorization_ready and not authorization_ready.done():
                authorization_ready.set_exception(RuntimeError(error))
            if not ready.done():
                ready.set_exception(RuntimeError(error))
            logger.warning(f"MCP connect error for '{server_name}': {error}")
        finally:
            with self._lock:
                self._sessions.pop(server_name, None)
                if self._states.get(server_name) == "connected":
                    self._states[server_name] = "disconnected"

    async def _run_server_connection(
        self,
        server_name: str,
        config: dict,
        stop_event: asyncio.Event,
        ready: asyncio.Future,
    ):
        """根据传输类型建立具体的 MCP 客户端连接并持续到 stop_event 被设置。"""
        from mcp import ClientSession

        transport = normalize_transport(config.get("transport"), config)
        if transport == STANDARD_HTTP_TRANSPORT:
            # 标准可流式 HTTP 连接
            from mcp.client.streamable_http import streamablehttp_client

            headers = await self._build_http_headers(server_name, config)
            auth = self._build_oauth_authorization_provider(server_name, config, ready)
            async with streamablehttp_client(config["url"], headers=headers or None, auth=auth) as (read, write, _get_session_id):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    await self._discover_tools(server_name, session)
                    with self._lock:
                        self._sessions[server_name] = session
                        self._states[server_name] = "connected"
                        self._errors.pop(server_name, None)
                    if not ready.done():
                        ready.set_result(None)
                    await stop_event.wait()
        elif transport == LEGACY_SSE_TRANSPORT:
            # 旧式 SSE 连接
            from mcp.client.sse import sse_client

            headers = await self._build_http_headers(server_name, config)
            auth = self._build_oauth_authorization_provider(server_name, config, ready)
            async with sse_client(config["url"], headers=headers or None, auth=auth) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    await self._discover_tools(server_name, session)
                    with self._lock:
                        self._sessions[server_name] = session
                        self._states[server_name] = "connected"
                        self._errors.pop(server_name, None)
                    if not ready.done():
                        ready.set_result(None)
                    await stop_event.wait()
        elif transport == STDIO_TRANSPORT:
            # 本地进程标准输入输出连接
            from mcp.client.stdio import StdioServerParameters, stdio_client

            command = config.get("command", "")
            server_params = StdioServerParameters(
                command=shutil.which(command) or command,
                args=config.get("args", []),
                env=config.get("env"),
                cwd=config.get("cwd"),
            )
            async with stdio_client(server_params) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    await self._discover_tools(server_name, session)
                    with self._lock:
                        self._sessions[server_name] = session
                        self._states[server_name] = "connected"
                        self._errors.pop(server_name, None)
                    if not ready.done():
                        ready.set_result(None)
                    await stop_event.wait()
        else:
            raise ValueError(f"unsupported MCP transport: {transport}")

    def _format_connect_error(self, exc: BaseException) -> str:
        """将连接异常转换为简洁的错误描述字符串，对常见情况返回可读提示。"""
        def collect_messages(error: BaseException, seen: set[int]) -> list[str]:
            if id(error) in seen:
                return []
            seen.add(id(error))
            messages: list[str] = []
            if isinstance(error, BaseExceptionGroup):
                for item in error.exceptions:
                    messages.extend(collect_messages(item, seen))
            for linked in (getattr(error, "__cause__", None), getattr(error, "__context__", None)):
                if linked is not None:
                    messages.extend(collect_messages(linked, seen))
            message = str(error).strip()
            if message:
                messages.append(message)
            return messages

        messages = list(dict.fromkeys(collect_messages(exc, set())))
        message = "; ".join(messages) if messages else str(exc)
        lower = message.lower()
        if "401" in message or "unauthorized" in lower or "token" in lower:
            return "MCP authorization failed. Click Login to complete OAuth, or check the configured Bearer token."
        if "state parameter mismatch" in lower:
            return "MCP OAuth callback state mismatch. Restart OAuth login and try again."
        if "no pending oauth login" in lower:
            return message
        if "jsonrpcmessage" in lower or "non-json" in lower or "field required" in lower:
            return "MCP server returned a non JSON-RPC response. Check the MCP URL and authorization."
        if "unhandled errors in a taskgroup" in lower:
            return "MCP connection failed before the OAuth authorization URL was returned. Check the MCP URL and server authorization settings."
        if len(message) > 500:
            return message[:500] + "..."
        return message

    async def _discover_tools(self, server_name: str, session):
        """向 MCP 服务器查询工具列表，将发现的工具包装为 MCPToolAdapter 并更新注册表。"""
        if not is_mcp_server_enabled(self.server_configs.get(server_name)):
            with self._lock:
                for name in [name for name in self.tools if name.startswith(f"mcp_{server_name}_")]:
                    self.tools.pop(name, None)
                self._states[server_name] = "disabled"
            return
        result = await session.list_tools()
        discovered: dict[str, MCPToolAdapter] = {}
        for tool in result.tools:
            adapter = MCPToolAdapter(
                server_name=server_name,
                tool_name=tool.name,
                tool_description=tool.description or "",
                tool_schema={"inputSchema": tool.inputSchema} if hasattr(tool, 'inputSchema') else {},
                manager=self,
            )
            discovered[adapter.name] = adapter
            logger.debug(f"Discovered MCP tool: {adapter.name}")

        with self._lock:
            # 删除该服务器的旧工具，再写入新发现的工具
            for name in [name for name in self.tools if name.startswith(f"mcp_{server_name}_")]:
                self.tools.pop(name, None)
            self.tools.update(discovered)
        logger.info(f"Discovered {len(discovered)} MCP tool(s) from '{server_name}'")

    async def _call_tool(self, server_name: str, tool_name: str, params: dict):
        """异步调用指定服务器的工具，解析并返回文本内容或对象数据。"""
        session = self._sessions.get(server_name)
        if not session:
            raise RuntimeError(f"MCP server '{server_name}' is not connected")
        timeout = self._get_tool_timeout(server_name)
        try:
            result = await asyncio.wait_for(session.call_tool(tool_name, params), timeout=timeout)
        except asyncio.TimeoutError as exc:
            raise RuntimeError(
                f"MCP tool '{tool_name}' on server '{server_name}' timed out after {timeout:g}s"
            ) from exc
        if getattr(result, "isError", False):
            detail = self._format_call_tool_error_result(result)
            raise RuntimeError(f"MCP tool '{tool_name}' on server '{server_name}' returned an error: {detail}")
        if hasattr(result, "content"):
            # 提取所有文本内容
            texts = [c.text for c in result.content if hasattr(c, "text")]
            if texts:
                return "\n".join(texts)
            # 醉匹内容字典列表
            return [getattr(c, "model_dump", lambda: str(c))() for c in result.content]
        if hasattr(result, "model_dump"):
            return result.model_dump()
        return str(result)

    @staticmethod
    def _normalize_tool_timeout(value: Any) -> float:
        try:
            timeout = float(value)
        except (TypeError, ValueError):
            timeout = 60.0
        return max(0.001, timeout)

    def _get_tool_timeout(self, server_name: str) -> float:
        config = self.server_configs.get(server_name, {}) or {}
        server_timeout = (
            config.get("tool_timeout_seconds")
            or config.get("tool_timeout")
            or config.get("call_timeout_seconds")
            or config.get("call_timeout")
        )
        if server_timeout is not None:
            return self._normalize_tool_timeout(server_timeout)
        return self._normalize_tool_timeout(self.tool_timeout_seconds)

    async def close(self):
        timeout_tasks = list(self._timeout_tasks.values())
        for timeout_task in timeout_tasks:
            if not timeout_task.done():
                timeout_task.cancel()

        tasks = list(self._tasks.values()) + timeout_tasks
        for stop_event in self._stop_events.values():
            stop_event.set()
        if tasks:
            try:
                await asyncio.wait_for(asyncio.gather(*tasks, return_exceptions=True), timeout=3)
            except asyncio.TimeoutError:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
        with self._lock:
            self.tools = {}
            self._sessions = {}
            self._tasks = {}
            self._timeout_tasks = {}
            self._background_futures = []
            self._stop_events = {}
            self._oauth_tokens = {}
            self._oauth_authorization_urls = {}
            for future in self._oauth_authorization_ready.values():
                if not future.done():
                    future.cancel()
            for future in self._oauth_callback_futures.values():
                if not future.done():
                    future.cancel()
            self._oauth_authorization_ready = {}
            self._oauth_callback_futures = {}
            self._states = {
                name: "disconnected" if is_mcp_server_enabled(config) else "disabled"
                for name, config in self.server_configs.items()
            }

    def get_tools(self) -> List[MCPToolAdapter]:
        with self._lock:
            return list(self.tools.values())
