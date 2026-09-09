"""Longbridge SDK Context 共享缓存。

QuoteContext 创建行情长连接，单账户只能创建一个；内容类 Context 使用 HTTP。
此模块按凭据复用行情连接，并按凭据和内容语言复用 HTTP Context。
"""

from __future__ import annotations

import contextlib
import hashlib
import os
import threading
from typing import Any

from app.core.market.errors import LongbridgeUnavailableError

# context_type -> credential_sig (HTTP Context 附加语言) -> context_instance
_context_cache: dict[str, dict[str, Any]] = {}
_context_cache_lock = threading.Lock()
# Context 构造可能建立长连接。按凭据和类型串行冷启动，避免并发 miss 时
# 为同一账户创建多个 QuoteContext，并泄漏竞争失败的连接。
_context_creation_locks: dict[tuple[str, str], threading.Lock] = {}


def content_language(settings: Any = None) -> str:
    """将用户有效配置归一到应用支持的内容语言。"""
    from app.config import get_settings

    settings = settings or get_settings()
    language = str(getattr(settings, "app_language", "zh") or "zh").strip().lower()
    return "en" if language in {"en", "en-us", "english"} else "zh"


def longbridge_config(settings: Any = None, *, localize: bool = True):
    """构建 SDK Config，内容接口跟随应用语言，行情保留 SDK 的语言配置。"""
    try:
        from longbridge.openapi import Config, Language
    except ImportError as exc:
        raise LongbridgeUnavailableError("Longbridge SDK is not installed") from exc

    from app.config import get_settings

    settings = settings or get_settings()
    language_options = {}
    if localize:
        language_options["language"] = (
            Language.EN if content_language(settings) == "en" else Language.ZH_CN
        )
    if getattr(settings, "longbridge_auth_mode", "apikey") == "oauth":
        from app.core.market.longbridge_oauth import get_oauth

        return Config.from_oauth(
            get_oauth(settings),
            http_url=settings.longbridge_http_url or None,
            quote_ws_url=settings.longbridge_quote_ws_url or None,
            **language_options,
        )
    if (
        settings.longbridge_app_key
        and settings.longbridge_app_secret
        and settings.longbridge_access_token
    ):
        return Config.from_apikey(
            settings.longbridge_app_key,
            settings.longbridge_app_secret,
            settings.longbridge_access_token,
            http_url=settings.longbridge_http_url or None,
            quote_ws_url=settings.longbridge_quote_ws_url or None,
            **language_options,
        )
    try:
        environment_config = Config.from_apikey_env()
        if not localize:
            return environment_config

        # SDK 先加载 .env、校验凭据并保留其可选参数默认行为。Rust 加载的环境
        # 不会同步到 Python os.environ，因此只读解析同一文件来获取显式凭据。
        # 不修改全局语言环境变量，避免并发用户的中英文请求互相影响。
        from dotenv import dotenv_values, find_dotenv

        dotenv_path = find_dotenv(usecwd=True)
        environment = {
            **(dotenv_values(dotenv_path) if dotenv_path else {}),
            **os.environ,
        }
        credentials = [
            environment.get(f"LONGBRIDGE_{key}", environment.get(f"LONGPORT_{key}"))
            for key in ("APP_KEY", "APP_SECRET", "ACCESS_TOKEN")
        ]
        return Config.from_apikey(*credentials, **language_options)
    except Exception as exc:
        raise LongbridgeUnavailableError(
            "Longbridge credentials are not configured. Set LONGBRIDGE_APP_KEY, "
            "LONGBRIDGE_APP_SECRET and LONGBRIDGE_ACCESS_TOKEN, or configure them in the app."
        ) from exc


def credential_signature(settings: Any = None) -> str:
    """根据 Longbridge 凭据生成签名，作为缓存 key。"""
    from app.config import get_settings

    settings = settings or get_settings()
    material = "\0".join(
        str(getattr(settings, key, "") or "")
        for key in (
            "longbridge_auth_mode",
            "longbridge_oauth_client_id",
            "longbridge_app_key",
            "longbridge_app_secret",
            "longbridge_access_token",
            "longbridge_http_url",
            "longbridge_quote_ws_url",
        )
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


_CONTEXT_CLASSES = {
    "QuoteContext",
    "MarketContext",
    "FundamentalContext",
    "ContentContext",
}


def get_cached_context(context_type: str, settings: Any = None):
    """获取缓存的 Longbridge SDK Context。

    HTTP Context 的缓存按语言隔离；QuoteContext 始终按凭据复用，避免
    同一账户因用户语言不同创建多个行情长连接。多线程安全。
    """
    if context_type not in _CONTEXT_CLASSES:
        raise ValueError(f"Unknown Longbridge context type: {context_type}")

    sig = credential_signature(settings)
    localize = context_type != "QuoteContext"
    if localize:
        sig = f"{sig}:{content_language(settings)}"
    with _context_cache_lock:
        ctx = _context_cache.get(context_type, {}).get(sig)
        if ctx is not None:
            return ctx
        creation_lock = _context_creation_locks.setdefault((context_type, sig), threading.Lock())

    # 全局锁不覆盖网络连接创建，不同凭据/Context 类型仍可并行；同一 key
    # 则通过 singleflight 只创建一次。creation lock 保留复用，避免失败重试
    # 与等待线程之间再次形成双重创建窗口。
    with creation_lock:
        with _context_cache_lock:
            ctx = _context_cache.get(context_type, {}).get(sig)
            if ctx is not None:
                return ctx

        config = longbridge_config(settings, localize=localize)
        try:
            from longbridge.openapi import (
                ContentContext,
                FundamentalContext,
                MarketContext,
                QuoteContext,
            )
        except ImportError as exc:
            raise LongbridgeUnavailableError("Longbridge SDK is not installed") from exc

        cls_map = {
            "QuoteContext": QuoteContext,
            "MarketContext": MarketContext,
            "FundamentalContext": FundamentalContext,
            "ContentContext": ContentContext,
        }
        new_ctx = cls_map[context_type](config)
        with _context_cache_lock:
            _context_cache.setdefault(context_type, {})[sig] = new_ctx
        return new_ctx


def clear_context_cache() -> None:
    """清除所有缓存的 Context。配置变更后调用。"""
    with _context_cache_lock:
        old_contexts = [ctx for slot in _context_cache.values() for ctx in slot.values()]
        _context_cache.clear()
    # 在锁外尝试关闭旧连接
    for ctx in old_contexts:
        close = getattr(ctx, "close", None)
        if callable(close):
            with contextlib.suppress(Exception):
                close()
