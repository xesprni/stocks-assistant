"""Security news API."""

from fastapi import APIRouter, Depends, HTTPException, Query

from app.config import get_effective_settings
from app.core.security import CurrentUser, require_permissions
from app.core.news.service import GuardianConfigError, GuardianTranslationError, GuardianUpstreamError
from app.core.watchlist.service import LongbridgeUnavailableError
from app.deps import create_llm_provider, get_news_service
from app.schemas.news import (
    GuardianArticleResponse,
    GuardianFeedResponse,
    GuardianTranslateRequest,
    GuardianTranslateResponse,
    SecurityNewsResponse,
)

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


@router.get("/guardian/feed", response_model=GuardianFeedResponse)
async def get_guardian_feed(
    url: str = Query(..., min_length=1),
    limit: int = Query(30, ge=1, le=100),
    current_user: CurrentUser = Depends(require_permissions("market:read")),
):
    service = get_news_service()
    try:
        data = service.get_guardian_feed(url=url, limit=limit)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except GuardianUpstreamError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return GuardianFeedResponse(**data)


@router.get("/guardian/article", response_model=GuardianArticleResponse)
async def get_guardian_article(
    url: str = Query(..., min_length=1),
    current_user: CurrentUser = Depends(require_permissions("market:read")),
):
    service = get_news_service()
    try:
        data = service.get_guardian_article(url=url, settings=get_effective_settings(current_user.id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except GuardianConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except GuardianUpstreamError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return GuardianArticleResponse(**data)


@router.post("/guardian/translate", response_model=GuardianTranslateResponse)
async def translate_guardian_article(
    request: GuardianTranslateRequest,
    current_user: CurrentUser = Depends(require_permissions("market:read")),
):
    settings = get_effective_settings(current_user.id)
    service = get_news_service()
    try:
        llm_provider = create_llm_provider(settings)
        data = service.translate_guardian_text(
            text=request.text,
            llm_provider=llm_provider,
            target_language=request.target_language,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except GuardianTranslationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return GuardianTranslateResponse(**data)
