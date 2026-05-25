"""Authentication and first-run setup API."""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

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
    resolve_device_id,
    request_ip,
    verify_password,
)
from app.schemas.auth import (
    AuthTokenResponse,
    ChangePasswordRequest,
    DeviceHeartbeatRequest,
    DeviceHeartbeatResponse,
    LoginRecordResponse,
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


def _current_device_id(http_request: Request) -> str:
    return resolve_device_id(request=http_request)


def _token_response(user: dict, refresh_token: str, *, session_id: str | None = None) -> AuthTokenResponse:
    return AuthTokenResponse(
        access_token=create_access_token(user, session_id=session_id),
        refresh_token=refresh_token,
        expires_in=ACCESS_TOKEN_MINUTES * 60,
        user=UserPublic(**public_user(user)),
    )


def _record_response(record: dict, *, current_session_id: str | None = None) -> LoginRecordResponse:
    revoked_at = record.get("revoked_at")
    expires_at = datetime.fromisoformat(record["expires_at"])
    is_online = bool(record.get("is_online"))
    default_active = not revoked_at and expires_at > datetime.now(timezone.utc) and (
        record.get("active_refresh_tokens", 0) > 0 or is_online
    )
    is_active = bool(record.get("is_active", default_active))
    return LoginRecordResponse(
        id=record["id"],
        device_id=record.get("device_id") or record["id"],
        user_id=record.get("user_id") or "",
        username=record.get("username") or "",
        display_name=record.get("display_name") or "",
        created_at=record["created_at"],
        last_seen_at=record["last_seen_at"],
        expires_at=record["expires_at"],
        revoked_at=revoked_at,
        user_agent=record.get("user_agent") or "",
        ip_address=record.get("ip_address") or "",
        last_ip_address=record.get("last_ip_address") or "",
        session_count=int(record.get("session_count") or 1),
        active_refresh_tokens=int(record.get("active_refresh_tokens") or 0),
        is_current=bool(current_session_id and current_session_id == record["id"]),
        is_active=is_active,
        is_online=is_online,
    )


def _session_response(
    session: dict,
    *,
    current_session_id: str | None = None,
    current_device_id: str | None = None,
    current_user_id: str | None = None,
) -> LoginSessionResponse:
    base = _record_response(session, current_session_id=current_session_id)
    session_ids = session.get("session_ids") if isinstance(session.get("session_ids"), list) else [session["id"]]
    records = [
        _record_response(record, current_session_id=current_session_id)
        for record in session.get("records", [])
        if isinstance(record, dict)
    ]
    is_current = bool(current_session_id and current_session_id in session_ids)
    if not is_current and not current_session_id and current_device_id:
        is_current = session.get("user_id") == current_user_id and (session.get("device_id") or session["id"]) == current_device_id
    return LoginSessionResponse(**base.model_dump(exclude={"is_current"}), is_current=is_current, records=records)


def _device_matches_current(session: dict, current_user, http_request: Request) -> bool:
    session_ids = session.get("session_ids") if isinstance(session.get("session_ids"), list) else [session.get("id")]
    if current_user.session_id and current_user.session_id in session_ids:
        return True
    if current_user.session_id:
        return False
    return session.get("user_id") == current_user.id and (session.get("device_id") or session.get("id")) == _current_device_id(http_request)


def _record_matches_current(record_id: str, device: dict, current_user, http_request: Request) -> bool:
    if current_user.session_id:
        return current_user.session_id == record_id
    return _device_matches_current(device, current_user, http_request)


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
        device_id=resolve_device_id(request.device_id, request=http_request),
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
        device_id=resolve_device_id(request.device_id, request=http_request),
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
            device_id=resolve_device_id(request.device_id, request=http_request),
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
async def list_login_sessions(http_request: Request, current_user=Depends(get_current_user)):
    sessions = [
        _session_response(
            session,
            current_session_id=current_user.session_id,
            current_device_id=_current_device_id(http_request),
            current_user_id=current_user.id,
        )
        for session in get_app_store().list_login_sessions(None if current_user.is_admin else current_user.id)
    ]
    return LoginSessionListResponse(
        sessions=sessions,
        max_lifetime_days=LOGIN_SESSION_DAYS,
        max_devices_per_user=get_settings().auth_max_devices_per_user,
        refresh_token_days=REFRESH_TOKEN_DAYS,
    )


@router.post("/device/heartbeat", response_model=DeviceHeartbeatResponse)
async def heartbeat_login_device(
    http_request: Request,
    payload: DeviceHeartbeatRequest | None = None,
    current_user=Depends(get_current_user),
):
    device_id = resolve_device_id(payload.device_id if payload else None, request=http_request)
    device = get_app_store().heartbeat_login_device(
        current_user.id,
        session_id=current_user.session_id,
        expires_at=(datetime.now(timezone.utc) + timedelta(days=LOGIN_SESSION_DAYS)).replace(microsecond=0).isoformat(),
        user_agent=http_request.headers.get("user-agent", ""),
        ip_address=request_ip(http_request),
        device_id=device_id,
    )
    return DeviceHeartbeatResponse(
        device_id=device.get("device_id") or device_id,
        last_seen_at=device["last_seen_at"],
        is_online=bool(device.get("is_online")),
    )


@router.delete("/sessions/{session_id}")
async def revoke_login_session(
    session_id: str,
    http_request: Request,
    user_id: str | None = Query(default=None),
    current_user=Depends(get_current_user),
):
    store = get_app_store()
    target_user_id = user_id if current_user.is_admin else current_user.id
    session = store.get_login_device(session_id, user_id=target_user_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Login session not found")
    store.revoke_login_device(session_id, user_id=target_user_id)
    store.audit(
        current_user.id,
        "auth.session_revoke",
        "login_sessions",
        {"device_id": session.get("device_id") or session_id, "user_id": session.get("user_id")},
    )
    return {"status": "ok", "revoked_current": _device_matches_current(session, current_user, http_request)}


@router.delete("/sessions/{device_id}/device")
async def delete_login_device(
    device_id: str,
    http_request: Request,
    user_id: str | None = Query(default=None),
    current_user=Depends(get_current_user),
):
    store = get_app_store()
    target_user_id = user_id if current_user.is_admin else current_user.id
    device = store.get_login_device(device_id, user_id=target_user_id)
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Login device not found")
    deleted_current = _device_matches_current(device, current_user, http_request)
    deleted_ids = store.delete_login_device(device_id, user_id=target_user_id)
    store.audit(
        current_user.id,
        "auth.device_delete",
        "login_sessions",
        {"device_id": device.get("device_id") or device_id, "user_id": device.get("user_id"), "deleted_session_ids": deleted_ids},
    )
    return {"status": "ok", "deleted": len(deleted_ids), "deleted_current": deleted_current}


@router.delete("/sessions/{device_id}/records/{record_id}")
async def delete_login_record(
    device_id: str,
    record_id: str,
    http_request: Request,
    user_id: str | None = Query(default=None),
    current_user=Depends(get_current_user),
):
    store = get_app_store()
    target_user_id = user_id if current_user.is_admin else current_user.id
    device = store.get_login_device(device_id, user_id=target_user_id)
    session_ids = device.get("session_ids") if device and isinstance(device.get("session_ids"), list) else []
    if not device or record_id not in session_ids:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Login record not found")
    deleted_current = _record_matches_current(record_id, device, current_user, http_request)
    if not store.delete_login_session_record(record_id, user_id=target_user_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Login record not found")
    store.audit(
        current_user.id,
        "auth.record_delete",
        "login_sessions",
        {"device_id": device.get("device_id") or device_id, "record_id": record_id, "user_id": device.get("user_id")},
    )
    return {"status": "ok", "deleted_current": deleted_current}


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
