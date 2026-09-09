"""Longbridge 原生 OAuth：按配置作用域注册客户端并管理授权生命周期。

Python SDK 4.1 未暴露自定义 TokenStorage，Token 由 SDK 在用户目录持久化。
独立注册的 client_id 隔离账户，目录 0700 / 文件 0600 防止其他系统用户读取。
不接受外部 client_id，避免复用本机其他应用或其他用户的 SDK Token。
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import socket
import threading
import time
from concurrent.futures import Future
from concurrent.futures import TimeoutError as FutureTimeoutError
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from app.core.app_store import get_app_store
from app.core.security import CurrentUser
from app.core.watchlist.service import LongbridgeUnavailableError
from app.schemas.longbridge_oauth import LongbridgeOAuthStatus

logger = logging.getLogger("stocks-assistant.longbridge-oauth")
AUTH_TIMEOUT = 300
REGISTER_URL = "https://openapi.longbridge.com/oauth2/register"
_CLIENT_ID = re.compile(r"[A-Za-z0-9_-]{8,128}\Z")
_handles: dict[str, Any] = {}
_handles_lock = threading.RLock()
_restorations: dict[str, Future] = {}
_revoked_clients: set[str] = set()


def _token_path(client_id: str) -> Path:
    if not _CLIENT_ID.fullmatch(client_id):
        raise LongbridgeUnavailableError("长桥 OAuth 客户端无效，请重新授权")
    return Path.home() / ".longbridge" / "openapi" / "tokens" / client_id


def _safe_token_path(path: Path) -> bool:
    return not any(
        item.is_symlink()
        for item in (path, path.parent, path.parent.parent, path.parent.parent.parent)
    )


def _read_token(client_id: str) -> dict[str, Any]:
    if not client_id:
        return {}
    with _handles_lock:
        if client_id in _revoked_clients:
            return {}
    try:
        path = _token_path(client_id)
        if not _safe_token_path(path) or not path.is_file():
            return {}
        if path.stat().st_size > 64 * 1024:
            return {}
        token = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(token, dict) or token.get("client_id") != client_id:
            return {}
        return token
    except (OSError, ValueError, LongbridgeUnavailableError):
        return {}


def oauth_connected(settings: Any) -> bool:
    token = _read_token(str(getattr(settings, "longbridge_oauth_client_id", "") or ""))
    try:
        return bool(token.get("access_token")) and (
            float(token.get("expires_at") or 0) > time.time() or bool(token.get("refresh_token"))
        )
    except (ValueError, TypeError):
        return False


def _reserve_token(client_id: str) -> None:
    path = _token_path(client_id)
    with _handles_lock:
        if client_id in _revoked_clients:
            raise LongbridgeUnavailableError("长桥返回了已断开的客户端，请重试")
    # 不跟随缓存目录符号链接，也不覆盖已存在的凭据（包括其他应用的授权）。
    for directory in (path.parent.parent.parent, path.parent.parent, path.parent):
        if directory.is_symlink():
            raise LongbridgeUnavailableError("长桥 OAuth 缓存目录不能是符号链接")
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.parent.chmod(0o700)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.close(fd)


def _forget_client(client_id: str) -> None:
    if not client_id:
        return
    with _handles_lock:
        _revoked_clients.add(client_id)
        _handles.pop(client_id, None)
        _restorations.pop(client_id, None)
    try:
        path = _token_path(client_id)
        if _safe_token_path(path):
            path.unlink(missing_ok=True)
    except (OSError, LongbridgeUnavailableError):
        logger.warning("Could not remove a Longbridge OAuth cache file")


async def _restore_oauth(client_id: str):
    from longbridge.openapi import OAuthBuilder

    loop = asyncio.get_running_loop()
    port = _available_port()
    callback_url = f"http://localhost:{port}/callback"

    def refuse_authorization(_url):
        loop.call_soon_threadsafe(lambda: asyncio.create_task(_abort_callback(callback_url)))

    future = asyncio.ensure_future(
        OAuthBuilder(client_id, callback_port=port).build_async(refuse_authorization)
    )
    # 普通行情请求只能恢复/刷新已授权 Token，不能隐式启动浏览器授权。
    try:
        return await future
    except Exception as exc:
        raise LongbridgeUnavailableError("长桥 OAuth 已失效，请在配置页面重新授权") from exc


def _available_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


async def _abort_callback(callback_url: str | None) -> None:
    if not callback_url:
        return
    # v4.1 直接 cancel Future 会遗留监听器；回送拒绝信号让 SDK 执行自身清理。
    async with httpx.AsyncClient(timeout=1, trust_env=False) as client:
        for attempt in range(3):
            try:
                await client.get(
                    callback_url.replace("localhost", "127.0.0.1"),
                    params={"error": "access_denied"},
                )
                return
            except httpx.HTTPError:
                if attempt < 2:
                    await asyncio.sleep(0.05)


def get_oauth(settings: Any):
    client_id = str(getattr(settings, "longbridge_oauth_client_id", "") or "")
    if not oauth_connected(settings):
        raise LongbridgeUnavailableError("请在配置页面完成长桥 OAuth 授权")
    with _handles_lock:
        if client_id in _revoked_clients:
            raise LongbridgeUnavailableError("长桥 OAuth 已断开，请重新授权")
        if client_id in _handles:
            return _handles[client_id]
        future = _restorations.get(client_id)
        if future is None:
            future = Future()
            _restorations[client_id] = future

            def restore():
                try:
                    oauth = asyncio.run(_restore_oauth(client_id))
                    # SDK 刷新可能在断开之后重新写入文件，失效标记防止旧授权复活。
                    with _handles_lock:
                        revoked = client_id in _revoked_clients
                    if revoked:
                        _forget_client(client_id)
                        raise LongbridgeUnavailableError("长桥 OAuth 已断开，请重新授权")
                    future.set_result(oauth)
                except Exception as exc:
                    future.set_exception(exc)

            # SDK 网络等待不能拖住请求线程；后台继续正常结束，避免 cancel 遗留监听器。
            threading.Thread(target=restore, daemon=True, name="longbridge-oauth-restore").start()
    try:
        oauth = future.result(timeout=25)
    except FutureTimeoutError as exc:
        raise LongbridgeUnavailableError("长桥 OAuth 刷新超时，请稍后重试") from exc
    except Exception:
        with _handles_lock:
            _restorations.pop(client_id, None)
        raise
    with _handles_lock:
        _restorations.pop(client_id, None)
        # 断开期间完成的旧凭据恢复不能重新进入共享缓存。
        if client_id in _revoked_clients or not oauth_connected(settings):
            _forget_client(client_id)
            raise LongbridgeUnavailableError("长桥 OAuth 已断开，请重新授权")
        _handles[client_id] = oauth
    return oauth


@dataclass
class _Authorization:
    actor: CurrentUser
    store: Any
    client_id: str = ""
    callback_url: str | None = None
    authorization_url: str | None = None
    error: str | None = None
    expires_at: float = field(default_factory=lambda: time.time() + AUTH_TIMEOUT)
    ready: asyncio.Event = field(default_factory=asyncio.Event)
    task: asyncio.Task | None = None
    cancelled: bool = False
    oauth_future: asyncio.Future | None = None


class LongbridgeOAuthService:
    def __init__(self):
        self._sessions: dict[tuple[str, str], _Authorization] = {}

    @staticmethod
    def _key(current: CurrentUser) -> tuple[str, str]:
        return (
            str(get_app_store().db_path),
            "system" if current.can("config:write") else current.id,
        )

    @staticmethod
    def _stored(current: CurrentUser) -> dict[str, Any]:
        store = get_app_store()
        return (
            store.get_config() if current.can("config:write") else store.get_user_config(current.id)
        )

    def status(self, current: CurrentUser) -> LongbridgeOAuthStatus:
        stored = self._stored(current)
        from app.config import get_effective_settings

        effective = get_effective_settings(current.id)
        client_id = str(stored.get("longbridge_oauth_client_id") or "")
        token = _read_token(client_id)
        from types import SimpleNamespace

        connected = oauth_connected(SimpleNamespace(longbridge_oauth_client_id=client_id))
        session = self._sessions.get(self._key(current))
        pending = (
            session is not None
            and session.error is None
            and session.task is not None
            and not session.task.done()
        )
        expires_at = session.expires_at if pending else token.get("expires_at")
        try:
            expiry = (
                datetime.fromtimestamp(float(expires_at), UTC).isoformat() if expires_at else None
            )
        except (ValueError, TypeError, OverflowError):
            expiry = None
        return LongbridgeOAuthStatus(
            status="pending"
            if pending
            else "error"
            if session and session.error
            else "connected"
            if connected
            else "disconnected",
            auth_mode=effective.longbridge_auth_mode,
            client_id=client_id,
            authorization_url=session.authorization_url if pending else None,
            callback_url=session.callback_url if pending else None,
            expires_at=expiry,
            error=session.error if session else None,
            scope="system" if current.can("config:write") else "personal",
        )

    async def start(self, current: CurrentUser) -> LongbridgeOAuthStatus:
        key = self._key(current)
        previous = self._sessions.get(key)
        if previous and previous.task and not previous.task.done():
            await asyncio.wait_for(previous.ready.wait(), timeout=25)
            return self.status(current)
        # 先写入会话再开始网络请求，重复点击只能创建一个客户端/回调监听器。
        session = _Authorization(actor=current, store=get_app_store())
        self._sessions[key] = session
        session.task = asyncio.create_task(self._authorize(key, session))
        try:
            await asyncio.wait_for(session.ready.wait(), timeout=25)
        except TimeoutError:
            session.error = "长桥授权启动超时，请稍后重试"
            session.cancelled = True
            await _abort_callback(session.callback_url)
        return self.status(current)

    async def _authorize(self, key: tuple[str, str], session: _Authorization) -> None:
        committed = False
        try:
            from longbridge.openapi import OAuthBuilder

            # SDK 回调仅绑定 127.0.0.1，随机端口避免多个用户同时授权时占用同一端口。
            port = _available_port()
            session.callback_url = f"http://localhost:{port}/callback"
            async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
                response = await client.post(
                    REGISTER_URL,
                    json={
                        "redirect_uris": [session.callback_url],
                        "token_endpoint_auth_method": "none",
                        "grant_types": ["authorization_code", "refresh_token"],
                        "response_types": ["code"],
                        "client_name": "Stocks Assistant",
                    },
                )
                response.raise_for_status()
                client_id = str(response.json().get("client_id") or "")
            if session.cancelled:
                return
            _reserve_token(client_id)
            session.client_id = client_id
            loop = asyncio.get_running_loop()

            def on_open_url(url: str) -> None:
                def publish():
                    session.authorization_url = str(url)
                    session.ready.set()
                    if session.cancelled:
                        asyncio.create_task(_abort_callback(session.callback_url))

                loop.call_soon_threadsafe(publish)

            # SDK 负责 state 校验、code 交换及刷新，并自带 300 秒回调超时。
            session.oauth_future = asyncio.ensure_future(
                OAuthBuilder(client_id, callback_port=port).build_async(on_open_url)
            )
            oauth = await asyncio.shield(session.oauth_future)
            if self._sessions.get(key) is not session or session.cancelled:
                return
            # 授权期间管理员可能停用账号/修改权限；只在原权限仍然成立时提交。
            user = session.store.get_user(session.actor.id)
            if not user or not user.get("is_active"):
                raise LongbridgeUnavailableError("授权用户不可用")
            from app.core.security import to_current_user

            if not to_current_user(user).can("config:read"):
                raise LongbridgeUnavailableError("配置权限已改变")
            old = (
                session.store.get_config()
                if key[1] == "system"
                else session.store.get_user_config(session.actor.id)
            )
            patch = {"longbridge_auth_mode": "oauth", "longbridge_oauth_client_id": client_id}
            if key[1] == "system":
                if not to_current_user(user).can("config:write"):
                    raise LongbridgeUnavailableError("配置权限已改变")
                session.store.set_config_values(patch)
            else:
                session.store.set_user_config_values(session.actor.id, patch)
            session.store.audit(
                session.actor.id,
                "longbridge.oauth_connect",
                "config",
                {"scope": "system" if key[1] == "system" else "personal"},
            )
            with _handles_lock:
                _handles[client_id] = oauth
            committed = True
            _refresh_caches()
            _forget_client(str(old.get("longbridge_oauth_client_id") or ""))
        except asyncio.CancelledError:
            session.cancelled = True
            await _abort_callback(session.callback_url)
            if session.oauth_future:
                await asyncio.gather(session.oauth_future, return_exceptions=True)
            raise
        except Exception as exc:
            # SDK/HTTP 异常可能包含 code/token/URL，不写完整异常或回传原文。
            logger.warning("Longbridge OAuth failed (%s)", type(exc).__name__)
            session.error = "长桥授权失败或已超时，请重试并确认浏览器与服务运行在同一台电脑"
        finally:
            if not committed and session.client_id:
                _forget_client(session.client_id)
            session.ready.set()

    async def disconnect(self, current: CurrentUser) -> LongbridgeOAuthStatus:
        session = self._sessions.pop(self._key(current), None)
        if session and session.task and not session.task.done():
            session.cancelled = True
            await _abort_callback(session.callback_url)
            await asyncio.wait({session.task}, timeout=5)
            # 取消尚未完成的新授权不修改先前有效的 API Key / OAuth 连接。
            return self.status(current)
        stored = self._stored(current)
        if not stored.get("longbridge_oauth_client_id"):
            return self.status(current)
        patch = {
            "longbridge_oauth_client_id": "",
            "longbridge_auth_mode": stored.get("longbridge_auth_mode", "apikey"),
        }
        store = get_app_store()
        if current.can("config:write"):
            store.set_config_values(patch)
        else:
            store.set_user_config_values(current.id, patch)
        store.audit(
            current.id,
            "longbridge.oauth_disconnect",
            "config",
            {"scope": "system" if current.can("config:write") else "personal"},
        )
        _refresh_caches()
        _forget_client(str(stored.get("longbridge_oauth_client_id") or ""))
        return self.status(current)


def _refresh_caches() -> None:
    from app.config import reset_settings_cache
    from app.core.configuration.runtime import invalidate_runtime

    reset_settings_cache()
    invalidate_runtime({"longbridge_oauth_client_id": ""})


longbridge_oauth_service = LongbridgeOAuthService()
