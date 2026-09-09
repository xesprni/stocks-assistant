"""应用配置管理 API。"""

import asyncio
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError

from app.config import Settings, get_effective_settings
from app.core.app_store import get_app_store
from app.core.configuration.runtime import invalidate_runtime
from app.core.configuration.service import ConfigPermissionError, persist_config_update
from app.core.market.longbridge_oauth import longbridge_oauth_service, oauth_connected
from app.core.notifications.telegram import TelegramConfigError, TelegramSender
from app.core.security import CurrentUser, require_permissions, user_workspace_dir
from app.schemas.config import (
    AppConfig,
    ConfigReadinessResponse,
    ConfigUpdate,
    ConnectionCheck,
    ConnectionTestResponse,
    DemoDataResponse,
    TelegramTestRequest,
    TelegramTestResponse,
)
from app.schemas.longbridge_oauth import LongbridgeOAuthStatus

router = APIRouter()


def _readiness_checks(settings: Settings) -> list[ConnectionCheck]:
    llm_codex = settings.llm_auth_mode == "codex"
    llm_configured = bool(
        (llm_codex and _codex_oauth_status(settings).get("available"))
        or (not llm_codex and settings.llm_api_key and settings.llm_api_base and settings.llm_model)
    )
    embedding_codex = settings.embedding_auth_mode == "codex"
    embedding_configured = bool(
        (embedding_codex and _embedding_codex_oauth_status(settings).get("available"))
        or (
            not embedding_codex
            and (settings.embedding_api_key or settings.llm_api_key)
            and (settings.embedding_api_base or settings.llm_api_base)
            and settings.embedding_model
        )
    )
    longbridge_configured = (
        oauth_connected(settings)
        if settings.longbridge_auth_mode == "oauth"
        else bool(
            settings.longbridge_app_key
            and settings.longbridge_app_secret
            and settings.longbridge_access_token
        )
    )
    telegram_configured = bool(
        settings.telegram_enabled and settings.telegram_bot_token and settings.telegram_chat_id
    )
    search_configured = bool(settings.search_api_url and settings.search_api_key)
    return [
        ConnectionCheck(
            component="llm",
            status="ready" if llm_configured else "missing",
            configured=llm_configured,
            detail="主模型配置可用" if llm_configured else "请配置主模型认证、地址和模型名称",
        ),
        ConnectionCheck(
            component="embedding",
            status="ready" if embedding_configured else "missing",
            configured=embedding_configured,
            detail="Embedding 配置可用" if embedding_configured else "请配置 Embedding 认证和模型",
            depends_on=["memory", "knowledge_search"],
        ),
        ConnectionCheck(
            component="longbridge",
            status="ready" if longbridge_configured else "missing",
            configured=longbridge_configured,
            detail="Longbridge 凭据已配置"
            if longbridge_configured
            else "请完成长桥 OAuth 授权或配置 App Key、App Secret 和 Access Token",
            depends_on=["market", "financials", "watchlist"],
        ),
        ConnectionCheck(
            component="web_search",
            status="ready" if search_configured else "optional",
            configured=search_configured,
            detail="网页搜索已配置" if search_configured else "可选：配置搜索 API 后可检索公开网页",
            depends_on=["research"],
        ),
        ConnectionCheck(
            component="telegram",
            status="ready" if telegram_configured else "optional",
            configured=telegram_configured,
            detail="Telegram 通知已配置" if telegram_configured else "可选：启用后用于投递提醒",
            depends_on=["alerts"],
        ),
    ]


def _mask_secret(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}{'*' * 8}{value[-4:]}"


