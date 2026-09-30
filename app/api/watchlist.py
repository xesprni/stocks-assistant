"""Watchlist API."""

from functools import partial
from http import HTTPStatus

from fastapi import APIRouter, Depends, HTTPException, Query
from starlette.concurrency import run_in_threadpool

from app.config import get_effective_settings
from app.constants.market import (
    DEFAULT_SYMBOL_SEARCH_LIMIT,
    MAX_SYMBOL_SEARCH_LIMIT,
    WATCHLIST_QUOTE_FIELDS,
)
from app.constants.security import Permission
from app.core.dashboard.service import DashboardService
from app.core.market.errors import LongbridgeUnavailableError
from app.core.security import CurrentUser, require_permissions
from app.deps import get_market_service, get_portfolio_service, get_watchlist_service
from app.schemas.common import StatusResponse
from app.schemas.dashboard import DashboardWatchlistModule, DashboardWatchlistViews
from app.schemas.watchlist import (
    WatchlistCategory,
    WatchlistGroupMembersWrite,
    WatchlistGroupsResponse,
    WatchlistGroupWrite,
    WatchlistItem,
    WatchlistItemCreate,
    WatchlistListResponse,
    WatchlistOverviewResponse,
    WatchlistReorderRequest,
    WatchlistSearchResponse,
    WatchlistSearchResult,
)

router = APIRouter()


@router.get("/groups", response_model=WatchlistGroupsResponse)
def list_watchlist_groups(
    current_user: CurrentUser = Depends(require_permissions(Permission.WATCHLIST_READ)),
) -> WatchlistGroupsResponse:
    return WatchlistGroupsResponse(groups=get_watchlist_service().list_groups(current_user.id))


@router.post("/groups", response_model=WatchlistGroupsResponse)
def create_watchlist_group(
    body: WatchlistGroupWrite,
    current_user: CurrentUser = Depends(require_permissions(Permission.WATCHLIST_WRITE)),
) -> WatchlistGroupsResponse:
    service = get_watchlist_service()
    try:
        service.save_group(body.name, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=HTTPStatus.BAD_REQUEST, detail=str(exc)) from exc
    return WatchlistGroupsResponse(groups=service.list_groups(current_user.id))


@router.patch("/groups/{group_id}", response_model=WatchlistGroupsResponse)
def rename_watchlist_group(
    group_id: int,
    body: WatchlistGroupWrite,
    current_user: CurrentUser = Depends(require_permissions(Permission.WATCHLIST_WRITE)),
) -> WatchlistGroupsResponse:
    service = get_watchlist_service()
    try:
        service.save_group(body.name, current_user.id, group_id)
    except KeyError:
        raise HTTPException(
            status_code=HTTPStatus.NOT_FOUND, detail="Watchlist group not found"
        ) from None
    except ValueError as exc:
        raise HTTPException(status_code=HTTPStatus.BAD_REQUEST, detail=str(exc)) from exc
    return WatchlistGroupsResponse(groups=service.list_groups(current_user.id))


@router.delete("/groups/{group_id}", response_model=WatchlistGroupsResponse)
def delete_watchlist_group(
    group_id: int,
    current_user: CurrentUser = Depends(require_permissions(Permission.WATCHLIST_WRITE)),
) -> WatchlistGroupsResponse:
    service = get_watchlist_service()
    try:
        service.delete_group(group_id, current_user.id)
    except KeyError:
        raise HTTPException(
            status_code=HTTPStatus.NOT_FOUND, detail="Watchlist group not found"
        ) from None
    return WatchlistGroupsResponse(groups=service.list_groups(current_user.id))


@router.put("/groups/{group_id}/members", response_model=WatchlistGroupsResponse)
def set_watchlist_group_members(
    group_id: int,
    body: WatchlistGroupMembersWrite,
    current_user: CurrentUser = Depends(require_permissions(Permission.WATCHLIST_WRITE)),
) -> WatchlistGroupsResponse:
    service = get_watchlist_service()
    try:
        service.set_group_members(group_id, body.item_ids, current_user.id)
    except KeyError:
        raise HTTPException(
            status_code=HTTPStatus.NOT_FOUND, detail="Watchlist group not found"
        ) from None
    except ValueError as exc:
        raise HTTPException(status_code=HTTPStatus.BAD_REQUEST, detail=str(exc)) from exc
    return WatchlistGroupsResponse(groups=service.list_groups(current_user.id))


