"""Longbridge SDK Context 共享缓存。

Longbridge QuoteContext / FundamentalContext 等在创建时会建立持久连接，
且单账户只能创建一个长连接。每次请求新建 Context 会浪费连接并可能触发限流。
此模块按凭据签名缓存 Context，跨请求/跨 service 复用。
"""

from __future__ import annotations

import hashlib
import threading
from typing import Any, Optional

from app.core.watchlist.service import LongbridgeUnavailableError

# context_type -> credential_sig -> context_instance
_context_cache: dict[str, dict[str, Any]] = {}
_context_cache_lock = threading.Lock()


def longbridge_config(settings: Any = None):
    """构建 Longbridge SDK Config。凭据优先取 settings，回退环境变量。"""
    try:
        from longbridge.openapi import Config
    except ImportError as exc:
        raise LongbridgeUnavailableError("Longbridge SDK is not installed") from exc

    from app.config import get_settings

    settings = settings or get_settings()
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
        )
    try:
        return Config.from_apikey_env()
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

    按 (context_type, credential_signature) 缓存。凭据变更时通过
    ``clear_context_cache`` 失效。多线程安全。
    """
    if context_type not in _CONTEXT_CLASSES:
        raise ValueError(f"Unknown Longbridge context type: {context_type}")

    sig = credential_signature(settings)
    cache_key = f"{context_type}:{sig}"
    with _context_cache_lock:
        ctx = _context_cache.get(context_type, {}).get(sig)
        if ctx is not None:
            return ctx

    # 在锁外创建 context（可能涉及网络连接）
    config = longbridge_config(settings)
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
        # 另一个线程可能已经创建了一个；优先使用已有的
        slot = _context_cache.setdefault(context_type, {})
        existing = slot.get(sig)
        if existing is not None:
            ctx = existing
        else:
            slot[sig] = new_ctx
            ctx = new_ctx
    return ctx


def clear_context_cache() -> None:
    """清除所有缓存的 Context。配置变更后调用。"""
    with _context_cache_lock:
        old_contexts = [ctx for slot in _context_cache.values() for ctx in slot.values()]
        _context_cache.clear()
    # 在锁外尝试关闭旧连接
    for ctx in old_contexts:
        close = getattr(ctx, "close", None)
        if callable(close):
            try:
                close()
            except Exception:
                pass
