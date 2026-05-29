"""Dashboard aggregate API."""

from functools import partial
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from starlette.concurrency import run_in_threadpool

from app.config import get_effective_settings
from app.core.dashboard.service import DashboardService
from app.core.watchlist.service import LongbridgeUnavailableError
from app.core.security import CurrentUser, require_permissions
from app.deps import get_fundamental_service, get_market_service, get_portfolio_service, get_watchlist_service
from app.schemas.dashboard import (
    DashboardMarketModule,
    DashboardPortfolioModule,
    DashboardResponse,
    DashboardSymbolInsightsResponse,
    DashboardWatchlistModule,
)

router = APIRouter()
DashboardMode = Literal["bootstrap", "full"]


def _service() -> DashboardService:
    return DashboardService(
        market_service=get_market_service(),
        watchlist_service=get_watchlist_service(),
        portfolio_service=get_portfolio_service(),
    )


@router.get("", response_model=DashboardResponse)
async def get_dashboard(
    mode: DashboardMode = "full",
    current_user: CurrentUser = Depends(require_permissions("config:read")),
):
    """Return Dashboard data while isolating failures by module."""
    payload = await run_in_threadpool(
        partial(_service().build, user=current_user, settings=get_effective_settings(current_user.id), mode=mode)
    )
    return DashboardResponse(**payload)


@router.get("/market", response_model=DashboardMarketModule)
async def get_dashboard_market(current_user: CurrentUser = Depends(require_permissions("config:read"))):
    """Return only the Dashboard market module."""
    payload = await run_in_threadpool(
        partial(_service().market, user=current_user, settings=get_effective_settings(current_user.id), mode="full")
    )
    return DashboardMarketModule(**payload)


@router.get("/watchlist", response_model=DashboardWatchlistModule)
async def get_dashboard_watchlist(current_user: CurrentUser = Depends(require_permissions("config:read"))):
    """Return only the Dashboard watchlist module."""
    payload = await run_in_threadpool(
        partial(_service().watchlist, user=current_user, settings=get_effective_settings(current_user.id), mode="full")
    )
    return DashboardWatchlistModule(**payload)


@router.get("/portfolio", response_model=DashboardPortfolioModule)
async def get_dashboard_portfolio(current_user: CurrentUser = Depends(require_permissions("config:read"))):
    """Return only the Dashboard portfolio module."""
    payload = await run_in_threadpool(
        partial(_service().portfolio, user=current_user, settings=get_effective_settings(current_user.id), mode="full")
    )
    return DashboardPortfolioModule(**payload)


@router.get("/symbol-insights", response_model=DashboardSymbolInsightsResponse)
async def get_dashboard_symbol_insights(
    symbol: str,
    current_user: CurrentUser = Depends(require_permissions("fundamentals:read")),
):
    """Return Longbridge disclosures, company, financial, valuation and action data for one symbol."""

    service = get_fundamental_service()
    try:
        payload = await run_in_threadpool(
            partial(service.get_security_insights, symbol=symbol, settings=get_effective_settings(current_user.id))
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except LongbridgeUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    return DashboardSymbolInsightsResponse(**payload)
