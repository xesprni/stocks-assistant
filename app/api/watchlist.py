"""Watchlist API."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.deps import get_watchlist_service
from app.config import get_effective_settings
from app.core.watchlist.service import LongbridgeUnavailableError
from app.core.security import CurrentUser, require_permissions
from app.schemas.watchlist import (
    WatchlistCategory,
    WatchlistItem,
    WatchlistItemCreate,
    WatchlistListResponse,
    WatchlistReorderRequest,
    WatchlistSearchResponse,
    WatchlistSearchResult,
)

router = APIRouter()


@router.get("", response_model=WatchlistListResponse)
async def list_watchlist(
    category: Optional[WatchlistCategory] = None,
    current_user: CurrentUser = Depends(require_permissions("watchlist:read")),
):
    service = get_watchlist_service()
    items = [WatchlistItem(**item) for item in service.list_items(category, user_id=current_user.id)]
    return WatchlistListResponse(items=items, total=len(items))


@router.post("", response_model=WatchlistItem)
async def add_watchlist_item(
    item: WatchlistItemCreate,
    current_user: CurrentUser = Depends(require_permissions("watchlist:write")),
):
    service = get_watchlist_service()
    return WatchlistItem(**service.add_item(item, user_id=current_user.id))


@router.get("/search", response_model=WatchlistSearchResponse)
async def search_watchlist(
    q: str = Query(..., min_length=1),
    category: Optional[WatchlistCategory] = None,
    limit: int = Query(10, ge=1, le=20),
    current_user: CurrentUser = Depends(require_permissions("watchlist:read")),
):
    service = get_watchlist_service()
    try:
        results = [
            WatchlistSearchResult(**item)
            for item in service.search(query=q, category=category, limit=limit, settings=get_effective_settings(current_user.id))
        ]
    except LongbridgeUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    return WatchlistSearchResponse(results=results, total=len(results))


@router.delete("/{item_id}")
async def delete_watchlist_item(
    item_id: int,
    current_user: CurrentUser = Depends(require_permissions("watchlist:write")),
):
    service = get_watchlist_service()
    try:
        service.delete_item(item_id, user_id=current_user.id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Watchlist item not found")
    return {"status": "ok"}


@router.patch("/reorder")
async def reorder_watchlist(
    body: WatchlistReorderRequest,
    current_user: CurrentUser = Depends(require_permissions("watchlist:write")),
):
    """Update sort_order for all items according to the provided ID sequence."""
    service = get_watchlist_service()
    service.reorder_items(body.ids, user_id=current_user.id)
    return {"status": "ok"}
