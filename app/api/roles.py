"""Role management API."""

from fastapi import APIRouter, Depends, HTTPException

from app.core.app_store import PERMISSION_DESCRIPTIONS, get_app_store
from app.core.security import CurrentUser, require_permissions
from app.schemas.auth import PagePermissionUpdateRequest, RoleListResponse, RoleResponse, RoleUpdateRequest

router = APIRouter()


@router.get("", response_model=RoleListResponse)
async def list_roles(_: CurrentUser = Depends(require_permissions("roles:manage"))):
    store = get_app_store()
    roles = [RoleResponse(**role) for role in store.list_roles()]
    return RoleListResponse(roles=roles, permissions=PERMISSION_DESCRIPTIONS, page_permissions=store.list_page_permissions())


@router.put("/pages/{page}", response_model=RoleListResponse)
async def update_page_permission(
    page: str,
    request: PagePermissionUpdateRequest,
    current: CurrentUser = Depends(require_permissions("roles:manage")),
):
    try:
        page_permissions = get_app_store().upsert_page_permission(page, request.permission)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    get_app_store().audit(current.id, "roles.page_permission", page, {"permission": request.permission})
    roles = [RoleResponse(**role) for role in get_app_store().list_roles()]
    return RoleListResponse(roles=roles, permissions=PERMISSION_DESCRIPTIONS, page_permissions=page_permissions)


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
