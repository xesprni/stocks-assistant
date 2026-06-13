"""Portfolio API."""

from fastapi import APIRouter, Depends, HTTPException

from app.config import get_effective_settings
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
    PortfolioSellRequest,
    PortfolioSellResponse,
    PortfolioSettings,
    PortfolioSettingsUpdate,
    PortfolioTransactionListResponse,
)

router = APIRouter()


@router.get("", response_model=PortfolioListResponse)
async def list_portfolio(
    market: PortfolioMarket = "US",
    current_user: CurrentUser = Depends(require_permissions("portfolio:read")),
):
    """List portfolio holdings for one market."""
    service = get_portfolio_service()
    return PortfolioListResponse(**service.list_items(market, user_id=current_user.id, settings=get_effective_settings(current_user.id)))


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
    current_user: CurrentUser = Depends(require_permissions("portfolio:read")),
):
    """Search US or A-share symbols through Longbridge."""
    service = get_portfolio_service()
    try:
        results = [
            PortfolioSearchResult(**item)
            for item in service.search(q, market, limit, settings=get_effective_settings(current_user.id))
        ]
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


@router.get("/transactions", response_model=PortfolioTransactionListResponse)
async def list_portfolio_transactions(
    market: PortfolioMarket = "US",
    limit: int = 100,
    current_user: CurrentUser = Depends(require_permissions("portfolio:read")),
):
    """List local portfolio transaction history."""
    service = get_portfolio_service()
    return PortfolioTransactionListResponse(**service.list_transactions(market, user_id=current_user.id, limit=limit))


@router.post("/{item_id}/sell", response_model=PortfolioSellResponse)
async def sell_portfolio_item(
    item_id: int,
    body: PortfolioSellRequest,
    current_user: CurrentUser = Depends(require_permissions("portfolio:write")),
):
    """Sell shares locally at a user-specified execution price."""
    service = get_portfolio_service()
    try:
        return PortfolioSellResponse(**service.sell_item(item_id, body, user_id=current_user.id))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Portfolio item not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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
