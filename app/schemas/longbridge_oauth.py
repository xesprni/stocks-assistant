"""长桥 OAuth 授权状态，不包含 SDK Token。"""

from typing import Literal

from pydantic import BaseModel


class LongbridgeOAuthStatus(BaseModel):
    status: Literal["disconnected", "pending", "connected", "error"]
    auth_mode: Literal["apikey", "oauth"] = "apikey"
    client_id: str = ""
    authorization_url: str | None = None
    expires_at: str | None = None
    error: str | None = None
    scope: Literal["system", "personal"]
    callback_url: str | None = None
