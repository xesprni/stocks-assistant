"""Authentication, user, and role schemas."""

from pydantic import Field

from app.constants.common import OperationStatus
from app.constants.security import (
    DEFAULT_EXPIRES_IN,
    MAX_AVATAR_BASE64_LENGTH,
    MAX_DESCRIPTION_LENGTH,
    MAX_DEVICE_ID_LENGTH,
    MAX_DISPLAY_NAME_LENGTH,
    MAX_NAME_LENGTH,
    MAX_PASSWORD_LENGTH,
    MAX_PERMISSION_LENGTH,
    MAX_USERNAME_LENGTH,
    MIN_NAME_LENGTH,
    MIN_PASSWORD_LENGTH,
    MIN_USERNAME_LENGTH,
)
from app.schemas.base import AppModel as BaseModel
from app.schemas.common import StatusResponse


class SetupStatusResponse(BaseModel):
    setup_required: bool


class SetupRequest(BaseModel):
    username: str = Field(..., min_length=MIN_USERNAME_LENGTH, max_length=MAX_USERNAME_LENGTH)
    password: str = Field(..., min_length=MIN_PASSWORD_LENGTH, max_length=MAX_PASSWORD_LENGTH)
    display_name: str = Field(default="", max_length=MAX_DISPLAY_NAME_LENGTH)
    device_id: str | None = Field(default=None, max_length=MAX_DEVICE_ID_LENGTH)


class LoginRequest(BaseModel):
    username: str
    password: str
    device_id: str | None = Field(default=None, max_length=MAX_DEVICE_ID_LENGTH)


class RefreshRequest(BaseModel):
    refresh_token: str
    device_id: str | None = Field(default=None, max_length=MAX_DEVICE_ID_LENGTH)


class LogoutRequest(BaseModel):
    refresh_token: str


class DeviceHeartbeatRequest(BaseModel):
    device_id: str | None = Field(default=None, max_length=MAX_DEVICE_ID_LENGTH)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1, max_length=MAX_PASSWORD_LENGTH)
    new_password: str = Field(..., min_length=MIN_PASSWORD_LENGTH, max_length=MAX_PASSWORD_LENGTH)


class UserProfileUpdateRequest(BaseModel):
    display_name: str | None = Field(default=None, max_length=MAX_DISPLAY_NAME_LENGTH)
    avatar_base64: str | None = Field(default=None, max_length=MAX_AVATAR_BASE64_LENGTH)


class UserPublic(BaseModel):
    id: str
    username: str
    display_name: str = ""
    avatar_base64: str = Field(default="", max_length=MAX_AVATAR_BASE64_LENGTH)
    roles: list[str] = Field(default_factory=list)
    permissions: list[str] = Field(default_factory=list)
    page_permissions: dict[str, str] = Field(default_factory=dict)
    is_active: bool
    created_at: str | None = None
    updated_at: str | None = None
    last_login_at: str | None = None


class AuthTokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int = DEFAULT_EXPIRES_IN
    user: UserPublic


class LoginRecordResponse(BaseModel):
    id: str
    device_id: str = ""
    user_id: str = ""
    username: str = ""
    display_name: str = ""
    created_at: str
    last_seen_at: str
    expires_at: str
    revoked_at: str | None = None
    user_agent: str = ""
    ip_address: str = ""
    last_ip_address: str = ""
    session_count: int = 1
    active_refresh_tokens: int = 0
    is_current: bool = False
    is_active: bool = False
    is_online: bool = False


class LoginSessionResponse(LoginRecordResponse):
    records: list[LoginRecordResponse] = Field(default_factory=list)


class DeviceHeartbeatResponse(BaseModel):
    status: str = OperationStatus.OK
    device_id: str
    last_seen_at: str
    is_online: bool = True


class LoginSessionListResponse(BaseModel):
    sessions: list[LoginSessionResponse]
    max_lifetime_days: int
    max_devices_per_user: int
    refresh_token_days: int


class RevokeOtherSessionsResponse(BaseModel):
    status: str = OperationStatus.OK
    revoked_devices: int = Field(ge=0)
    revoked_sessions: int = Field(ge=0)


class UserCreateRequest(BaseModel):
    username: str = Field(..., min_length=MIN_USERNAME_LENGTH, max_length=MAX_USERNAME_LENGTH)
    password: str = Field(..., min_length=MIN_PASSWORD_LENGTH, max_length=MAX_PASSWORD_LENGTH)
    display_name: str = Field(default="", max_length=MAX_DISPLAY_NAME_LENGTH)
    roles: list[str] = Field(default_factory=lambda: ["user"])
    is_active: bool = True


class UserUpdateRequest(BaseModel):
    display_name: str | None = Field(default=None, max_length=MAX_DISPLAY_NAME_LENGTH)
    password: str | None = Field(
        default=None, min_length=MIN_PASSWORD_LENGTH, max_length=MAX_PASSWORD_LENGTH
    )
    roles: list[str] | None = None
    is_active: bool | None = None


class UserListResponse(BaseModel):
    users: list[UserPublic]
    total: int


class RoleResponse(BaseModel):
    id: str
    name: str
    description: str = ""
    builtin: bool = False
    permissions: list[str] = Field(default_factory=list)
    created_at: str | None = None
    updated_at: str | None = None


class RoleUpdateRequest(BaseModel):
    name: str = Field(..., min_length=MIN_NAME_LENGTH, max_length=MAX_NAME_LENGTH)
    description: str = Field(default="", max_length=MAX_DESCRIPTION_LENGTH)
    permissions: list[str] = Field(default_factory=list)


class RoleListResponse(BaseModel):
    roles: list[RoleResponse]
    permissions: dict[str, str]
    page_permissions: dict[str, str] = Field(default_factory=dict)


class PagePermissionUpdateRequest(BaseModel):
    permission: str = Field(..., min_length=1, max_length=MAX_PERMISSION_LENGTH)


class RevokeSessionResponse(StatusResponse):
    revoked_current: bool


class DeleteDeviceResponse(StatusResponse):
    deleted: int
    deleted_current: bool


class DeleteLoginRecordResponse(StatusResponse):
    deleted_current: bool
