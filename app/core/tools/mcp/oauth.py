"""OAuth support for MCP HTTP transports."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Mapping, Optional

from app.core.tools.mcp.config import LEGACY_SSE_TRANSPORT, STANDARD_HTTP_TRANSPORT, build_http_headers, normalize_transport

logger = logging.getLogger("stocks-assistant.mcp")


class MCPOAuthMixin:
    """OAuth token restore, login, and HTTP auth helpers for MCPManager."""

    def _restore_tokens(self) -> None:
        """从持久化存储恢复 OAuth 令牌到内存缓存。"""
        if not self._token_store:
            return
        try:
            for server_name in self.server_configs:
                # 恢复 Client Credentials 令牌
                cc = self._token_store.get_client_credentials_token(server_name)
                if cc:
                    self._oauth_tokens[server_name] = cc

                # 恢复 Authorization Code 令牌和客户端信息
                from mcp.shared.auth import OAuthClientInformationFull, OAuthToken

                tokens_data = self._token_store.get_tokens(server_name)
                if tokens_data:
                    try:
                        self._oauth_login_tokens[server_name] = OAuthToken(**tokens_data)
                    except Exception as e:
                        logger.warning(f"Failed to restore OAuth tokens for '{server_name}': {e}")

                client_info_data = self._token_store.get_client_info(server_name)
                if client_info_data:
                    try:
                        self._oauth_client_infos[server_name] = OAuthClientInformationFull(**client_info_data)
                    except Exception as e:
                        logger.warning(f"Failed to restore OAuth client info for '{server_name}': {e}")
        except Exception as e:
            logger.warning(f"Failed to restore MCP OAuth tokens: {e}")

    async def start_oauth_authorization(self, server_name: str, redirect_uri: str, timeout: float = 20) -> str:
        """启动 OAuth Authorization Code 授权流程，返回用户需要访问的授权 URL。"""
        config = self.server_configs.get(server_name)
        if not config:
            raise ValueError(f"MCP server '{server_name}' not found")

        transport = normalize_transport(config.get("transport"), config)
        if transport not in {STANDARD_HTTP_TRANSPORT, LEGACY_SSE_TRANSPORT}:
            raise ValueError("OAuth authorization is only supported for HTTP MCP servers")

        await self._stop_server(server_name)
        self._clear_oauth_credentials(server_name)

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

        try:
            await self._connect_server(server_name, oauth_config, wait=False, timeout=oauth_config["connect_timeout"])
        except Exception as exc:
            error = self._format_connect_error(exc)
            with self._lock:
                self._errors[server_name] = error
                self._states[server_name] = "error"
            raise RuntimeError(error) from exc

        try:
            return await asyncio.wait_for(authorization_ready, timeout=timeout)
        except asyncio.TimeoutError as exc:
            with self._lock:
                error = self._errors.get(server_name)
            if error:
                raise RuntimeError(error) from exc
            raise RuntimeError("Timed out waiting for MCP OAuth authorization URL") from exc
        except Exception as exc:
            error = self._format_connect_error(exc)
            with self._lock:
                self._errors[server_name] = error
                self._states[server_name] = "error"
            raise RuntimeError(error) from exc

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

    async def clear_oauth_credentials(self, server_name: str) -> None:
        """停止服务器连接，并清除内存与磁盘中的 OAuth 登录信息。"""
        await self._stop_server(server_name)
        self._clear_oauth_credentials(server_name)

    def _clear_oauth_credentials(self, server_name: str) -> None:
        """清除指定服务器的 OAuth 内存缓存与持久化数据。"""
        with self._lock:
            self._oauth_tokens.pop(server_name, None)
            self._oauth_login_tokens.pop(server_name, None)
            self._oauth_client_infos.pop(server_name, None)
            self._oauth_authorization_urls.pop(server_name, None)
            ready = self._oauth_authorization_ready.pop(server_name, None)
            if ready and not ready.done():
                ready.cancel()
            callback = self._oauth_callback_futures.pop(server_name, None)
            if callback and not callback.done():
                callback.cancel()
            self._errors.pop(server_name, None)
        if self._token_store:
            self._token_store.clear(server_name)

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
        """构建适用于 Authorization Code 流程的 OAuthClientProvider。"""
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

        class PersistentTokenStorage(TokenStorage):
            async def get_tokens(storage_self) -> OAuthToken | None:
                return self._oauth_login_tokens.get(server_name)

            async def set_tokens(storage_self, tokens: OAuthToken) -> None:
                self._oauth_login_tokens[server_name] = tokens
                if self._token_store:
                    self._token_store.set_tokens(server_name, tokens.model_dump(exclude_none=True))

            async def get_client_info(storage_self) -> OAuthClientInformationFull | None:
                return self._oauth_client_infos.get(server_name)

            async def set_client_info(storage_self, client_info: OAuthClientInformationFull) -> None:
                self._oauth_client_infos[server_name] = client_info
                if self._token_store:
                    self._token_store.set_client_info(server_name, client_info.model_dump(exclude_none=True))

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
            storage=PersistentTokenStorage(),
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
        """获取 OAuth Client Credentials 令牌，内置 30s 过期缓存。"""
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
        # 将令牌和过期时间写入缓存并持久化
        expires_in = payload.get("expires_in")
        ttl = float(expires_in) if isinstance(expires_in, (int, float)) else 3600
        self._oauth_tokens[server_name] = (token, now + ttl)
        if self._token_store:
            self._token_store.set_client_credentials_token(server_name, token, now + ttl)
        return token
