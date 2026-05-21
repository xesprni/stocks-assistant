"""Portfolio API."""

from fastapi import APIRouter, Depends, HTTPException

from app.core.watchlist.service import LongbridgeUnavailableError
from app.deps import get_portfolio_service
from app.core.security import CurrentUser, require_permissions
from app.schemas.portfolio import (
    PortfolioItem,
    PortfolioItemCreate,
    PortfolioItemUpdate,
    PortfolioListResponse,
    PortfolioMarket,
    PortfolioSearchResponse,
    PortfolioSearchResult,
    PortfolioSettings,
    PortfolioSettingsUpdate,
)

router = APIRouter()


@router.get("", response_model=PortfolioListResponse)
async def list_portfolio(
    market: PortfolioMarket = "US",
    current_user: CurrentUser = Depends(require_permissions("portfolio:read")),
):
    """List portfolio holdings for one market."""
    service = get_portfolio_service()
    return PortfolioListResponse(**service.list_items(market, user_id=current_user.id))


@router.post("", response_model=PortfolioItem)
async def add_portfolio_item(
    item: PortfolioItemCreate,
    current_user: CurrentUser = Depends(require_permissions("portfolio:write")),
):
    """Add or update one holding by symbol."""
    service = get_portfolio_service()
    return PortfolioItem(**service.add_item(item, user_id=current_user.id))


@router.get("/search", response_model=PortfolioSearchResponse)
async def search_portfolio_symbols(
    q: str,
    market: PortfolioMarket = "US",
    limit: int = 10,
    _: CurrentUser = Depends(require_permissions("portfolio:read")),
):
    """Search US or A-share symbols through Longbridge."""
    service = get_portfolio_service()
    try:
        results = [PortfolioSearchResult(**item) for item in service.search(q, market, limit)]
    except LongbridgeUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return PortfolioSearchResponse(results=results, total=len(results))


@router.put("/settings/{market}", response_model=PortfolioSettings)
async def update_portfolio_settings(
    market: PortfolioMarket,
    body: PortfolioSettingsUpdate,
    current_user: CurrentUser = Depends(require_permissions("portfolio:write")),
):
    """Update capital denominator for one market."""
    service = get_portfolio_service()
    return PortfolioSettings(**service.save_settings(market, body.total_capital, user_id=current_user.id))


@router.patch("/{item_id}", response_model=PortfolioItem)
async def update_portfolio_item(
    item_id: int,
    item: PortfolioItemUpdate,
    current_user: CurrentUser = Depends(require_permissions("portfolio:write")),
):
    """Update one holding."""
    service = get_portfolio_service()
    try:
        return PortfolioItem(**service.update_item(item_id, item, user_id=current_user.id))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Portfolio item not found") from exc


@router.delete("/{item_id}")
async def delete_portfolio_item(
    item_id: int,
    current_user: CurrentUser = Depends(require_permissions("portfolio:write")),
):
    """Delete one holding."""
    service = get_portfolio_service()
    try:
        service.delete_item(item_id, user_id=current_user.id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Portfolio item not found") from exc
    return {"status": "ok"}
