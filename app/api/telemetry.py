"""本地、主动开启的产品行为事件接口。"""

from fastapi import APIRouter, Depends

from app.config import get_effective_settings
from app.core.app_store import get_app_store
from app.core.security import CurrentUser, require_permissions
from app.schemas.telemetry import ProductEventRequest, ProductEventResponse

router = APIRouter()


@router.post("/events", response_model=ProductEventResponse)
def record_product_event(
    payload: ProductEventRequest,
    current: CurrentUser = Depends(require_permissions("config:read")),
):
    settings = get_effective_settings(current.id)
    if not settings.product_analytics_enabled:
        return ProductEventResponse(accepted=False)
    # 仅记录预定义短字段，不接收 Prompt、回答、symbol、URL 或其他研究内容。
    get_app_store().audit(
        current.id,
        "product.event",
        payload.event,
        {"event": payload.event, "properties": payload.properties},
    )
    return ProductEventResponse(accepted=True)
