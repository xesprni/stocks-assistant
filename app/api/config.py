"""应用配置管理 API。"""

import asyncio
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError

import app.config as config_module
from app.config import ALWAYS_USER_CONFIG_KEYS, Settings, USER_CONFIG_KEYS, get_effective_config, get_effective_settings, get_settings
from app.core.app_store import get_app_store
from app.core.notifications.telegram import TelegramConfigError, TelegramSender
from app.core.security import CurrentUser, require_permissions
from app.schemas.config import AppConfig, ConfigUpdate, TelegramTestRequest, TelegramTestResponse

router = APIRouter()


def _mask_secret(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}{'*' * 8}{value[-4:]}"


def _settings_to_response(
    settings: Settings,
    *,
    personal_keys: set[str] | None = None,
    hide_inherited_personal: bool = False,
) -> AppConfig:
    personal_keys = personal_keys or set()
    show_all = not hide_inherited_personal
    owns = personal_keys.__contains__
    show_codex_status = show_all or any(
        owns(key)
        for key in {"llm_provider", "llm_auth_mode", "llm_codex_auth_file", "llm_codex_api_base", "llm_codex_model"}
    )
    show_embedding_codex_status = show_all or any(
        owns(key)
        for key in {"embedding_auth_mode", "embedding_codex_auth_file", "embedding_codex_api_base", "embedding_codex_model"}
    )
    codex_status = _codex_oauth_status(settings)
    embedding_codex_status = _embedding_codex_oauth_status(settings)
    return AppConfig(
        llm_provider=settings.llm_provider,
        llm_auth_mode=settings.llm_auth_mode,
        llm_api_base=settings.llm_api_base if show_all or owns("llm_api_base") else "",
        llm_model=settings.llm_model if show_all or owns("llm_model") else "",
        llm_codex_auth_file=settings.llm_codex_auth_file if show_all or owns("llm_codex_auth_file") else "",
        llm_codex_api_base=settings.llm_codex_api_base if show_all or owns("llm_codex_api_base") else "",
        llm_codex_model=settings.llm_codex_model if show_all or owns("llm_codex_model") else "",
        has_codex_oauth=show_codex_status and bool(codex_status.get("available")),
        codex_oauth_account_id_masked=_mask_secret(str(codex_status.get("account_id") or "")) if show_codex_status else "",
        codex_oauth_error=str(codex_status.get("error") or "") if show_codex_status else "",
        llm_api_key_masked=_mask_secret(settings.llm_api_key) if show_all or owns("llm_api_key") else "",
        has_llm_api_key=(show_all or owns("llm_api_key")) and bool(settings.llm_api_key),
        embedding_auth_mode=settings.embedding_auth_mode,
        embedding_api_base=settings.embedding_api_base if show_all or owns("embedding_api_base") else "",
        embedding_model=settings.embedding_model if show_all or owns("embedding_model") else "",
        embedding_provider=settings.embedding_provider if show_all or owns("embedding_provider") else "openai",
        embedding_codex_auth_file=settings.embedding_codex_auth_file if show_all or owns("embedding_codex_auth_file") else "",
        embedding_codex_api_base=settings.embedding_codex_api_base if show_all or owns("embedding_codex_api_base") else "",
        embedding_codex_model=settings.embedding_codex_model if show_all or owns("embedding_codex_model") else "",
        has_embedding_codex_oauth=show_embedding_codex_status and bool(embedding_codex_status.get("available")),
        embedding_codex_oauth_account_id_masked=_mask_secret(str(embedding_codex_status.get("account_id") or "")) if show_embedding_codex_status else "",
        embedding_codex_oauth_error=str(embedding_codex_status.get("error") or "") if show_embedding_codex_status else "",
        embedding_api_key_masked=_mask_secret(settings.embedding_api_key) if show_all or owns("embedding_api_key") else "",
        has_embedding_api_key=(show_all or owns("embedding_api_key")) and bool(settings.embedding_api_key),
        workspace_dir=settings.workspace_dir,
        app_language=settings.app_language,
        agent_max_steps=settings.agent_max_steps,
        agent_max_context_tokens=settings.agent_max_context_tokens,
        agent_max_context_turns=settings.agent_max_context_turns,
        agent_tool_allowlist=settings.agent_tool_allowlist,
        agent_allow_all_mcp_tools=settings.agent_allow_all_mcp_tools,
        multi_agent_enabled=settings.multi_agent_enabled,
        multi_agent_max_parallel_agents=settings.multi_agent_max_parallel_agents,
        multi_agent_default_max_steps=settings.multi_agent_default_max_steps,
        multi_agent_max_depth=settings.multi_agent_max_depth,
        multi_agent_dangerous_tools=settings.multi_agent_dangerous_tools,
        multi_agent_roles=settings.multi_agent_roles,
        knowledge_enabled=settings.knowledge_enabled,
        memory_enabled=settings.memory_enabled,
        memory_auto_curate_enabled=settings.memory_auto_curate_enabled,
        memory_curator_min_importance=settings.memory_curator_min_importance,
        memory_curator_min_confidence=settings.memory_curator_min_confidence,
        scheduler_enabled=settings.scheduler_enabled,
        tracing_enabled=settings.tracing_enabled,
        debug=settings.debug,
        telegram_enabled=settings.telegram_enabled,
        telegram_bot_token_masked=_mask_secret(settings.telegram_bot_token) if show_all or owns("telegram_bot_token") else "",
        has_telegram_bot_token=(show_all or owns("telegram_bot_token")) and bool(settings.telegram_bot_token),
        telegram_chat_id=settings.telegram_chat_id if show_all or owns("telegram_chat_id") else "",
        telegram_api_base=settings.telegram_api_base if show_all or owns("telegram_api_base") else "https://api.telegram.org",
        telegram_parse_mode=settings.telegram_parse_mode if show_all or owns("telegram_parse_mode") else "",
        system_prompt=settings.system_prompt,
        mcp_servers=_mask_mcp_servers(settings.mcp_servers) if show_all or owns("mcp_servers") else {},
        mcp_tool_timeout_seconds=settings.mcp_tool_timeout_seconds if show_all or owns("mcp_tool_timeout_seconds") else 60.0,
        longbridge_app_key_masked=_mask_secret(settings.longbridge_app_key) if show_all or owns("longbridge_app_key") else "",
        has_longbridge_app_key=(show_all or owns("longbridge_app_key")) and bool(settings.longbridge_app_key),
        longbridge_app_secret_masked=_mask_secret(settings.longbridge_app_secret) if show_all or owns("longbridge_app_secret") else "",
        has_longbridge_app_secret=(show_all or owns("longbridge_app_secret")) and bool(settings.longbridge_app_secret),
        longbridge_access_token_masked=_mask_secret(settings.longbridge_access_token) if show_all or owns("longbridge_access_token") else "",
        has_longbridge_access_token=(show_all or owns("longbridge_access_token")) and bool(settings.longbridge_access_token),
        longbridge_http_url=settings.longbridge_http_url if show_all or owns("longbridge_http_url") else "",
        longbridge_quote_ws_url=settings.longbridge_quote_ws_url if show_all or owns("longbridge_quote_ws_url") else "",
        personal_config_keys=sorted(personal_keys),
    )


