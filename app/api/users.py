"""User and role management API."""

from fastapi import APIRouter, Depends, HTTPException

from app.core.app_store import PERMISSION_DESCRIPTIONS, get_app_store
from app.core.security import CurrentUser, hash_password, public_user, require_permissions
from app.schemas.auth import (
    RoleListResponse,
    RoleResponse,
    RoleUpdateRequest,
    UserCreateRequest,
    UserListResponse,
    UserPublic,
    UserUpdateRequest,
)

router = APIRouter()


@router.get("", response_model=UserListResponse)
async def list_users(_: CurrentUser = Depends(require_permissions("users:manage"))):
    users = [UserPublic(**public_user(user)) for user in get_app_store().list_users()]
    return UserListResponse(users=users, total=len(users))


@router.post("", response_model=UserPublic)
async def create_user(request: UserCreateRequest, current: CurrentUser = Depends(require_permissions("users:manage"))):
    try:
        user = get_app_store().create_user(
            username=request.username,
            password_hash=hash_password(request.password),
            display_name=request.display_name,
            role_names=request.roles or ["user"],
            is_active=request.is_active,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    get_app_store().audit(current.id, "users.create", user["id"], {"username": user["username"]})
    return UserPublic(**public_user(user))


@router.patch("/{user_id}", response_model=UserPublic)
async def update_user(
    user_id: str,
    request: UserUpdateRequest,
    current: CurrentUser = Depends(require_permissions("users:manage")),
):
    try:
        user = get_app_store().update_user(
            user_id,
            display_name=request.display_name,
            password_hash=hash_password(request.password) if request.password else None,
            role_names=request.roles,
            is_active=request.is_active,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="User not found") from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    get_app_store().audit(current.id, "users.update", user_id)
    return UserPublic(**public_user(user))


@router.get("/roles", response_model=RoleListResponse)
async def list_roles(_: CurrentUser = Depends(require_permissions("roles:manage"))):
    roles = [RoleResponse(**role) for role in get_app_store().list_roles()]
    return RoleListResponse(roles=roles, permissions=PERMISSION_DESCRIPTIONS)


@router.put("/roles/{name}", response_model=RoleResponse)
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
