"""应用配置管理 API。"""

import asyncio
import json
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

import app.config as config_module
from app.config import Settings, get_settings
from app.core.notifications.telegram import TelegramConfigError, TelegramSender
from app.schemas.config import AppConfig, ConfigUpdate, TelegramTestRequest, TelegramTestResponse

router = APIRouter()

CONFIG_PATH = Path("config.json")


def _mask_secret(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}{'*' * 8}{value[-4:]}"


def _settings_to_response(settings: Settings) -> AppConfig:
    codex_status = _codex_oauth_status(settings)
    embedding_codex_status = _embedding_codex_oauth_status(settings)
    return AppConfig(
        llm_provider=settings.llm_provider,
        llm_auth_mode=settings.llm_auth_mode,
        llm_api_base=settings.llm_api_base,
        llm_model=settings.llm_model,
        llm_codex_auth_file=settings.llm_codex_auth_file,
        llm_codex_api_base=settings.llm_codex_api_base,
        llm_codex_model=settings.llm_codex_model,
        has_codex_oauth=bool(codex_status.get("available")),
        codex_oauth_account_id_masked=_mask_secret(str(codex_status.get("account_id") or "")),
        codex_oauth_error=str(codex_status.get("error") or ""),
        llm_api_key_masked=_mask_secret(settings.llm_api_key),
        has_llm_api_key=bool(settings.llm_api_key),
        embedding_auth_mode=settings.embedding_auth_mode,
        embedding_api_base=settings.embedding_api_base,
        embedding_model=settings.embedding_model,
        embedding_provider=settings.embedding_provider,
        embedding_codex_auth_file=settings.embedding_codex_auth_file,
        embedding_codex_api_base=settings.embedding_codex_api_base,
        embedding_codex_model=settings.embedding_codex_model,
        has_embedding_codex_oauth=bool(embedding_codex_status.get("available")),
        embedding_codex_oauth_account_id_masked=_mask_secret(str(embedding_codex_status.get("account_id") or "")),
        embedding_codex_oauth_error=str(embedding_codex_status.get("error") or ""),
        embedding_api_key_masked=_mask_secret(settings.embedding_api_key),
        has_embedding_api_key=bool(settings.embedding_api_key),
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
        telegram_bot_token_masked=_mask_secret(settings.telegram_bot_token),
        has_telegram_bot_token=bool(settings.telegram_bot_token),
        telegram_chat_id=settings.telegram_chat_id,
        telegram_api_base=settings.telegram_api_base,
        telegram_parse_mode=settings.telegram_parse_mode,
        system_prompt=settings.system_prompt,
        mcp_servers=settings.mcp_servers,
        mcp_tool_timeout_seconds=settings.mcp_tool_timeout_seconds,
        longbridge_app_key_masked=_mask_secret(settings.longbridge_app_key),
        has_longbridge_app_key=bool(settings.longbridge_app_key),
        longbridge_app_secret_masked=_mask_secret(settings.longbridge_app_secret),
        has_longbridge_app_secret=bool(settings.longbridge_app_secret),
        longbridge_access_token_masked=_mask_secret(settings.longbridge_access_token),
        has_longbridge_access_token=bool(settings.longbridge_access_token),
        longbridge_http_url=settings.longbridge_http_url,
        longbridge_quote_ws_url=settings.longbridge_quote_ws_url,
    )


def _read_config_file() -> Dict[str, Any]:
    if not CONFIG_PATH.exists():
        return {}
    try:
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f"config.json 格式错误: {exc}") from exc


def _write_config_file(data: Dict[str, Any]) -> None:
    CONFIG_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


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
        deps.get_embedding_provider.cache_clear()
    if tool_keys & patch.keys():
        deps.get_tool_manager.cache_clear()
    if skill_keys & patch.keys():
        deps.get_skill_manager.cache_clear()


@router.get("", response_model=AppConfig)
async def get_config():
    """读取当前应用配置。"""
    return _settings_to_response(get_settings())


@router.put("", response_model=AppConfig)
async def update_config(update: ConfigUpdate):
    """更新并持久化应用配置。"""
    patch = update.model_dump(exclude_unset=True)
    current = _read_config_file()
    merged = {**current, **patch}

    try:
        Settings(**{k: v for k, v in merged.items() if v != ""})
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc

    _write_config_file(merged)
    config_module._config_instance = None
    settings = get_settings()
    _refresh_runtime_caches(patch)
    if "scheduler_enabled" in patch:
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
            from app.deps import get_mcp_manager

            manager = get_mcp_manager()
            manager.set_tool_timeout_seconds(settings.mcp_tool_timeout_seconds)
            if "mcp_servers" in patch:
                manager.reconnect_sync(settings.mcp_servers)
        except Exception:
            # 连接错误会体现在 /mcp/status 中；配置保存不因此失败。
            pass
    return _settings_to_response(settings)


@router.post("/telegram/test", response_model=TelegramTestResponse)
async def test_telegram(request: TelegramTestRequest):
    """使用已保存的 Telegram 配置发送测试消息。"""
    sender = TelegramSender.from_settings(get_settings())
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
