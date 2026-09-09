"""配置更新的权限边界、持久化及依赖刷新编排。"""

import asyncio
import logging

from app.config import (
    ALWAYS_USER_CONFIG_KEYS,
    USER_CONFIG_KEYS,
    Settings,
    get_effective_config,
    get_effective_settings,
    get_settings,
    reset_settings_cache,
)
from app.core.app_store import get_app_store
from app.core.configuration.runtime import MCP_KEYS, invalidate_runtime
from app.core.security import CurrentUser
from app.core.tools.mcp.config import preserve_masked_mcp_secrets
from app.schemas.config import ConfigUpdate

logger = logging.getLogger("stocks-assistant.configuration")


class ConfigPermissionError(PermissionError):
    """当前用户试图更新非个人配置。"""


async def persist_config_update(update: ConfigUpdate, current: CurrentUser) -> Settings:
    patch = {
        key: value
        for key, value in update.model_dump(exclude_unset=True).items()
        if value is not None
    }
    personal_only = not current.can("config:write")
    if personal_only and (disallowed := sorted(patch.keys() - USER_CONFIG_KEYS)):
        raise ConfigPermissionError(
            f"Only personal config keys can be updated: {', '.join(disallowed)}"
        )

    stored = get_effective_config(current.id)
    if "mcp_servers" in patch:
        patch["mcp_servers"] = preserve_masked_mcp_secrets(
            stored.get("mcp_servers"), patch["mcp_servers"]
        )
    # 在任何写入前校验整份有效配置，保留旧配置的补丁与 masked secret 语义。
    Settings(**{**stored, **patch})
    user_patch = {
        key: value
        for key, value in patch.items()
        if personal_only or key in ALWAYS_USER_CONFIG_KEYS
    }
    system_patch = {key: value for key, value in patch.items() if key not in user_patch}
    store = get_app_store()
    if user_patch:
        store.set_user_config_values(current.id, user_patch)
        store.audit(current.id, "config.user_update", "user_config", {"keys": sorted(user_patch)})
    if system_patch:
        store.set_config_values(system_patch)
        store.audit(current.id, "config.update", "app_config", {"keys": sorted(system_patch)})
    reset_settings_cache()

    for scope_patch, user_id in ((system_patch, None), (user_patch, current.id)):
        if not scope_patch:
            continue
        # 关闭旧 MCP 连接可能等待 I/O，避免占住 ASGI 事件循环。
        try:
            await asyncio.to_thread(invalidate_runtime, scope_patch, user_id=user_id)
        except Exception:
            logger.warning("Saved configuration, but runtime cache refresh failed", exc_info=True)
        if scope_patch.keys() & MCP_KEYS:
            await _refresh_mcp(user_id)

    if "scheduler_enabled" in system_patch:
        await _refresh_scheduler()
    return get_effective_settings(current.id)


async def _refresh_mcp(user_id: str | None) -> None:
    from app import deps

    try:
        settings = get_effective_settings(user_id) if user_id else get_settings()
        manager = deps.get_mcp_manager_for_user(user_id)
        manager.set_tool_timeout_seconds(settings.mcp_tool_timeout_seconds)
        if user_id is None:
            # 用户 manager 创建时已经启动后台连接，应用级 manager 由生命周期显式启动。
            await asyncio.to_thread(manager.reconnect_sync, settings.mcp_servers)
    except Exception:
        # 配置已经保存，连接失败由 MCP 状态接口呈现，不回滚有效配置。
        logger.warning("Saved configuration, but MCP reconnect failed", exc_info=True)


async def _refresh_scheduler() -> None:
    from app.deps import get_scheduler_service

    try:
        scheduler = get_scheduler_service()
        if get_settings().scheduler_enabled:
            await scheduler.start()
        else:
            await scheduler.stop()
    except Exception:
        logger.warning("Saved configuration, but scheduler refresh failed", exc_info=True)
