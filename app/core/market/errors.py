"""Shared Longbridge service errors, independent of any feature service."""

from app.constants.longbridge import TOKEN_EXPIRED_CODE


class LongbridgeUnavailableError(RuntimeError):
    """Raised when Longbridge SDK, credentials or upstream data are unavailable."""


class LongbridgeTokenExpiredError(LongbridgeUnavailableError):
    """长桥凭据过期，需要用户重新连接或更新 Token。"""


def longbridge_error_code(exc: BaseException) -> int | None:
    """沿 service 包装异常查找 SDK 错误码，不解析或暴露可能含凭据的错误文本。"""
    current: BaseException | None = exc
    seen: set[int] = set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        code = getattr(current, "code", None)
        if isinstance(code, int):
            return code
        current = current.__cause__ or current.__context__
    return None


def raise_if_token_expired(exc: BaseException) -> None:
    if isinstance(exc, LongbridgeTokenExpiredError):
        raise exc
    if longbridge_error_code(exc) == TOKEN_EXPIRED_CODE:
        raise LongbridgeTokenExpiredError("Longbridge token expired") from exc
