"""Authentication and first-run setup API."""

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.config import get_settings
from app.core.app_store import PERMISSION_DESCRIPTIONS, get_app_store
from app.core.security import (
    ACCESS_TOKEN_MINUTES,
    AuthError,
    authenticate_user,
    create_access_token,
    create_refresh_token,
    get_current_user,
    hash_password,
    hash_refresh_token,
    public_user,
    refresh_tokens,
    request_ip,
    verify_password,
)
from app.schemas.auth import (
    AuthTokenResponse,
    ChangePasswordRequest,
    LoginRequest,
    LogoutRequest,
    RefreshRequest,
    SetupRequest,
    SetupStatusResponse,
    UserPublic,
)

router = APIRouter()


def _token_response(user: dict, refresh_token: str) -> AuthTokenResponse:
    return AuthTokenResponse(
        access_token=create_access_token(user),
        refresh_token=refresh_token,
        expires_in=ACCESS_TOKEN_MINUTES * 60,
        user=UserPublic(**public_user(user)),
    )


@router.get("/setup/status", response_model=SetupStatusResponse)
async def setup_status():
    return SetupStatusResponse(setup_required=not get_app_store().has_users())


@router.post("/setup", response_model=AuthTokenResponse)
async def setup(request: SetupRequest, http_request: Request):
    store = get_app_store()
    if store.has_users():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Setup has already been completed")

    store.migrate_config_json_once()
    try:
        user = store.create_user(
            username=request.username,
            password_hash=hash_password(request.password),
            display_name=request.display_name,
            role_names=["admin"],
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    settings = get_settings()
    store.migrate_legacy_user_data(user["id"], settings.workspace_dir)
    refresh_token, _ = create_refresh_token(
        user["id"],
        user_agent=http_request.headers.get("user-agent", ""),
        ip_address=request_ip(http_request),
    )
    store.audit(user["id"], "auth.setup", "users", {"permissions": list(PERMISSION_DESCRIPTIONS)})
    return _token_response(user, refresh_token)


@router.post("/login", response_model=AuthTokenResponse)
async def login(request: LoginRequest, http_request: Request):
    user = authenticate_user(request.username, request.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")
    refresh_token, _ = create_refresh_token(
        user["id"],
        user_agent=http_request.headers.get("user-agent", ""),
        ip_address=request_ip(http_request),
    )
    get_app_store().audit(user["id"], "auth.login", "users")
    return _token_response(user, refresh_token)


@router.post("/refresh", response_model=AuthTokenResponse)
async def refresh(request: RefreshRequest, http_request: Request):
    try:
        access_token, refresh_token, user = refresh_tokens(
            request.refresh_token,
            user_agent=http_request.headers.get("user-agent", ""),
            ip_address=request_ip(http_request),
        )
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    return AuthTokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=ACCESS_TOKEN_MINUTES * 60,
        user=UserPublic(**public_user(user)),
    )


@router.post("/logout")
async def logout(request: LogoutRequest):
    record = get_app_store().get_refresh_token(hash_refresh_token(request.refresh_token))
    if record:
        get_app_store().revoke_refresh_token(record["id"])
    return {"status": "ok"}


@router.get("/me", response_model=UserPublic)
async def me(user=Depends(get_current_user)):
    return UserPublic(**public_user({
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "roles": list(user.roles),
        "permissions": sorted(user.permissions),
        "is_active": user.is_active,
    }))


@router.patch("/me/password")
async def change_password(request: ChangePasswordRequest, current_user=Depends(get_current_user)):
    store = get_app_store()
    user = store.get_user_by_id(current_user.id)
    if not user or not verify_password(request.current_password, user["password_hash"]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    store.update_user(current_user.id, password_hash=hash_password(request.new_password))
    store.audit(current_user.id, "auth.password_change", "users")
    return {"status": "ok"}
