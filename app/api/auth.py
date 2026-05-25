"""Authentication and first-run setup API."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.config import get_settings
from app.core.app_store import PERMISSION_DESCRIPTIONS, get_app_store
from app.core.security import (
    ACCESS_TOKEN_MINUTES,
    LOGIN_SESSION_DAYS,
    REFRESH_TOKEN_DAYS,
    AuthError,
    authenticate_user,
    create_access_token,
    create_login_session,
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
    LoginSessionListResponse,
    LoginSessionResponse,
    LoginRequest,
    LogoutRequest,
    RefreshRequest,
    SetupRequest,
    SetupStatusResponse,
    UserPublic,
)

router = APIRouter()


def _token_response(user: dict, refresh_token: str, *, session_id: str | None = None) -> AuthTokenResponse:
    return AuthTokenResponse(
        access_token=create_access_token(user, session_id=session_id),
        refresh_token=refresh_token,
        expires_in=ACCESS_TOKEN_MINUTES * 60,
        user=UserPublic(**public_user(user)),
    )


def _session_response(session: dict, *, current_session_id: str | None = None) -> LoginSessionResponse:
    revoked_at = session.get("revoked_at")
    expires_at = datetime.fromisoformat(session["expires_at"])
    is_active = not revoked_at and expires_at > datetime.now(timezone.utc) and session.get("active_refresh_tokens", 0) > 0
    return LoginSessionResponse(
        id=session["id"],
        created_at=session["created_at"],
        last_seen_at=session["last_seen_at"],
        expires_at=session["expires_at"],
        revoked_at=revoked_at,
        user_agent=session.get("user_agent") or "",
        ip_address=session.get("ip_address") or "",
        last_ip_address=session.get("last_ip_address") or "",
        active_refresh_tokens=int(session.get("active_refresh_tokens") or 0),
        is_current=bool(current_session_id and session["id"] == current_session_id),
        is_active=is_active,
    )


def _enforce_device_limit(user_id: str, session_id: str) -> None:
    max_devices = get_settings().auth_max_devices_per_user
    revoked = get_app_store().enforce_login_session_limit(user_id, max_devices, keep_session_id=session_id)
    if revoked:
        get_app_store().audit(
            user_id,
            "auth.session_limit_enforced",
            "login_sessions",
            {"max_devices": max_devices, "revoked_session_ids": revoked},
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
    login_session = create_login_session(
        user["id"],
        user_agent=http_request.headers.get("user-agent", ""),
        ip_address=request_ip(http_request),
    )
    refresh_token, _ = create_refresh_token(
        user["id"],
        session_id=login_session["id"],
        user_agent=http_request.headers.get("user-agent", ""),
        ip_address=request_ip(http_request),
    )
    _enforce_device_limit(user["id"], login_session["id"])
    store.audit(user["id"], "auth.setup", "users", {"permissions": list(PERMISSION_DESCRIPTIONS)})
    return _token_response(user, refresh_token, session_id=login_session["id"])


@router.post("/login", response_model=AuthTokenResponse)
async def login(request: LoginRequest, http_request: Request):
    user = authenticate_user(request.username, request.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")
    login_session = create_login_session(
        user["id"],
        user_agent=http_request.headers.get("user-agent", ""),
        ip_address=request_ip(http_request),
    )
    refresh_token, _ = create_refresh_token(
        user["id"],
        session_id=login_session["id"],
        user_agent=http_request.headers.get("user-agent", ""),
        ip_address=request_ip(http_request),
    )
    _enforce_device_limit(user["id"], login_session["id"])
    get_app_store().audit(user["id"], "auth.login", "users")
    return _token_response(user, refresh_token, session_id=login_session["id"])


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
    if record and not record.get("revoked_at"):
        if record.get("session_id"):
            get_app_store().revoke_login_session(record["session_id"])
        else:
            get_app_store().revoke_refresh_token(record["id"])
    return {"status": "ok"}


@router.get("/sessions", response_model=LoginSessionListResponse)
async def list_login_sessions(current_user=Depends(get_current_user)):
    sessions = [
        _session_response(session, current_session_id=current_user.session_id)
        for session in get_app_store().list_login_sessions(current_user.id)
    ]
    return LoginSessionListResponse(
        sessions=sessions,
        max_lifetime_days=LOGIN_SESSION_DAYS,
        max_devices_per_user=get_settings().auth_max_devices_per_user,
        refresh_token_days=REFRESH_TOKEN_DAYS,
    )


@router.delete("/sessions/{session_id}")
async def revoke_login_session(session_id: str, current_user=Depends(get_current_user)):
    store = get_app_store()
    session = store.get_login_session(session_id)
    if not session or session.get("user_id") != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Login session not found")
    store.revoke_login_session(session_id)
    store.audit(current_user.id, "auth.session_revoke", "login_sessions", {"session_id": session_id})
    return {"status": "ok", "revoked_current": bool(current_user.session_id and current_user.session_id == session_id)}


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
