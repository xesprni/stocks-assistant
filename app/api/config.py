"""应用配置管理 API。"""

import asyncio
from datetime import UTC, datetime
from http import HTTPStatus
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError

from app.config import Settings, get_effective_settings
from app.constants.configuration import (
    _PERSONAL_CONFIG_DEFAULTS as _PERSONAL_CONFIG_DEFAULTS,
)
from app.constants.configuration import (
    _PUBLIC_CONFIG_FIELDS as _PUBLIC_CONFIG_FIELDS,
)
from app.constants.configuration import (
    _SECRET_CONFIG_FIELDS as _SECRET_CONFIG_FIELDS,
)
from app.constants.configuration import (
    CONNECTION_CHECK_TIMEOUT_SECONDS,
    LLM_CONNECTION_CHECK_TIMEOUT_SECONDS,
)
from app.constants.security import Permission
from app.core.app_store import get_app_store
from app.core.configuration.runtime import invalidate_runtime
from app.core.configuration.service import ConfigPermissionError, persist_config_update
from app.core.market.longbridge_oauth import longbridge_oauth_service, oauth_connected
from app.core.notifications.telegram import TelegramConfigError, TelegramSender
from app.core.security import CurrentUser, require_permissions, user_workspace_dir
from app.schemas.config import (
    AppConfig,
    CodexOAuthStatus,
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
        (llm_codex and _codex_oauth_status(settings).available)
        or (not llm_codex and settings.llm_api_key and settings.llm_api_base and settings.llm_model)
    )
    embedding_codex = settings.embedding_auth_mode == "codex"
    embedding_configured = bool(
        (embedding_codex and _embedding_codex_oauth_status(settings).available)
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
            depends_on=["chat"],
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


def _settings_to_response(
    settings: Settings,
    *,
    personal_keys: set[str] | None = None,
    hide_inherited_personal: bool = False,
) -> AppConfig:
    # 已退役配置可能仍在旧数据库中，只向前端声明当前支持的个人配置项。
    personal_keys = (personal_keys or set()) & Settings.model_fields.keys()

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
        oauth_status = (
            CodexOAuthStatus.model_validate(status_reader(settings))
            if show_status
            else CodexOAuthStatus(available=False, account_id="")
        )
        values[f"has_{prefix}"] = bool(oauth_status.available)
        values[f"{prefix}_account_id_masked"] = _mask_secret(str(oauth_status.account_id or ""))
        values[f"{prefix}_error"] = str(oauth_status.error or "")
    values.update(
        mcp_servers=_mask_mcp_servers(settings.mcp_servers) if visible("mcp_servers") else {},
        longbridge_oauth_connected=oauth_connected(settings)
        if visible("longbridge_oauth_client_id")
        else False,
        personal_config_keys=sorted(personal_keys),
    )
    return AppConfig.model_validate(values)


def _mask_mcp_servers(servers: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    try:
        from app.core.tools.mcp.config import mask_mcp_server_config

        return {name: mask_mcp_server_config(cfg) for name, cfg in servers.items()}
    except Exception:
        return {}


def _codex_oauth_status(settings: Settings) -> CodexOAuthStatus:
    try:
        from app.core.llm.codex_auth import inspect_codex_oauth

        return inspect_codex_oauth(settings.llm_codex_auth_file or None)
    except Exception as exc:
        return CodexOAuthStatus(available=False, account_id="", error=str(exc))


def _embedding_codex_oauth_status(settings: Settings) -> CodexOAuthStatus:
    try:
        from app.core.llm.codex_auth import inspect_codex_oauth

        auth_file = settings.embedding_codex_auth_file or settings.llm_codex_auth_file or None
        return inspect_codex_oauth(auth_file)
    except Exception as exc:
        return CodexOAuthStatus(available=False, account_id="", error=str(exc))


def _refresh_runtime_caches(patch: dict[str, Any]) -> None:
    """保留旧导出；业务服务直接使用公共失效入口。"""
    invalidate_runtime(patch)


@router.get("", response_model=AppConfig)
def get_config(
    current: CurrentUser = Depends(require_permissions(Permission.CONFIG_READ)),
) -> AppConfig:
    """读取当前用户的有效配置。"""
    personal_keys = set(get_app_store().get_user_config(current.id).keys())
    return _settings_to_response(
        get_effective_settings(current.id),
        personal_keys=personal_keys,
        hide_inherited_personal=not current.can(Permission.CONFIG_WRITE),
    )


async def _persist_config_update(update: ConfigUpdate, current: CurrentUser) -> AppConfig:
    try:
        settings = await persist_config_update(update, current)
    except ConfigPermissionError as exc:
        raise HTTPException(status_code=HTTPStatus.FORBIDDEN, detail=str(exc)) from exc
    except ValidationError as exc:
        raise HTTPException(
            status_code=HTTPStatus.UNPROCESSABLE_CONTENT, detail=exc.errors()
        ) from exc
    return _settings_to_response(
        settings,
        personal_keys=set(get_app_store().get_user_config(current.id)),
        hide_inherited_personal=not current.can(Permission.CONFIG_WRITE),
    )


@router.patch("", response_model=AppConfig)
async def patch_config(
    update: ConfigUpdate,
    current: CurrentUser = Depends(require_permissions(Permission.CONFIG_READ)),
) -> AppConfig:
    """局部更新并持久化应用配置。"""
    return await _persist_config_update(update, current)


@router.get("/longbridge/oauth/status", response_model=LongbridgeOAuthStatus)
def longbridge_oauth_status(
    current: CurrentUser = Depends(require_permissions(Permission.CONFIG_READ)),
) -> LongbridgeOAuthStatus:
    return longbridge_oauth_service.status(current)


@router.post("/longbridge/oauth/start", response_model=LongbridgeOAuthStatus)
async def start_longbridge_oauth(
    current: CurrentUser = Depends(require_permissions(Permission.CONFIG_READ)),
) -> LongbridgeOAuthStatus:
    return await longbridge_oauth_service.start(current)


@router.delete("/longbridge/oauth/disconnect", response_model=LongbridgeOAuthStatus)
async def disconnect_longbridge_oauth(
    current: CurrentUser = Depends(require_permissions(Permission.CONFIG_READ)),
) -> LongbridgeOAuthStatus:
    return await longbridge_oauth_service.disconnect(current)


@router.put("", response_model=AppConfig)
async def update_config(
    update: ConfigUpdate,
    current: CurrentUser = Depends(require_permissions(Permission.CONFIG_READ)),
) -> AppConfig:
    """兼容旧前端：PUT 仍按局部更新处理。"""
    return await _persist_config_update(update, current)


@router.get("/readiness", response_model=ConfigReadinessResponse)
def config_readiness(
    current: CurrentUser = Depends(require_permissions(Permission.CONFIG_READ)),
) -> ConfigReadinessResponse:
    """返回首次使用所需依赖的配置就绪状态，不发起外部请求。"""
    checks = _readiness_checks(get_effective_settings(current.id))
    required = [check for check in checks if check.component in {"llm", "embedding", "longbridge"}]
    return ConfigReadinessResponse(ready=all(check.configured for check in required), checks=checks)


@router.post("/connections/{component}/test", response_model=ConnectionTestResponse)
async def test_connection(
    component: str,
    current: CurrentUser = Depends(require_permissions(Permission.CONFIG_READ)),
) -> ConnectionTestResponse:
    """在用户明确点击测试后，对已保存的外部依赖执行最小只读检查。"""
    component = component.strip().lower()
    if component not in {"llm", "embedding", "longbridge"}:
        raise HTTPException(
            status_code=HTTPStatus.NOT_FOUND, detail="Unsupported connection component"
        )
    settings = get_effective_settings(current.id)
    readiness = {item.component: item for item in _readiness_checks(settings)}[component]
    if not readiness.configured:
        raise HTTPException(status_code=HTTPStatus.BAD_REQUEST, detail=readiness.detail)

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
            await asyncio.wait_for(
                asyncio.to_thread(provider.call, request),
                timeout=LLM_CONNECTION_CHECK_TIMEOUT_SECONDS,
            )
            detail = "主模型连接成功"
        elif component == "embedding":
            from app.deps import create_embedding_provider_from_settings

            provider = create_embedding_provider_from_settings(settings)
            if provider is None:
                raise ValueError("Embedding provider could not be initialized")
            vector = await asyncio.wait_for(
                asyncio.to_thread(provider.embed, "connection check"),
                timeout=CONNECTION_CHECK_TIMEOUT_SECONDS,
            )
            if not vector:
                raise ValueError("Embedding provider returned an empty vector")
            detail = f"Embedding 连接成功，向量维度 {len(vector)}"
        else:
            from app.deps import get_market_service

            await asyncio.wait_for(
                asyncio.to_thread(get_market_service().get_market_status, settings=settings),
                timeout=CONNECTION_CHECK_TIMEOUT_SECONDS,
            )
            detail = "Longbridge 行情连接成功"
    except Exception as exc:
        raise HTTPException(
            status_code=HTTPStatus.BAD_GATEWAY, detail=f"{component} connection test failed: {exc}"
        ) from exc

    return ConnectionTestResponse(
        component=component,
        ok=True,
        detail=detail,
        checked_at=datetime.now(UTC).isoformat(),
    )


@router.post("/demo-data", response_model=DemoDataResponse)
def seed_demo_data(
    current_user: CurrentUser = Depends(
        require_permissions(Permission.WATCHLIST_WRITE, Permission.PORTFOLIO_WRITE)
    ),
) -> DemoDataResponse:
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
    current: CurrentUser = Depends(require_permissions(Permission.CONFIG_READ)),
) -> TelegramTestResponse:
    """使用已保存的 Telegram 配置发送测试消息。"""
    settings = get_effective_settings(current.id)
    # 图片只允许从当前用户工作空间读取，不能使用系统根目录作为文件边界。
    sender = TelegramSender.from_settings(
        settings, workspace_dir=user_workspace_dir(settings.workspace_dir, current.id)
    )
    if not sender.enabled:
        raise HTTPException(status_code=HTTPStatus.BAD_REQUEST, detail="Telegram 通知未启用")
    if not sender.bot_token or not sender.chat_id:
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST, detail="Telegram Bot Token 或 Chat ID 未配置"
        )

    message = request.message.strip()
    if not message and not request.photos:
        message = "Stocks Assistant Telegram test message."
    try:
        result = await asyncio.to_thread(sender.send_message, message, photos=request.photos)
    except (TelegramConfigError, ValueError) as exc:
        raise HTTPException(status_code=HTTPStatus.BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=HTTPStatus.BAD_GATEWAY, detail=str(exc)) from exc

    return TelegramTestResponse(
        ok=True,
        chunks=int(result.chunks or 0),
        photos=int(result.photos or 0),
        detail="测试消息已发送",
    )
