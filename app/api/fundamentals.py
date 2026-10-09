"""Fundamental data API."""

from http import HTTPStatus

from fastapi import APIRouter, Depends, HTTPException

from app.config import get_effective_settings
from app.constants.security import Permission
from app.core.market.errors import LongbridgeUnavailableError
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
    try:
        return get_earnings_radar_service().scan(
            body,
            settings=get_effective_settings(current_user.id),
        )
    except LongbridgeUnavailableError as exc:
        raise HTTPException(
            status_code=HTTPStatus.SERVICE_UNAVAILABLE,
            detail="Longbridge unavailable. Check the connection and market data permissions in Settings.",
        ) from exc
