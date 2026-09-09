"""Portfolio、估值/同业与大中华市场实验室 API。"""

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool

from app.config import get_effective_settings
from app.core.labs.ai_service import LAB_PERMISSIONS, LabAIService
from app.core.security import CurrentUser, get_current_user, require_permissions
from app.deps import get_investment_lab_service
from app.schemas.labs import (
    GreaterChinaRequest, LabAIRequest, LabAIRun, LabKind, PeerComparisonRequest, PortfolioLabRequest,
    ValuationModelCreate, ValuationModelResponse,
)

router = APIRouter()


@router.post("/ai/stream")
async def run_ai_lab(body: LabAIRequest, current_user: CurrentUser = Depends(get_current_user)):
    service = LabAIService(get_investment_lab_service())
    settings = get_effective_settings(current_user.id)
    try:
        provider = await run_in_threadpool(service.prepare, current_user, body, settings)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except Exception as exc:
        # Provider 初始化错误可能包含配置内容，API 只给可操作提示。
        raise HTTPException(status_code=503, detail="AI model is unavailable. Check your model configuration and connection.") from exc

    async def events():
        stream = service.stream(current_user, body, settings, provider)
        try:
            async for event in stream:
                yield f"data: {json.dumps(event, ensure_ascii=False, allow_nan=False)}\n\n"
        finally:
            # 显式关闭内层生成器，浏览器 abort/disconnect 立即标记取消并阻止后续工具步骤。
            await stream.aclose()

    return StreamingResponse(events(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive",
    })


@router.get("/ai/runs", response_model=list[LabAIRun])
def list_ai_runs(
    lab: Optional[LabKind] = None,
    limit: int = Query(default=20, ge=1, le=50),
    current_user: CurrentUser = Depends(get_current_user),
):
    service = LabAIService(get_investment_lab_service())
    if lab:
        try:
            service.authorize(current_user, lab)
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
    elif not any(current_user.can(permission) for permission in LAB_PERMISSIONS.values()):
        raise HTTPException(status_code=403, detail="Missing permission to read Labs")
    return [run for run in service.store.list(current_user.id, lab, limit) if current_user.can(LAB_PERMISSIONS[run["lab"]])]


@router.get("/ai/runs/{run_id}", response_model=LabAIRun)
def get_ai_run(run_id: str, current_user: CurrentUser = Depends(get_current_user)):
    service = LabAIService(get_investment_lab_service())
    try:
        run = service.store.get(current_user.id, run_id)
        service.authorize(current_user, run["lab"])
        return run
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Lab run not found") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


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
