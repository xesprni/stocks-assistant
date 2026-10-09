"""Fundamental data API."""

from http import HTTPStatus

from fastapi import APIRouter, Depends, HTTPException

from app.config import get_effective_settings
from app.constants.security import Permission
from app.core.market.errors import LongbridgeTokenExpiredError, LongbridgeUnavailableError
from app.core.market.longbridge_context import content_language
from app.core.security import CurrentUser, require_permissions
from app.deps import get_earnings_radar_service, get_fundamental_service
from app.schemas.earnings import EarningsRadarRequest, EarningsRadarResponse
from app.schemas.fundamentals import FinancialReportsResponse

router = APIRouter()

# FundamentalContext 是同步 SDK；同步路由会由 FastAPI 在线程池执行。


@router.get("/financial-reports", response_model=FinancialReportsResponse)
def get_financial_reports(
    symbol: str,
    kind: str = "All",
    period: str | None = None,
    current_user: CurrentUser = Depends(require_permissions(Permission.FUNDAMENTALS_READ)),
) -> FinancialReportsResponse:
    """Fetch normalized financial statements from Longbridge SDK."""

    service = get_fundamental_service()
    try:
        data = service.get_financial_reports(
            symbol=symbol,
            kind=kind,
            period=period,
            settings=get_effective_settings(current_user.id),
        )
    except ValueError as exc:
        raise HTTPException(status_code=HTTPStatus.BAD_REQUEST, detail=str(exc)) from exc
    except LongbridgeUnavailableError as exc:
        raise HTTPException(status_code=HTTPStatus.SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    return FinancialReportsResponse.model_validate(data)


@router.post("/earnings-radar", response_model=EarningsRadarResponse)
def scan_earnings_radar(
    body: EarningsRadarRequest,
    current_user: CurrentUser = Depends(require_permissions(Permission.FUNDAMENTALS_READ)),
) -> EarningsRadarResponse:
    """只读扫描；使用当前用户的配置快照，不访问其他用户自选股。"""
    settings = get_effective_settings(current_user.id)
    try:
        return get_earnings_radar_service().scan(
            body,
            settings=settings,
        )
    except LongbridgeTokenExpiredError as exc:
        # 上游认证失败不是应用登录失效，使用 503 避免前端刷新应用 JWT。
        raise HTTPException(
            status_code=HTTPStatus.SERVICE_UNAVAILABLE,
            detail=(
                "长桥凭据已过期，请在设置中重新连接 Longbridge 或更新 Access Token 后重试。"
                if content_language(settings) == "zh"
                else "Longbridge token expired. Reconnect Longbridge or update the Access Token in Settings."
            ),
        ) from exc
    except LongbridgeUnavailableError as exc:
        raise HTTPException(
            status_code=HTTPStatus.SERVICE_UNAVAILABLE,
            detail=(
                "无法获取财报雷达数据，请检查设置中的长桥连接及行情权限后重试。"
                if content_language(settings) == "zh"
                else "Longbridge unavailable. Check the connection and market data permissions in Settings."
            ),
        ) from exc
