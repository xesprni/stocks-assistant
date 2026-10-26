"""RFC 4226/6238 的 TOTP 计算；所有密钥只在服务端内存中解密。"""

import base64
import hashlib
import hmac
import secrets
import struct
from urllib.parse import quote, urlencode

from app.constants.security import (
    TOTP_DIGITS,
    TOTP_ISSUER,
    TOTP_PERIOD_SECONDS,
    TOTP_SECRET_BYTES,
    TOTP_WINDOW_STEPS,
)


def generate_secret() -> str:
    return base64.b32encode(secrets.token_bytes(TOTP_SECRET_BYTES)).decode("ascii")


def code_at_step(secret: str, step: int) -> str:
    digest = hmac.new(base64.b32decode(secret), struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    binary = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(binary % (10**TOTP_DIGITS)).zfill(TOTP_DIGITS)


def matching_step(secret: str, code: str, now: int, last_used_step: int = -1) -> int | None:
    if len(code) != TOTP_DIGITS or not code.isascii() or not code.isdigit():
        return None
    current = now // TOTP_PERIOD_SECONDS
    for step in range(current - TOTP_WINDOW_STEPS, current + TOTP_WINDOW_STEPS + 1):
        if (
            step >= 0
            and step > last_used_step
            and hmac.compare_digest(code_at_step(secret, step), code)
        ):
            return step
    return None


def provisioning_uri(secret: str, username: str) -> str:
    query = urlencode(
        {
            "secret": secret,
            "issuer": TOTP_ISSUER,
            "algorithm": "SHA1",
            "digits": TOTP_DIGITS,
            "period": TOTP_PERIOD_SECONDS,
        }
    )
    return f"otpauth://totp/{quote(f'{TOTP_ISSUER}:{username}', safe='')}?{query}"
