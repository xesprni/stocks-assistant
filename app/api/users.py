"""User and role management API."""

from http import HTTPStatus

from fastapi import APIRouter, Depends, HTTPException

from app.constants.security import Permission
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
def list_users(
    _: CurrentUser = Depends(require_permissions(Permission.USERS_MANAGE)),
) -> UserListResponse:
    users = [UserPublic.model_validate(public_user(user)) for user in get_app_store().list_users()]
    return UserListResponse(users=users, total=len(users))


@router.post("", response_model=UserPublic)
def create_user(
    request: UserCreateRequest,
    current: CurrentUser = Depends(require_permissions(Permission.USERS_MANAGE)),
) -> UserPublic:
    try:
        user = get_app_store().create_user(
            username=request.username,
            password_hash=hash_password(request.password),
            display_name=request.display_name,
            role_names=request.roles or ["user"],
            is_active=request.is_active,
        )
    except Exception as exc:
        raise HTTPException(status_code=HTTPStatus.BAD_REQUEST, detail=str(exc)) from exc
    get_app_store().audit(current.id, "users.create", user["id"], {"username": user["username"]})
    return UserPublic.model_validate(public_user(user))


@router.patch("/{user_id}", response_model=UserPublic)
def update_user(
    user_id: str,
    request: UserUpdateRequest,
    current: CurrentUser = Depends(require_permissions(Permission.USERS_MANAGE)),
) -> UserPublic:
    try:
        user = get_app_store().update_user(
            user_id,
            display_name=request.display_name,
            password_hash=hash_password(request.password) if request.password else None,
            role_names=request.roles,
            is_active=request.is_active,
        )
    except KeyError as exc:
        raise HTTPException(status_code=HTTPStatus.NOT_FOUND, detail="User not found") from exc
    except Exception as exc:
        raise HTTPException(status_code=HTTPStatus.BAD_REQUEST, detail=str(exc)) from exc
    get_app_store().audit(current.id, "users.update", user_id)
    return UserPublic.model_validate(public_user(user))


@router.get("/roles", response_model=RoleListResponse)
def list_roles(
    _: CurrentUser = Depends(require_permissions(Permission.ROLES_MANAGE)),
) -> RoleListResponse:
    store = get_app_store()
    roles = [RoleResponse.model_validate(role) for role in store.list_roles()]
    return RoleListResponse(
        roles=roles,
        permissions=PERMISSION_DESCRIPTIONS,
        page_permissions=store.list_page_permissions(),
    )


@router.put("/roles/{name}", response_model=RoleResponse)
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