# 只从明确的公开字段白名单构造响应，新增 Settings 密钥不会自动出现在 API 中。
_PUBLIC_CONFIG_FIELDS = (
    "llm_provider",
    "llm_auth_mode",
    "llm_temperature",
    "llm_max_output_tokens",
    "llm_reasoning_effort",
    "llm_tool_choice",
    "embedding_auth_mode",
    "workspace_dir",
    "app_language",
    "research_quick_prompts_refresh_seconds",
    "auth_max_devices_per_user",
    "agent_max_steps",
    "agent_max_context_tokens",
    "agent_max_context_turns",
    "agent_tool_allowlist",
    "agent_allow_all_mcp_tools",
    "multi_agent_enabled",
    "multi_agent_max_parallel_agents",
    "multi_agent_max_tasks_per_batch",
    "multi_agent_task_timeout_seconds",
    "multi_agent_default_max_steps",
    "multi_agent_max_depth",
    "multi_agent_dangerous_tools",
    "multi_agent_roles",
    "knowledge_enabled",
    "memory_enabled",
    "memory_auto_curate_enabled",
    "memory_curator_min_importance",
    "memory_curator_min_confidence",
    "scheduler_enabled",
    "tracing_enabled",
    "product_analytics_enabled",
    "debug",
    "telegram_enabled",
    "system_prompt",
    "longbridge_auth_mode",
)
_PERSONAL_CONFIG_DEFAULTS = {
    "llm_api_base": "",
    "llm_model": "",
    "llm_codex_auth_file": "",
    "llm_codex_api_base": "",
    "llm_codex_model": "",
    "embedding_api_base": "",
    "embedding_model": "",
    "embedding_provider": "openai",
    "embedding_codex_auth_file": "",
    "embedding_codex_api_base": "",
    "embedding_codex_model": "",
    "telegram_chat_id": "",
    "telegram_api_base": "https://api.telegram.org",
    "telegram_parse_mode": "",
    "mcp_tool_timeout_seconds": 60.0,
    "longbridge_oauth_client_id": "",
    "longbridge_http_url": "",
    "longbridge_quote_ws_url": "",
    "search_api_url": "",
}
_SECRET_CONFIG_FIELDS = (
    "llm_api_key",
    "embedding_api_key",
    "telegram_bot_token",
    "longbridge_app_key",
    "longbridge_app_secret",
    "longbridge_access_token",
    "guardian_api_key",
    "search_api_key",
)


def _settings_to_response(
    settings: Settings,
    *,
    personal_keys: set[str] | None = None,
    hide_inherited_personal: bool = False,
) -> AppConfig:
    personal_keys = personal_keys or set()

    def visible(key: str) -> bool:
        return not hide_inherited_personal or key in personal_keys

    values = {key: getattr(settings, key) for key in _PUBLIC_CONFIG_FIELDS}
    values.update(
        {
            key: getattr(settings, key) if visible(key) else default
            for key, default in _PERSONAL_CONFIG_DEFAULTS.items()
        }
    )
    for key in _SECRET_CONFIG_FIELDS:
        secret = getattr(settings, key) if visible(key) else ""
        values[f"{key}_masked"] = _mask_secret(secret)
        values[f"has_{key}"] = bool(secret)

    for prefix, status_reader, keys in (
        (
            "codex_oauth",
            _codex_oauth_status,
            {
                "llm_provider",
                "llm_auth_mode",
                "llm_codex_auth_file",
                "llm_codex_api_base",
                "llm_codex_model",
            },
        ),
        (
            "embedding_codex_oauth",
            _embedding_codex_oauth_status,
            {
                "embedding_auth_mode",
                "embedding_codex_auth_file",
                "embedding_codex_api_base",
                "embedding_codex_model",
            },
        ),
    ):
        show_status = any(visible(key) for key in keys)
        oauth_status = status_reader(settings) if show_status else {}
        values[f"has_{prefix}"] = bool(oauth_status.get("available"))
        values[f"{prefix}_account_id_masked"] = _mask_secret(
            str(oauth_status.get("account_id") or "")
        )
        values[f"{prefix}_error"] = str(oauth_status.get("error") or "")
    values.update(
        mcp_servers=_mask_mcp_servers(settings.mcp_servers) if visible("mcp_servers") else {},
        longbridge_oauth_connected=oauth_connected(settings)
        if visible("longbridge_oauth_client_id")
        else False,
        personal_config_keys=sorted(personal_keys),
    )
    return AppConfig(**values)


