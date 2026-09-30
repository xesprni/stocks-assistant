"""Security news API."""

from http import HTTPStatus

from fastapi import APIRouter, Depends, HTTPException, Query

from app.config import get_effective_settings
from app.constants.news import DEFAULT_NEWS_LIMIT, MAX_NEWS_LIMIT
from app.constants.security import Permission
from app.core.market.errors import LongbridgeUnavailableError
from app.core.security import CurrentUser, require_permissions
from app.deps import get_news_service
from app.schemas.news import SecurityNewsResponse

router = APIRouter()


@router.get("", response_model=SecurityNewsResponse)
def get_security_news(
    symbol: str = Query(..., min_length=1),
    limit: int = Query(DEFAULT_NEWS_LIMIT, ge=1, le=MAX_NEWS_LIMIT),
    current_user: CurrentUser = Depends(require_permissions(Permission.MARKET_READ)),
) -> SecurityNewsResponse:
    service = get_news_service()
    try:
        data = service.get_security_news(
            symbol=symbol,
            limit=limit,
            settings=get_effective_settings(current_user.id),
        )
    except ValueError as exc:
        raise HTTPException(status_code=HTTPStatus.BAD_REQUEST, detail=str(exc)) from exc
    except LongbridgeUnavailableError as exc:
        raise HTTPException(status_code=HTTPStatus.SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    return SecurityNewsResponse.model_validate(data)
