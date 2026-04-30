"""MCP（Model Context Protocol）工具适配器。

将外部 MCP 服务器提供的工具包装为内部 BaseTool 实例，
支持 streamable_http、SSE、stdio 三种传输模式及 OAuth 鉴权。
"""

from __future__ import annotations

import asyncio
import logging
import shutil
import threading
import time
from typing import Any, Dict, List, Mapping, Optional

from app.core.tools.base_tool import BaseTool, ToolResult
from app.core.tools.mcp.config import (
    LEGACY_SSE_TRANSPORT,
    STANDARD_HTTP_TRANSPORT,
    STDIO_TRANSPORT,
    build_http_headers,
    normalize_mcp_servers,
    normalize_transport,
)

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
            return ToolResult.fail(f"MCP tool error: {e}")


class MCPManager:
    """管理所有 MCP 服务器连接并内居已发现工具。

    内部在一个独立守护线程上运行一个持久异步事件循环，
    以实现长连接和工具调用。对外提供同步接口。
    """

    def __init__(self, server_configs: Dict[str, Dict[str, Any]]):
        # 对配置字典进行归一化处理
        self.server_configs = normalize_mcp_servers(server_configs)
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

    # ------------------------------------------------------------------ public

    def connect_all_sync(self, wait: bool = False, timeout: Optional[float] = None):
        """同步地对所有已配置的 MCP 服务器发起连接。wait=True 时限时等待连接就绪。"""
        return self._run_sync(self.connect_all(wait=wait, timeout=timeout), timeout=timeout)

    def reconnect_sync(
        self,
        server_configs: Dict[str, Dict[str, Any]],
        wait: bool = False,
        timeout: Optional[float] = None,
    ):
        """更新服务器配置并重新建立所有连接。"""
        self.server_configs = normalize_mcp_servers(server_configs)
        return self.connect_all_sync(wait=wait, timeout=timeout)

    def close_sync(self):
        """同步关闭所有连接并停止后台事件循环。"""
        if not self._loop:
            return
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
            state = self._states.get(
                server_name,
                "connected" if server_name in self._sessions else "disconnected",
            )
            return state, self._errors.get(server_name), tools_count, self._oauth_authorization_urls.get(server_name)

    def call_tool_sync(self, server_name: str, tool_name: str, params: dict):
        """同步调用指定 MCP 服务器的工具并返回结果。"""
        return self._run_sync(self._call_tool(server_name, tool_name, params))

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

    async def connect_all(self, wait: bool = False, timeout: Optional[float] = None):
        """异步关闭并重建所有 MCP 服务器连接。"""
        await self.close()

        with self._lock:
            # 重置所有共享状态
            self.tools = {}
            self._sessions = {}
            self._errors = {}
            self._oauth_authorization_urls = {}
            self._states = {name: "disconnected" for name in self.server_configs}

        for server_name, config in self.server_configs.items():
            try:
                await self._connect_server(server_name, config, wait=wait, timeout=timeout)
            except Exception as e:
                with self._lock:
                    self._errors[server_name] = str(e)
                    self._states[server_name] = "error"
                logger.warning(f"Failed to connect MCP server '{server_name}': {e}")

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
            asyncio.create_task(self._connection_timeout(server_name, ready, task, connect_timeout))

    async def start_oauth_authorization(self, server_name: str, redirect_uri: str, timeout: float = 20) -> str:
        """启动 OAuth Authorization Code 授权流程，返回用户需要访问的授权 URL。"""
        config = self.server_configs.get(server_name)
        if not config:
            raise ValueError(f"MCP server '{server_name}' not found")

        transport = normalize_transport(config.get("transport"), config)
        if transport not in {STANDARD_HTTP_TRANSPORT, LEGACY_SSE_TRANSPORT}:
            raise ValueError("OAuth authorization is only supported for HTTP MCP servers")

        await self._stop_server(server_name)

        loop = asyncio.get_running_loop()
        authorization_ready = loop.create_future()
        with self._lock:
            self._oauth_authorization_ready[server_name] = authorization_ready
            self._oauth_authorization_urls.pop(server_name, None)
            self._errors.pop(server_name, None)
            self._states[server_name] = "connecting"

        oauth_config = dict(config)
        auth = oauth_config.get("auth")
        if not isinstance(auth, Mapping):
            auth = {}
        oauth_config["auth"] = {
            **dict(auth),
            "type": "oauth_authorization_code",
            "redirect_uri": redirect_uri,
        }
        oauth_config["connect_timeout"] = max(float(oauth_config.get("connect_timeout", 10)), timeout)

        await self._connect_server(server_name, oauth_config, wait=False, timeout=oauth_config["connect_timeout"])

        try:
            return await asyncio.wait_for(authorization_ready, timeout=timeout)
        except asyncio.TimeoutError as exc:
            with self._lock:
                error = self._errors.get(server_name)
            if error:
                raise RuntimeError(error) from exc
            raise RuntimeError("Timed out waiting for MCP OAuth authorization URL") from exc

    async def complete_oauth_callback(
        self,
        server_name: str,
        code: Optional[str],
        state: Optional[str],
        error: Optional[str] = None,
    ) -> None:
        """将收到的 OAuth 授权回调参数传递给当前持待的 Future。"""
        future = self._oauth_callback_futures.get(server_name)
        if not future or future.done():
            raise RuntimeError(f"No pending OAuth login for MCP server '{server_name}'")
        if error:
            future.set_exception(RuntimeError(error))
        elif not code:
            future.set_exception(RuntimeError("OAuth callback did not include code"))
        else:
            future.set_result((code, state))
        with self._lock:
            self._states[server_name] = "connecting"
            self._errors[server_name] = "OAuth callback received; connecting MCP server..."

    async def _stop_server(self, server_name: str):
        """优雅停止指定服务器的连接任务，并清理其相关状态。"""
        stop_event = self._stop_events.pop(server_name, None)
        task = self._tasks.pop(server_name, None)
        if stop_event:
            stop_event.set()
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

    async def _build_http_headers(self, server_name: str, config: dict) -> dict[str, str]:
        """构建 HTTP 请求头，若配置了 OAuth Client Credentials 则异步获取 Token 并注入。"""
        headers = build_http_headers(config)
        auth = config.get("auth")
        if isinstance(auth, dict) and auth.get("type") == "oauth_client_credentials":
            # 动态获取并缓存 Client Credentials Token
            token = await self._get_oauth_client_credentials_token(server_name, auth)
            headers["Authorization"] = f"Bearer {token}"
        return headers

    def _build_oauth_authorization_provider(self, server_name: str, config: dict, ready: asyncio.Future):
        """构建适用于 Authorization Code 流程的 OAuthClientProvider。

        对于已配置其他鉴权类型或尚未提示 OAuth 的服务器返回 None。
        """
        auth = config.get("auth")
        if isinstance(auth, Mapping):
            auth_type = str(auth.get("type", "")).lower()
            if auth_type in {"none", "bearer", "basic", "header", "oauth_client_credentials"}:
                return None
            if auth_type not in {"", "oauth_authorization_code"}:
                return None
        else:
            auth = {}

        # MCP HTTP servers that require OAuth should advertise it with a 401
        # WWW-Authenticate challenge. Enabling the provider by default keeps
        # zero-config servers such as Longbridge working while no-auth servers
        # continue without entering the flow.
        from mcp.client.auth import OAuthClientProvider, TokenStorage
        from mcp.shared.auth import OAuthClientInformationFull, OAuthClientMetadata, OAuthToken

        class InMemoryTokenStorage(TokenStorage):
            async def get_tokens(storage_self) -> OAuthToken | None:
                # 从内存读取该服务器的已存储令牌
                return self._oauth_login_tokens.get(server_name)

            async def set_tokens(storage_self, tokens: OAuthToken) -> None:
                # 将新令牌写入内存缓存
                self._oauth_login_tokens[server_name] = tokens

            async def get_client_info(storage_self) -> OAuthClientInformationFull | None:
                # 读取已注册的 OAuth 客户端信息
                return self._oauth_client_infos.get(server_name)

            async def set_client_info(storage_self, client_info: OAuthClientInformationFull) -> None:
                # 保存客户端注册信息
                self._oauth_client_infos[server_name] = client_info

        redirect_uri = auth.get("redirect_uri") or config.get("redirect_uri")
        if not isinstance(redirect_uri, str) or not redirect_uri:
            # 未配置时使用默认地址
            redirect_uri = self._default_oauth_redirect_uri(server_name)

        timeout = float(auth.get("timeout") or config.get("oauth_timeout") or 300)

        async def redirect_handler(authorization_url: str) -> None:
            """收到授权 URL 后更新内部状态并解除 authorization_ready 封锁。"""
            callback_future = self._oauth_callback_futures.get(server_name)
            if not callback_future or callback_future.done():
                self._oauth_callback_futures[server_name] = asyncio.get_running_loop().create_future()
            with self._lock:
                self._oauth_authorization_urls[server_name] = authorization_url
                self._states[server_name] = "auth_required"
                self._errors[server_name] = "OAuth authorization required. Open the login URL to continue."
            authorization_ready = self._oauth_authorization_ready.get(server_name)
            if authorization_ready and not authorization_ready.done():
                authorization_ready.set_result(authorization_url)
            if not ready.done():
                ready.set_result(None)

        async def callback_handler() -> tuple[str, str | None]:
            """等待用户完成授权并将回调参数写入 Future。"""
            future = self._oauth_callback_futures.get(server_name)
            if not future or future.done():
                future = asyncio.get_running_loop().create_future()
                self._oauth_callback_futures[server_name] = future
            return await asyncio.wait_for(future, timeout=timeout)

        metadata = OAuthClientMetadata(
            redirect_uris=[redirect_uri],
            client_name=str(auth.get("client_name") or config.get("client_name") or "Stocks Assistant"),
            client_uri=auth.get("client_uri") or config.get("client_uri"),
            scope=auth.get("scope") if isinstance(auth.get("scope"), str) else None,
        )
        client_metadata_url = auth.get("client_metadata_url") or config.get("client_metadata_url")
        return OAuthClientProvider(
            server_url=config["url"],
            client_metadata=metadata,
            storage=InMemoryTokenStorage(),
            redirect_handler=redirect_handler,
            callback_handler=callback_handler,
            timeout=timeout,
            client_metadata_url=client_metadata_url if isinstance(client_metadata_url, str) else None,
        )

    def _default_oauth_redirect_uri(self, server_name: str) -> str:
        """生成默认的 OAuth 回调地址，根据当前应用端口拼接。"""
        try:
            from app.config import get_settings

            settings = get_settings()
            port = settings.port or 8000
        except Exception:
            port = 8000
        return f"http://127.0.0.1:{port}/api/v1/mcp/oauth/callback/{server_name}"

    async def _get_oauth_client_credentials_token(self, server_name: str, auth: dict) -> str:
        """获取 OAuth Client Credentials 令牌，内置 30s 袋陕期缓存。"""
        # 检查是否有有效缓存
        cached = self._oauth_tokens.get(server_name)
        now = time.time()
        if cached and cached[1] > now + 30:
            return cached[0]

        token_url = auth.get("token_url") or auth.get("token_endpoint")
        client_id = auth.get("client_id")
        client_secret = auth.get("client_secret")
        if not isinstance(token_url, str) or not token_url:
            raise ValueError("OAuth client credentials auth requires token_url")
        if not isinstance(client_id, str) or not client_id:
            raise ValueError("OAuth client credentials auth requires client_id")
        if client_secret is not None and not isinstance(client_secret, str):
            raise ValueError("OAuth client credentials client_secret must be a string")

        import httpx

        data: dict[str, str] = {"grant_type": "client_credentials"}
        # 附加可选的 scope/audience/resource 参数
        for key in ("scope", "audience", "resource"):
            value = auth.get(key)
            if isinstance(value, str) and value:
                data[key] = value

        token_endpoint_auth_method = str(auth.get("token_endpoint_auth_method", "client_secret_post"))
        request_auth = None
        if token_endpoint_auth_method == "client_secret_basic":
            # HTTP Basic Auth 方式
            request_auth = (client_id, client_secret or "")
        else:
            # 请求体传参方式
            data["client_id"] = client_id
            if client_secret:
                data["client_secret"] = client_secret

        async with httpx.AsyncClient(timeout=float(auth.get("timeout", 15))) as client:
            response = await client.post(
                token_url,
                data=data,
                headers={"Accept": "application/json"},
                auth=request_auth,
            )
        if response.status_code >= 400:
            raise RuntimeError(f"OAuth token request failed with HTTP {response.status_code}: {response.text[:200]}")
        payload = response.json()
        token = payload.get("access_token")
        if not isinstance(token, str) or not token:
            raise RuntimeError("OAuth token response did not include access_token")
        # 将令牌和过期时间写入缓存
        expires_in = payload.get("expires_in")
        ttl = float(expires_in) if isinstance(expires_in, (int, float)) else 3600
        self._oauth_tokens[server_name] = (token, now + ttl)
        return token

    def _format_connect_error(self, exc: Exception) -> str:
        """将连接异常转换为简洁的错误描述字符串，对常见情况返回可读提示。"""
        if isinstance(exc, BaseExceptionGroup):
            messages = [self._format_connect_error(item) for item in exc.exceptions]
            unique_messages = list(dict.fromkeys(message for message in messages if message))
            if unique_messages:
                return "; ".join(unique_messages)[:500]

        message = str(exc)
        lower = message.lower()
        if "401" in message or "unauthorized" in lower or "token" in lower:
            return "MCP authorization failed. Click Login to complete OAuth, or check the configured Bearer token."
        if "state parameter mismatch" in lower:
            return "MCP OAuth callback state mismatch. Restart OAuth login and try again."
        if "no pending oauth login" in lower:
            return message
        if "jsonrpcmessage" in lower or "non-json" in lower or "field required" in lower:
            return "MCP server returned a non JSON-RPC response. Check the MCP URL and authorization."
        if len(message) > 500:
            return message[:500] + "..."
        return message

    async def _discover_tools(self, server_name: str, session):
        """向 MCP 服务器查询工具列表，将发现的工具包装为 MCPToolAdapter 并更新注册表。"""
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
            logger.info(f"Discovered MCP tool: {adapter.name}")

        with self._lock:
            # 删除该服务器的旧工具，再写入新发现的工具
            for name in [name for name in self.tools if name.startswith(f"mcp_{server_name}_")]:
                self.tools.pop(name, None)
            self.tools.update(discovered)

    async def _call_tool(self, server_name: str, tool_name: str, params: dict):
        """异步调用指定服务器的工具，解析并返回文本内容或对象数据。"""
        session = self._sessions.get(server_name)
        if not session:
            raise RuntimeError(f"MCP server '{server_name}' is not connected")
        result = await session.call_tool(tool_name, params)
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

    async def close(self):
        tasks = list(self._tasks.values())
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
            self._states = {name: "disconnected" for name in self.server_configs}

    def get_tools(self) -> List[MCPToolAdapter]:
        with self._lock:
            return list(self.tools.values())