def _mask_mcp_servers(servers: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    try:
        from app.core.tools.mcp.config import mask_mcp_server_config

        return {name: mask_mcp_server_config(cfg) for name, cfg in servers.items()}
    except Exception:
        return {}


def _codex_oauth_status(settings: Settings) -> dict[str, Any]:
    try:
        from app.core.llm.codex_auth import inspect_codex_oauth

        return inspect_codex_oauth(settings.llm_codex_auth_file or None)
    except Exception as exc:
        return {"available": False, "account_id": "", "error": str(exc)}


def _embedding_codex_oauth_status(settings: Settings) -> dict[str, Any]:
    try:
        from app.core.llm.codex_auth import inspect_codex_oauth

        auth_file = settings.embedding_codex_auth_file or settings.llm_codex_auth_file or None
        return inspect_codex_oauth(auth_file)
    except Exception as exc:
        return {"available": False, "account_id": "", "error": str(exc)}


def _refresh_runtime_caches(patch: dict[str, Any]) -> None:
    """保留旧导出；业务服务直接使用公共失效入口。"""
    invalidate_runtime(patch)


@router.get("", response_model=AppConfig)
def get_config(current: CurrentUser = Depends(require_permissions("config:read"))):
    """读取当前用户的有效配置。"""
    personal_keys = set(get_app_store().get_user_config(current.id).keys())
    return _settings_to_response(
        get_effective_settings(current.id),
        personal_keys=personal_keys,
        hide_inherited_personal=not current.can("config:write"),
    )


async def _persist_config_update(update: ConfigUpdate, current: CurrentUser) -> AppConfig:
    try:
        settings = await persist_config_update(update, current)
    except ConfigPermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc
    return _settings_to_response(
        settings,
        personal_keys=set(get_app_store().get_user_config(current.id)),
        hide_inherited_personal=not current.can("config:write"),
    )


@router.patch("", response_model=AppConfig)
async def patch_config(
    update: ConfigUpdate, current: CurrentUser = Depends(require_permissions("config:read"))
):
    """局部更新并持久化应用配置。"""
    return await _persist_config_update(update, current)


@router.get("/longbridge/oauth/status", response_model=LongbridgeOAuthStatus)
def longbridge_oauth_status(current: CurrentUser = Depends(require_permissions("config:read"))):
    return longbridge_oauth_service.status(current)


@router.post("/longbridge/oauth/start", response_model=LongbridgeOAuthStatus)
async def start_longbridge_oauth(
    current: CurrentUser = Depends(require_permissions("config:read")),
):
    return await longbridge_oauth_service.start(current)


@router.delete("/longbridge/oauth/disconnect", response_model=LongbridgeOAuthStatus)
async def disconnect_longbridge_oauth(
    current: CurrentUser = Depends(require_permissions("config:read")),
):
    return await longbridge_oauth_service.disconnect(current)


@router.put("", response_model=AppConfig)
async def update_config(
    update: ConfigUpdate, current: CurrentUser = Depends(require_permissions("config:read"))
):
    """兼容旧前端：PUT 仍按局部更新处理。"""
    return await _persist_config_update(update, current)


@router.get("/readiness", response_model=ConfigReadinessResponse)
def config_readiness(current: CurrentUser = Depends(require_permissions("config:read"))):
    """返回首次使用所需依赖的配置就绪状态，不发起外部请求。"""
    checks = _readiness_checks(get_effective_settings(current.id))
    required = [check for check in checks if check.component in {"llm", "embedding", "longbridge"}]
    return ConfigReadinessResponse(ready=all(check.configured for check in required), checks=checks)


@router.post("/connections/{component}/test", response_model=ConnectionTestResponse)
async def test_connection(
    component: str,
    current: CurrentUser = Depends(require_permissions("config:read")),
):
    """在用户明确点击测试后，对已保存的外部依赖执行最小只读检查。"""
    component = component.strip().lower()
    if component not in {"llm", "embedding", "longbridge"}:
        raise HTTPException(status_code=404, detail="Unsupported connection component")
    settings = get_effective_settings(current.id)
    readiness = {item.component: item for item in _readiness_checks(settings)}[component]
    if not readiness.configured:
        raise HTTPException(status_code=400, detail=readiness.detail)

    try:
        if component == "llm":
            from app.core.agent.models import LLMRequest
            from app.deps import create_llm_provider

            provider = create_llm_provider(settings)
            request = LLMRequest(
                messages=[
                    {"role": "user", "content": [{"type": "text", "text": "Reply with OK."}]}
                ],
                model=settings.llm_codex_model
                if settings.llm_auth_mode == "codex"
                else settings.llm_model,
                temperature=0,
                max_tokens=8,
            )
            await asyncio.wait_for(asyncio.to_thread(provider.call, request), timeout=45)
            detail = "主模型连接成功"
        elif component == "embedding":
            from app.deps import create_embedding_provider_from_settings

            provider = create_embedding_provider_from_settings(settings)
            if provider is None:
                raise ValueError("Embedding provider could not be initialized")
            vector = await asyncio.wait_for(
                asyncio.to_thread(provider.embed, "connection check"), timeout=30
            )
            if not vector:
                raise ValueError("Embedding provider returned an empty vector")
            detail = f"Embedding 连接成功，向量维度 {len(vector)}"
        else:
            from app.deps import get_market_service

            await asyncio.wait_for(
                asyncio.to_thread(get_market_service().get_market_status, settings=settings),
                timeout=30,
            )
            detail = "Longbridge 行情连接成功"
    except Exception as exc:
        raise HTTPException(
            status_code=502, detail=f"{component} connection test failed: {exc}"
        ) from exc

    return ConnectionTestResponse(
        component=component,
        ok=True,
        detail=detail,
        checked_at=datetime.now(UTC).isoformat(),
    )


@router.post("/demo-data", response_model=DemoDataResponse)
def seed_demo_data(
    current_user: CurrentUser = Depends(require_permissions("watchlist:write", "portfolio:write")),
):
    """用户明确触发后初始化教学数据；已有自选或组合时不会写入。"""
    from app.deps import get_portfolio_service, get_watchlist_service

    watchlist = get_watchlist_service().seed_sample_items(current_user.id)
    portfolio = get_portfolio_service().seed_sample_items(current_user.id)
    get_app_store().audit(
        current_user.id,
        "onboarding.demo_data",
        "user_workspace",
        {"watchlist_created": len(watchlist), "portfolio_created": len(portfolio)},
    )
    return DemoDataResponse(
        watchlist_created=len(watchlist),
        portfolio_created=len(portfolio),
        detail="示例数据已创建" if watchlist or portfolio else "已有数据，未写入示例",
    )


@router.post("/telegram/test", response_model=TelegramTestResponse)
async def test_telegram(
    request: TelegramTestRequest,
    current: CurrentUser = Depends(require_permissions("config:read")),
):
    """使用已保存的 Telegram 配置发送测试消息。"""
    settings = get_effective_settings(current.id)
    # 图片只允许从当前用户工作空间读取，不能使用系统根目录作为文件边界。
    sender = TelegramSender.from_settings(
        settings, workspace_dir=user_workspace_dir(settings.workspace_dir, current.id)
    )
    if not sender.enabled:
        raise HTTPException(status_code=400, detail="Telegram 通知未启用")
    if not sender.bot_token or not sender.chat_id:
        raise HTTPException(status_code=400, detail="Telegram Bot Token 或 Chat ID 未配置")

    message = request.message.strip()
    if not message and not request.photos:
        message = "Stocks Assistant Telegram test message."
    try:
        result = await asyncio.to_thread(sender.send_message, message, photos=request.photos)
    except (TelegramConfigError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return TelegramTestResponse(
        ok=True,
        chunks=int(result.get("chunks", 0) or 0),
        photos=int(result.get("photos", 0) or 0),
        detail="测试消息已发送",
    )
