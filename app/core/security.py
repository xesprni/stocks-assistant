"""Authentication, JWT, password hashing, and RBAC helpers."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Optional

from fastapi import Depends, Header, HTTPException, Request, status

from app.core.app_store import JWT_SECRET_KEY, get_app_store, utc_now

try:  # pragma: no cover - exercised when dependency is installed.
    import jwt as pyjwt
except Exception:  # pragma: no cover - stdlib fallback keeps local tests runnable.
    pyjwt = None

try:  # pragma: no cover - exercised when dependency is installed.
    from pwdlib import PasswordHash

    _password_hash = PasswordHash.recommended()
except Exception:  # pragma: no cover - stdlib fallback keeps local tests runnable.
    _password_hash = None


ACCESS_TOKEN_MINUTES = 15
REFRESH_TOKEN_DAYS = 7
JWT_ALGORITHM = "HS256"


class AuthError(RuntimeError):
    """Raised for authentication failures."""


@dataclass(frozen=True)
class CurrentUser:
    id: str
    username: str
    display_name: str
    roles: tuple[str, ...]
    permissions: frozenset[str]
    is_active: bool

    @property
    def is_admin(self) -> bool:
        return "*" in self.permissions or "admin" in self.roles

    def can(self, permission: str) -> bool:
        return self.is_admin or permission in self.permissions


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode((data + padding).encode("ascii"))


def _jwt_encode(payload: dict[str, Any], secret: str) -> str:
    if pyjwt is not None:
        return pyjwt.encode(payload, secret, algorithm=JWT_ALGORITHM)
    header = {"alg": JWT_ALGORITHM, "typ": "JWT"}
    signing_input = f"{_b64url(json.dumps(header, separators=(',', ':')).encode())}.{_b64url(json.dumps(payload, separators=(',', ':')).encode())}"
    signature = hmac.new(secret.encode(), signing_input.encode(), hashlib.sha256).digest()
    return f"{signing_input}.{_b64url(signature)}"


def _jwt_decode(token: str, secret: str) -> dict[str, Any]:
    if pyjwt is not None:
        return pyjwt.decode(token, secret, algorithms=[JWT_ALGORITHM])
    parts = token.split(".")
    if len(parts) != 3:
        raise AuthError("Invalid token")
    signing_input = ".".join(parts[:2])
    expected = _b64url(hmac.new(secret.encode(), signing_input.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(expected, parts[2]):
        raise AuthError("Invalid token signature")
    payload = json.loads(_b64url_decode(parts[1]).decode())
    exp = payload.get("exp")
    if exp is not None and datetime.now(timezone.utc).timestamp() > float(exp):
        raise AuthError("Token expired")
    return payload


def hash_password(password: str) -> str:
    if _password_hash is not None:
        return _password_hash.hash(password)
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260_000)
    return f"pbkdf2_sha256${salt}${digest.hex()}"


def verify_password(password: str, password_hash: str) -> bool:
    if _password_hash is not None and not password_hash.startswith("pbkdf2_sha256$"):
        try:
            return bool(_password_hash.verify(password, password_hash))
        except Exception:
            return False
    try:
        _, salt, digest_hex = password_hash.split("$", 2)
    except ValueError:
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260_000)
    return hmac.compare_digest(digest.hex(), digest_hex)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def get_jwt_secret() -> str:
    secret = get_app_store().get_system_value(JWT_SECRET_KEY)
    if not secret:
        raise RuntimeError("JWT secret is not initialized")
    return secret


def create_access_token(user: dict[str, Any]) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user["id"],
        "username": user["username"],
        "roles": user.get("roles", []),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=ACCESS_TOKEN_MINUTES)).timestamp()),
        "typ": "access",
    }
    return _jwt_encode(payload, get_jwt_secret())


def create_refresh_token(
    user_id: str,
    *,
    user_agent: str = "",
    ip_address: str = "",
) -> tuple[str, str]:
    token = secrets.token_urlsafe(48)
    expires = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_DAYS)
    token_id = get_app_store().create_refresh_token(
        user_id=user_id,
        token_hash=hash_refresh_token(token),
        expires_at=expires.replace(microsecond=0).isoformat(),
        user_agent=user_agent,
        ip_address=ip_address,
    )
    return token, token_id


def public_user(user: dict[str, Any]) -> dict[str, Any]:
    store = get_app_store()
    return {
        "id": user["id"],
        "username": user["username"],
        "display_name": user.get("display_name") or "",
        "roles": user.get("roles", []),
        "permissions": user.get("permissions", []),
        "page_permissions": store.list_page_permissions(),
        "is_active": bool(user.get("is_active")),
        "created_at": user.get("created_at"),
        "updated_at": user.get("updated_at"),
        "last_login_at": user.get("last_login_at"),
    }


def to_current_user(user: dict[str, Any]) -> CurrentUser:
    return CurrentUser(
        id=user["id"],
        username=user["username"],
        display_name=user.get("display_name") or "",
        roles=tuple(user.get("roles") or []),
        permissions=frozenset(user.get("permissions") or []),
        is_active=bool(user.get("is_active")),
    )


def authenticate_user(username: str, password: str) -> Optional[dict[str, Any]]:
    user = get_app_store().get_user_by_username(username)
    if not user or not user.get("is_active"):
        return None
    if not verify_password(password, user["password_hash"]):
        return None
    get_app_store().touch_login(user["id"])
    return get_app_store().get_user_by_id(user["id"])


def decode_access_token(token: str) -> CurrentUser:
    try:
        payload = _jwt_decode(token, get_jwt_secret())
    except Exception as exc:
        raise AuthError(str(exc)) from exc
    if payload.get("typ") != "access" or not payload.get("sub"):
        raise AuthError("Invalid token type")
    user = get_app_store().get_user_by_id(str(payload["sub"]))
    if not user or not user.get("is_active"):
        raise AuthError("User is inactive or missing")
    return to_current_user(user)


def refresh_tokens(
    refresh_token: str,
    *,
    user_agent: str = "",
    ip_address: str = "",
) -> tuple[str, str, dict[str, Any]]:
    token_hash = hash_refresh_token(refresh_token)
    record = get_app_store().get_refresh_token(token_hash)
    if not record or record.get("revoked_at"):
        raise AuthError("Refresh token is invalid")
    expires_at = datetime.fromisoformat(record["expires_at"])
    if expires_at <= datetime.now(timezone.utc):
        get_app_store().revoke_refresh_token(record["id"])
        raise AuthError("Refresh token expired")
    user = get_app_store().get_user_by_id(record["user_id"])
    if not user or not user.get("is_active"):
        raise AuthError("User is inactive or missing")
    next_refresh, next_refresh_id = create_refresh_token(
        user["id"], user_agent=user_agent, ip_address=ip_address,
    )
    get_app_store().revoke_refresh_token(record["id"], replaced_by=next_refresh_id)
    return create_access_token(user), next_refresh, user


def bearer_from_header(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token.strip()


async def get_current_user(
    request: Request,
    authorization: Optional[str] = Header(default=None),
) -> CurrentUser:
    cached = getattr(request.state, "current_user", None)
    if isinstance(cached, CurrentUser):
        return cached
    token = bearer_from_header(authorization)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        user = decode_access_token(token)
    except AuthError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc) or "Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    request.state.current_user = user
    return user


def require_permissions(*permissions: str) -> Callable:
    async def dependency(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        missing = [permission for permission in permissions if not user.can(permission)]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing permission: {', '.join(missing)}",
            )
        return user

    return dependency


def require_admin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    return user


def _ensure_workspace_layout(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    for name in ("memory", "knowledge", "skills"):
        (path / name).mkdir(parents=True, exist_ok=True)
    memory_file = path / "MEMORY.md"
    if not memory_file.exists():
        memory_file.write_text("", encoding="utf-8")
    return path


def user_workspace_dir(workspace_dir: str, user_id: str) -> str:
    safe_user_id = str(user_id).strip()
    if not safe_user_id or safe_user_id in {".", ".."} or Path(safe_user_id).name != safe_user_id:
        raise ValueError("invalid user id")
    root = Path(workspace_dir).expanduser()
    user_root = root / "users" / safe_user_id
    return str(_ensure_workspace_layout(user_root))


def request_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",", 1)[0].strip()
    return request.client.host if request.client else ""


def iso_now() -> str:
    return utc_now()
