"""Fundamental data API."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from app.config import get_effective_settings
from app.core.watchlist.service import LongbridgeUnavailableError
from app.deps import get_fundamental_service
from app.core.security import CurrentUser, require_permissions
from app.schemas.fundamentals import FinancialReportsResponse

router = APIRouter()


@router.get("/financial-reports", response_model=FinancialReportsResponse)
async def get_financial_reports(
    symbol: str,
    kind: str = "All",
    period: Optional[str] = None,
    current_user: CurrentUser = Depends(require_permissions("fundamentals:read")),
):
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
        raise HTTPException(status_code=400, detail=str(exc))
    except LongbridgeUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    return FinancialReportsResponse(**data)
