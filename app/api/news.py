"""Security news API."""

from fastapi import APIRouter, Depends, HTTPException, Query

from app.config import get_effective_settings
from app.core.security import CurrentUser, require_permissions
from app.core.watchlist.service import LongbridgeUnavailableError
from app.deps import get_news_service
from app.schemas.news import SecurityNewsResponse

router = APIRouter()


@router.get("", response_model=SecurityNewsResponse)
async def get_security_news(
    symbol: str = Query(..., min_length=1),
    limit: int = Query(50, ge=1, le=100),
    current_user: CurrentUser = Depends(require_permissions("market:read")),
):
    service = get_news_service()
    try:
        data = service.get_security_news(
            symbol=symbol,
            limit=limit,
            settings=get_effective_settings(current_user.id),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except LongbridgeUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    return SecurityNewsResponse(**data)
