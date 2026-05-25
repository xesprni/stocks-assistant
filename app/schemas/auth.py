"""Authentication, user, and role schemas."""

from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class SetupStatusResponse(BaseModel):
    setup_required: bool


class SetupRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=64)
    password: str = Field(..., min_length=8, max_length=256)
    display_name: str = Field(default="", max_length=120)


class LoginRequest(BaseModel):
    username: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1, max_length=256)
    new_password: str = Field(..., min_length=8, max_length=256)


class UserPublic(BaseModel):
    id: str
    username: str
    display_name: str = ""
    roles: List[str] = Field(default_factory=list)
    permissions: List[str] = Field(default_factory=list)
    page_permissions: Dict[str, str] = Field(default_factory=dict)
    is_active: bool
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    last_login_at: Optional[str] = None


class AuthTokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int = 900
    user: UserPublic


class LoginSessionResponse(BaseModel):
    id: str
    created_at: str
    last_seen_at: str
    expires_at: str
    revoked_at: Optional[str] = None
    user_agent: str = ""
    ip_address: str = ""
    last_ip_address: str = ""
    active_refresh_tokens: int = 0
    is_current: bool = False
    is_active: bool = False


class LoginSessionListResponse(BaseModel):
    sessions: List[LoginSessionResponse]
    max_lifetime_days: int
    max_devices_per_user: int
    refresh_token_days: int


class UserCreateRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=64)
    password: str = Field(..., min_length=8, max_length=256)
    display_name: str = Field(default="", max_length=120)
    roles: List[str] = Field(default_factory=lambda: ["user"])
    is_active: bool = True


class UserUpdateRequest(BaseModel):
    display_name: Optional[str] = Field(default=None, max_length=120)
    password: Optional[str] = Field(default=None, min_length=8, max_length=256)
    roles: Optional[List[str]] = None
    is_active: Optional[bool] = None


class UserListResponse(BaseModel):
    users: List[UserPublic]
    total: int


class RoleResponse(BaseModel):
    id: str
    name: str
    description: str = ""
    builtin: bool = False
    permissions: List[str] = Field(default_factory=list)
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class RoleUpdateRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=64)
    description: str = Field(default="", max_length=240)
    permissions: List[str] = Field(default_factory=list)


class RoleListResponse(BaseModel):
    roles: List[RoleResponse]
    permissions: dict[str, str]
    page_permissions: dict[str, str] = Field(default_factory=dict)


class PagePermissionUpdateRequest(BaseModel):
    permission: str = Field(..., min_length=1, max_length=120)