def _mask_mcp_servers(servers: Dict[str, Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    try:
        from app.core.tools.mcp.config import mask_mcp_server_config

        return {name: mask_mcp_server_config(cfg) for name, cfg in servers.items()}
    except Exception:
        return {}


def _codex_oauth_status(settings: Settings) -> Dict[str, Any]:
    try:
        from app.core.llm.codex_auth import inspect_codex_oauth

        return inspect_codex_oauth(settings.llm_codex_auth_file or None)
    except Exception as exc:
        return {"available": False, "account_id": "", "error": str(exc)}


def _embedding_codex_oauth_status(settings: Settings) -> Dict[str, Any]:
    try:
        from app.core.llm.codex_auth import inspect_codex_oauth

        auth_file = settings.embedding_codex_auth_file or settings.llm_codex_auth_file or None
        return inspect_codex_oauth(auth_file)
    except Exception as exc:
        return {"available": False, "account_id": "", "error": str(exc)}


def _refresh_runtime_caches(patch: Dict[str, Any]) -> None:
    """Clear cached dependencies that are affected by persisted config changes."""
    try:
        from app import deps
    except Exception:
        return

    llm_keys = {
        "llm_provider",
        "llm_auth_mode",
        "llm_api_key",
        "llm_api_base",
        "llm_model",
        "llm_codex_auth_file",
        "llm_codex_api_base",
        "llm_codex_model",
    }
    memory_keys = llm_keys | {
        "embedding_auth_mode",
        "embedding_api_key",
        "embedding_api_base",
        "embedding_model",
        "embedding_provider",
        "embedding_codex_auth_file",
        "embedding_codex_api_base",
        "embedding_codex_model",
        "memory_enabled",
        "workspace_dir",
    }
    tool_keys = {"workspace_dir", "memory_enabled"}
    skill_keys = {"workspace_dir"}

    if llm_keys & patch.keys():
        deps.get_llm_provider.cache_clear()
        deps.get_memory_llm_provider.cache_clear()
    if memory_keys & patch.keys():
        deps.get_memory_manager.cache_clear()
        deps.get_memory_manager_for_user.cache_clear()
        deps.get_embedding_provider.cache_clear()
    if tool_keys & patch.keys():
        deps.get_tool_manager.cache_clear()
    if skill_keys & patch.keys():
        deps.get_skill_manager.cache_clear()


@router.get("", response_model=AppConfig)
async def get_config(current: CurrentUser = Depends(require_permissions("config:read"))):
    """读取当前用户的有效配置。"""
    personal_keys = set(get_app_store().get_user_config(current.id).keys())
    return _settings_to_response(
        get_effective_settings(current.id),
        personal_keys=personal_keys,
        hide_inherited_personal=not current.can("config:write"),
    )


async def _persist_config_update(update: ConfigUpdate, current: CurrentUser) -> AppConfig:
    """更新并持久化配置。

    Admins update the shared system config. Non-admin users update only their
    personal provider/credential/channel/MCP overrides.
    """
    patch = {k: v for k, v in update.model_dump(exclude_unset=True).items() if v is not None}
    user_scoped = not current.can("config:write")
    if user_scoped:
        disallowed = sorted(set(patch) - USER_CONFIG_KEYS)
        if disallowed:
            raise HTTPException(status_code=403, detail=f"Only personal config keys can be updated: {', '.join(disallowed)}")

    user_patch = {key: value for key, value in patch.items() if user_scoped or key in ALWAYS_USER_CONFIG_KEYS}
    system_patch = {} if user_scoped else {key: value for key, value in patch.items() if key not in ALWAYS_USER_CONFIG_KEYS}

    stored = get_effective_config(current.id)
    if "mcp_servers" in patch:
        from app.core.tools.mcp.config import preserve_masked_mcp_secrets

        patch["mcp_servers"] = preserve_masked_mcp_secrets(stored.get("mcp_servers"), patch["mcp_servers"])
        if "mcp_servers" in user_patch:
            user_patch["mcp_servers"] = patch["mcp_servers"]
        if "mcp_servers" in system_patch:
            system_patch["mcp_servers"] = patch["mcp_servers"]
    merged = {**stored, **patch}

    try:
        Settings(**merged)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc

    settings = get_effective_settings(current.id)
    if user_patch:
        get_app_store().set_user_config_values(current.id, user_patch)
        get_app_store().audit(current.id, "config.user_update", "user_config", {"keys": sorted(user_patch)})
        settings = get_effective_settings(current.id)
        if (
            {
                "llm_provider",
                "llm_auth_mode",
                "llm_api_key",
                "llm_api_base",
                "llm_model",
                "llm_codex_auth_file",
                "llm_codex_api_base",
                "llm_codex_model",
                "embedding_auth_mode",
                "embedding_api_key",
                "embedding_api_base",
                "embedding_model",
                "embedding_provider",
                "embedding_codex_auth_file",
                "embedding_codex_api_base",
                "embedding_codex_model",
            }
            & user_patch.keys()
        ):
            try:
                from app import deps

                deps.get_memory_manager_for_user.cache_clear()
            except Exception:
                pass
        if {"mcp_servers", "mcp_tool_timeout_seconds"} & user_patch.keys():
            try:
                from app import deps

                deps.get_mcp_manager_for_user.cache_clear()
            except Exception:
                pass
    if system_patch:
        get_app_store().set_config_values(system_patch)
        get_app_store().audit(current.id, "config.update", "app_config", {"keys": sorted(system_patch)})
        config_module._config_instance = None
        settings = get_settings()
        _refresh_runtime_caches(system_patch)

    if "scheduler_enabled" in system_patch:
        try:
            from app.deps import get_scheduler_service

            scheduler = get_scheduler_service()
            if settings.scheduler_enabled:
                await scheduler.start()
            else:
                await scheduler.stop()
        except Exception:
            # 调度器状态可在任务页体现；配置保存不因此失败。
            pass
    if "mcp_servers" in patch or "mcp_tool_timeout_seconds" in patch:
        try:
            from app.deps import get_mcp_manager, get_mcp_manager_for_user

            manager = get_mcp_manager() if "mcp_servers" in system_patch else get_mcp_manager_for_user(current.id)
            manager.set_tool_timeout_seconds(settings.mcp_tool_timeout_seconds)
            if "mcp_servers" in patch:
                manager.reconnect_sync(settings.mcp_servers)
        except Exception:
            # 连接错误会体现在 /mcp/status 中；配置保存不因此失败。
            pass
    personal_keys = set(get_app_store().get_user_config(current.id).keys())
    return _settings_to_response(
        get_effective_settings(current.id),
        personal_keys=personal_keys,
        hide_inherited_personal=not current.can("config:write"),
    )


@router.patch("", response_model=AppConfig)
async def patch_config(update: ConfigUpdate, current: CurrentUser = Depends(require_permissions("config:read"))):
    """局部更新并持久化应用配置。"""
    return await _persist_config_update(update, current)


@router.put("", response_model=AppConfig)
async def update_config(update: ConfigUpdate, current: CurrentUser = Depends(require_permissions("config:read"))):
    """兼容旧前端：PUT 仍按局部更新处理。"""
    return await _persist_config_update(update, current)


@router.post("/telegram/test", response_model=TelegramTestResponse)
async def test_telegram(
    request: TelegramTestRequest,
    current: CurrentUser = Depends(require_permissions("config:read")),
):
    """使用已保存的 Telegram 配置发送测试消息。"""
    sender = TelegramSender.from_settings(get_effective_settings(current.id))
    if not sender.enabled:
        raise HTTPException(status_code=400, detail="Telegram 通知未启用")
    if not sender.bot_token or not sender.chat_id:
        raise HTTPException(status_code=400, detail="Telegram Bot Token 或 Chat ID 未配置")

    message = request.message.strip() or "Stocks Assistant Telegram test message."
    try:
        result = await asyncio.to_thread(sender.send_message, message)
    except TelegramConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return TelegramTestResponse(ok=True, chunks=int(result.get("chunks", 0) or 0), detail="测试消息已发送")
