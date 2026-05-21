"""Role management API."""

from fastapi import APIRouter, Depends, HTTPException

from app.core.app_store import PERMISSION_DESCRIPTIONS, get_app_store
from app.core.security import CurrentUser, require_permissions
from app.schemas.auth import RoleListResponse, RoleResponse, RoleUpdateRequest

router = APIRouter()


@router.get("", response_model=RoleListResponse)
async def list_roles(_: CurrentUser = Depends(require_permissions("roles:manage"))):
    roles = [RoleResponse(**role) for role in get_app_store().list_roles()]
    return RoleListResponse(roles=roles, permissions=PERMISSION_DESCRIPTIONS)


@router.put("/{name}", response_model=RoleResponse)
async def upsert_role(
    name: str,
    request: RoleUpdateRequest,
    current: CurrentUser = Depends(require_permissions("roles:manage")),
):
    if name != request.name:
        raise HTTPException(status_code=400, detail="Role path name must match request name")
    try:
        role = get_app_store().upsert_role(request.name, request.description, request.permissions)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    get_app_store().audit(current.id, "roles.upsert", role["name"])
    return RoleResponse(**role)
