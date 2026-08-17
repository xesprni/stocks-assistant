"""组合感知提醒规则与收件箱 API。"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from starlette.concurrency import run_in_threadpool

from app.core.research.evaluator import evaluate_due_alerts
from app.core.security import CurrentUser, require_permissions
from app.deps import get_fundamental_service, get_market_service, get_news_service, get_research_service
from app.schemas.research import AlertEvaluationRequest, AlertEventResponse, AlertRuleCreate, AlertRuleResponse, AlertRuleUpdate

router = APIRouter()


@router.get("/rules", response_model=list[AlertRuleResponse])
def list_rules(symbol: Optional[str] = None, current_user: CurrentUser = Depends(require_permissions("scheduler:read"))):
    return get_research_service().list_alert_rules(current_user.id, symbol)


@router.post("/rules", response_model=AlertRuleResponse)
def create_rule(body: AlertRuleCreate, current_user: CurrentUser = Depends(require_permissions("scheduler:write"))):
    try:
        return get_research_service().create_alert_rule(current_user.id, body)
    except (ValueError, KeyError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/rules/{rule_id}", response_model=AlertRuleResponse)
def update_rule(rule_id: str, body: AlertRuleUpdate, current_user: CurrentUser = Depends(require_permissions("scheduler:write"))):
    try:
        return get_research_service().update_alert_rule(current_user.id, rule_id, body)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Alert rule not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/rules/{rule_id}")
def delete_rule(rule_id: str, current_user: CurrentUser = Depends(require_permissions("scheduler:write"))):
    try:
        get_research_service().delete_alert_rule(current_user.id, rule_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Alert rule not found") from exc
    return {"status": "ok"}


@router.post("/rules/{rule_id}/evaluate", response_model=Optional[AlertEventResponse])
def evaluate_rule(rule_id: str, body: AlertEvaluationRequest, current_user: CurrentUser = Depends(require_permissions("scheduler:run"))):
    try:
        return get_research_service().record_evaluation(
            current_user.id, rule_id, observed_value=body.observed_value, observed_at=body.observed_at,
            event_key=body.event_key, title=body.title, source=body.source,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Alert rule not found") from exc


@router.post("/evaluate-live")
async def evaluate_live(current_user: CurrentUser = Depends(require_permissions("scheduler:run"))):
    return await run_in_threadpool(
        evaluate_due_alerts, get_research_service(), market_service=get_market_service(),
        fundamental_service=get_fundamental_service(), news_service=get_news_service(), user_id=current_user.id, force=True,
    )


@router.get("/events", response_model=list[AlertEventResponse])
def list_events(
    symbol: Optional[str] = None, status: Optional[str] = None, limit: int = Query(100, ge=1, le=500),
    current_user: CurrentUser = Depends(require_permissions("scheduler:read")),
):
    return get_research_service().list_alert_events(current_user.id, symbol=symbol, status=status, limit=limit)


@router.patch("/events/{event_id}/status", response_model=AlertEventResponse)
def set_event_status(event_id: str, status: str, current_user: CurrentUser = Depends(require_permissions("scheduler:write"))):
    try:
        return get_research_service().set_alert_status(current_user.id, event_id, status)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Alert event not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/events/{event_id}/retry", response_model=AlertEventResponse)
def retry_event(event_id: str, current_user: CurrentUser = Depends(require_permissions("scheduler:write"))):
    try:
        return get_research_service().retry_alert_delivery(current_user.id, event_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Alert event not found") from exc
