"""Dashboard aggregate API."""

from fastapi import APIRouter, Depends

from app.config import get_effective_settings
from app.core.dashboard.service import DashboardService
from app.core.security import CurrentUser, require_permissions
from app.deps import get_market_service, get_portfolio_service, get_watchlist_service
from app.schemas.dashboard import DashboardResponse

router = APIRouter()


@router.get("", response_model=DashboardResponse)
async def get_dashboard(current_user: CurrentUser = Depends(require_permissions("config:read"))):
    """Return Dashboard data while isolating failures by module."""
    service = DashboardService(
        market_service=get_market_service(),
        watchlist_service=get_watchlist_service(),
        portfolio_service=get_portfolio_service(),
    )
    return DashboardResponse(**service.build(user=current_user, settings=get_effective_settings(current_user.id)))
