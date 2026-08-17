"""Portfolio、估值/同业与大中华市场实验室 API。"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from starlette.concurrency import run_in_threadpool

from app.config import get_effective_settings
from app.core.security import CurrentUser, require_permissions
from app.deps import get_investment_lab_service
from app.schemas.labs import (
    GreaterChinaRequest, PeerComparisonRequest, PortfolioLabRequest, ValuationModelCreate, ValuationModelResponse,
)

router = APIRouter()


@router.post("/portfolio/analyze")
async def analyze_portfolio(
    body: PortfolioLabRequest,
    current_user: CurrentUser = Depends(require_permissions("portfolio:read")),
):
    try:
        return await run_in_threadpool(
            get_investment_lab_service().analyze_portfolio,
            current_user.id,
            body,
            settings=get_effective_settings(current_user.id),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/valuation/models", response_model=list[ValuationModelResponse])
def list_valuation_models(
    symbol: Optional[str] = None,
    current_user: CurrentUser = Depends(require_permissions("fundamentals:read")),
):
    try:
        return get_investment_lab_service().list_valuation_models(current_user.id, symbol)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/valuation/{symbol}/models", response_model=ValuationModelResponse)
def create_valuation_model(
    symbol: str,
    body: ValuationModelCreate,
    current_user: CurrentUser = Depends(require_permissions("knowledge:write")),
):
    try:
        return get_investment_lab_service().create_valuation_model(current_user.id, symbol, body)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Linked model or Thesis was not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/valuation/peers")
async def compare_peers(
    body: PeerComparisonRequest,
    current_user: CurrentUser = Depends(require_permissions("fundamentals:read")),
):
    try:
        return await run_in_threadpool(
            get_investment_lab_service().compare_peers, body, settings=get_effective_settings(current_user.id)
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/greater-china/context")
async def greater_china_context(
    body: GreaterChinaRequest,
    current_user: CurrentUser = Depends(require_permissions("fundamentals:read")),
):
    try:
        return await run_in_threadpool(
            get_investment_lab_service().greater_china_context, body, settings=get_effective_settings(current_user.id)
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
