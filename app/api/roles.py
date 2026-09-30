"""Role management API."""

from http import HTTPStatus

from fastapi import APIRouter, Depends, HTTPException

from app.constants.security import Permission
from app.core.app_store import PERMISSION_DESCRIPTIONS, get_app_store
from app.core.security import CurrentUser, require_permissions
from app.schemas.auth import (
    PagePermissionUpdateRequest,
    RoleListResponse,
    RoleResponse,
    RoleUpdateRequest,
)

router = APIRouter()


def _role_list_response(page_permissions: dict[str, str] | None = None) -> RoleListResponse:
    store = get_app_store()
    return RoleListResponse(
        roles=[RoleResponse.model_validate(role) for role in store.list_roles()],
        permissions=PERMISSION_DESCRIPTIONS,
        page_permissions=store.list_page_permissions()
        if page_permissions is None
        else page_permissions,
    )


@router.get("", response_model=RoleListResponse)
def list_roles(
    _: CurrentUser = Depends(require_permissions(Permission.ROLES_MANAGE)),
) -> RoleListResponse:
    return _role_list_response()


@router.put("/pages/{page}", response_model=RoleListResponse)
def update_page_permission(
    page: str,
    request: PagePermissionUpdateRequest,
    current: CurrentUser = Depends(require_permissions(Permission.ROLES_MANAGE)),
) -> RoleListResponse:
    try:
        page_permissions = get_app_store().upsert_page_permission(page, request.permission)
    except Exception as exc:
        raise HTTPException(status_code=HTTPStatus.BAD_REQUEST, detail=str(exc)) from exc
    get_app_store().audit(
        current.id, "roles.page_permission", page, {"permission": request.permission}
    )
    return _role_list_response(page_permissions)


@router.put("/{name}", response_model=RoleResponse)
def upsert_role(
    name: str,
    request: RoleUpdateRequest,
    current: CurrentUser = Depends(require_permissions(Permission.ROLES_MANAGE)),
) -> RoleResponse:
    if name != request.name:
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST, detail="Role path name must match request name"
        )
    try:
        role = get_app_store().upsert_role(request.name, request.description, request.permissions)
    except Exception as exc:
        raise HTTPException(status_code=HTTPStatus.BAD_REQUEST, detail=str(exc)) from exc
    get_app_store().audit(current.id, "roles.upsert", role["name"])
    return RoleResponse.model_validate(role)