@router.get("", response_model=WatchlistListResponse)
def list_watchlist(
    category: WatchlistCategory | None = None,
    current_user: CurrentUser = Depends(require_permissions(Permission.WATCHLIST_READ)),
) -> WatchlistListResponse:
    service = get_watchlist_service()
    items = [
        WatchlistItem.model_validate(item)
        for item in service.list_items(category, user_id=current_user.id)
    ]
    return WatchlistListResponse(items=items, total=len(items))


@router.get("/overview", response_model=WatchlistOverviewResponse)
async def watchlist_overview(
    current_user: CurrentUser = Depends(require_permissions(Permission.WATCHLIST_READ)),
) -> WatchlistOverviewResponse:
    """手动加载 Watchlist 行情概览；首屏列表接口不会触发该逻辑。"""
    service = DashboardService(
        market_service=get_market_service(),
        watchlist_service=get_watchlist_service(),
        portfolio_service=get_portfolio_service(),
    )
    payload = await run_in_threadpool(
        partial(
            service.watchlist,
            user=current_user,
            settings=get_effective_settings(current_user.id),
            mode="full",
        )
    )
    if not current_user.can(Permission.MARKET_READ):
        payload = _strip_watchlist_quote_payload(payload)
        payload.quote_error = "Missing permission: market:read"
    return WatchlistOverviewResponse.model_validate(payload)


@router.post("", response_model=WatchlistItem)
def add_watchlist_item(
    item: WatchlistItemCreate,
    current_user: CurrentUser = Depends(require_permissions(Permission.WATCHLIST_WRITE)),
) -> WatchlistItem:
    service = get_watchlist_service()
    try:
        return WatchlistItem.model_validate(service.add_item(item, user_id=current_user.id))
    except ValueError as exc:
        raise HTTPException(status_code=HTTPStatus.BAD_REQUEST, detail=str(exc)) from exc


@router.get("/search", response_model=WatchlistSearchResponse)
def search_watchlist(
    q: str = Query(..., min_length=1),
    category: WatchlistCategory | None = None,
    limit: int = Query(DEFAULT_SYMBOL_SEARCH_LIMIT, ge=1, le=MAX_SYMBOL_SEARCH_LIMIT),
    current_user: CurrentUser = Depends(require_permissions(Permission.WATCHLIST_READ)),
) -> WatchlistSearchResponse:
    service = get_watchlist_service()
    try:
        results = [
            WatchlistSearchResult.model_validate(item)
            for item in service.search(
                query=q,
                category=category,
                limit=limit,
                settings=get_effective_settings(current_user.id),
            )
        ]
    except LongbridgeUnavailableError as exc:
        raise HTTPException(status_code=HTTPStatus.SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    return WatchlistSearchResponse(results=results, total=len(results))


@router.delete("/{item_id}")
def delete_watchlist_item(
    item_id: int,
    current_user: CurrentUser = Depends(require_permissions(Permission.WATCHLIST_WRITE)),
) -> StatusResponse:
    service = get_watchlist_service()
    try:
        service.delete_item(item_id, user_id=current_user.id)
    except KeyError:
        raise HTTPException(
            status_code=HTTPStatus.NOT_FOUND, detail="Watchlist item not found"
        ) from None
    return StatusResponse()


@router.patch("/reorder")
def reorder_watchlist(
    body: WatchlistReorderRequest,
    current_user: CurrentUser = Depends(require_permissions(Permission.WATCHLIST_WRITE)),
) -> StatusResponse:
    """Update sort_order for all items according to the provided ID sequence."""
    service = get_watchlist_service()
    service.reorder_items(body.ids, user_id=current_user.id)
    return StatusResponse()


def _strip_watchlist_quote_payload(payload: DashboardWatchlistModule) -> DashboardWatchlistModule:
    """无行情权限时清空所有报价字段；深拷贝保护共享缓存。"""
    result = DashboardWatchlistModule.model_validate(payload).model_copy(deep=True)
    for row in result.items:
        for field in WATCHLIST_QUOTE_FIELDS:
            setattr(row, field, None)
    result.views = DashboardWatchlistViews(
        movers=list(result.items),
        gainers=list(result.items),
        losers=list(result.items),
        active=list(result.items),
    )
    result.source = "local"
    result.stale = False
    return result
