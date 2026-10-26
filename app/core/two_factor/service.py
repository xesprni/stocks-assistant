"""账号 2FA 编排：密码复核、绑定、限流、一次性消费与安全审计。"""

import hashlib
import hmac
import json
import secrets
import time
from collections.abc import Iterator
from contextlib import contextmanager
from http import HTTPStatus
from typing import NoReturn

from sqlalchemy import or_, update

from app.constants.security import (
    RECOVERY_CODE_BYTES,
    RECOVERY_CODE_COUNT,
    TWO_FACTOR_LOCK_SECONDS,
    TWO_FACTOR_MAX_FAILURES,
    TWO_FACTOR_SETUP_SECONDS,
)
from app.core.app_store import get_app_store, utc_now
from app.core.orm.models.app import LoginSession, RefreshToken
from app.core.orm.repositories.two_factor import TwoFactorAccount
from app.core.security import hash_password, verify_password
from app.core.two_factor.totp import generate_secret, matching_step, provisioning_uri
from app.schemas.auth import TwoFactorEnabledResponse, TwoFactorSetupResponse


class TwoFactorError(ValueError):
    def __init__(self, message: str, status_code: HTTPStatus = HTTPStatus.BAD_REQUEST):
        super().__init__(message)
        self.status_code = status_code


class TwoFactorService:
    def __init__(self) -> None:
        self.store = get_app_store()

    @contextmanager
    def _account(self, user_id: str) -> Iterator[TwoFactorAccount]:
        error = None
        try:
            with self.store.two_factor.account(user_id) as account:
                try:
                    yield account
                except TwoFactorError as exc:
                    # 业务验证失败仍需提交失败次数和审计；其他异常继续回滚整个事务。
                    error = exc
                    self.store.identity.audit(
                        user_id,
                        "auth.two_factor_rejected",
                        "users",
                        {"reason": str(exc)},
                        session=account.session,
                    )
        except KeyError as exc:
            raise TwoFactorError("User is inactive or missing", HTTPStatus.FORBIDDEN) from exc
        if error is not None:
            raise error

    def _check_lock(self, account: TwoFactorAccount) -> None:
        if account.factor.locked_until > int(time.time()):
            raise TwoFactorError(
                "Too many verification attempts; try again in 5 minutes",
                HTTPStatus.TOO_MANY_REQUESTS,
            )

    def _failed(self, account: TwoFactorAccount, message: str) -> NoReturn:
        factor = account.factor
        factor.failures += 1
        if factor.failures >= TWO_FACTOR_MAX_FAILURES:
            factor.failures = 0
            factor.locked_until = int(time.time()) + TWO_FACTOR_LOCK_SECONDS
            self._check_lock(account)
        raise TwoFactorError(message)

    def _password(self, account: TwoFactorAccount, password: str) -> None:
        self._check_lock(account)
        if not verify_password(password, account.user.password_hash):
            self._failed(account, "Current password is incorrect")

    def _verify(self, account: TwoFactorAccount, code: str | None) -> None:
        factor = account.factor
        if not factor.secret_encrypted:
            return
        self._check_lock(account)
        if not code or not code.strip():
            raise TwoFactorError("Two-factor code required")
        clean = code.strip().replace("-", "").upper()
        hashes: list[str] = json.loads(factor.recovery_hashes)
        digest = hashlib.sha256(clean.encode()).hexdigest()
        for value in hashes:
            if hmac.compare_digest(value, digest):
                factor.recovery_hashes = json.dumps([item for item in hashes if item != value])
                factor.failures = 0
                self.store.identity.audit(
                    account.user.id, "auth.recovery_code_used", "users", session=account.session
                )
                return
        secret = (
            self.store.config._fernet(account.session)
            .decrypt(factor.secret_encrypted.encode())
            .decode()
        )
        step = matching_step(secret, code.strip(), int(time.time()), factor.last_used_step)
        if step is None:
            self._failed(account, "Invalid or already used two-factor code")
        else:
            factor.last_used_step = step
            factor.failures = 0

    def authenticate(self, username: str, password: str, code: str | None) -> str | None:
        user = self.store.get_user_by_username(username)
        if not user or not user["is_active"]:
            return None
        with self._account(user["id"]) as account:
            self._check_lock(account)
            if not verify_password(password, account.user.password_hash):
                return None
            self._verify(account, code)
            account.user.last_login_at = utc_now()
            account.user.updated_at = utc_now()
            return account.user.id

    def start_setup(self, user_id: str, password: str) -> TwoFactorSetupResponse:
        with self._account(user_id) as account:
            self._password(account, password)
            if account.factor.secret_encrypted:
                raise TwoFactorError(
                    "Two-factor authentication is already enabled", HTTPStatus.CONFLICT
                )
            secret = generate_secret()
            account.factor.pending_secret_encrypted = (
                self.store.config._fernet(account.session).encrypt(secret.encode()).decode()
            )
            account.factor.pending_expires_at = int(time.time()) + TWO_FACTOR_SETUP_SECONDS
            return TwoFactorSetupResponse(
                secret=secret,
                provisioning_uri=provisioning_uri(secret, account.user.username),
                expires_at=account.factor.pending_expires_at,
            )

    def enable(
        self, user_id: str, password: str, code: str, session_id: str | None
    ) -> TwoFactorEnabledResponse:
        with self._account(user_id) as account:
            self._password(account, password)
            factor = account.factor
            if factor.secret_encrypted:
                raise TwoFactorError(
                    "Two-factor authentication is already enabled", HTTPStatus.CONFLICT
                )
            if not factor.pending_secret_encrypted or factor.pending_expires_at <= int(time.time()):
                raise TwoFactorError("Two-factor setup expired; start again")
            secret = (
                self.store.config._fernet(account.session)
                .decrypt(factor.pending_secret_encrypted.encode())
                .decode()
            )
            step = matching_step(secret, code.strip(), int(time.time()))
            if step is None:
                self._failed(account, "Invalid or already used two-factor code")
            # 只有验证器已生成有效验证码才启用；恢复码只返回一次，数据库只保存摘要。
            codes = [
                secrets.token_hex(RECOVERY_CODE_BYTES).upper() for _ in range(RECOVERY_CODE_COUNT)
            ]
            factor.recovery_hashes = json.dumps(
                [hashlib.sha256(item.encode()).hexdigest() for item in codes]
            )
            factor.secret_encrypted = factor.pending_secret_encrypted
            factor.pending_secret_encrypted = None
            factor.pending_expires_at = 0
            factor.last_used_step = step
            factor.failures = 0
            self._revoke_other_sessions(account, session_id)
            self.store.identity.audit(
                user_id, "auth.two_factor_enabled", "users", session=account.session
            )
            return TwoFactorEnabledResponse(
                recovery_codes=[
                    "-".join(code[i : i + 4] for i in range(0, len(code), 4)) for code in codes
                ]
            )

    def disable(self, user_id: str, password: str, code: str) -> None:
        with self._account(user_id) as account:
            self._password(account, password)
            if not account.factor.secret_encrypted:
                raise TwoFactorError(
                    "Two-factor authentication is not enabled", HTTPStatus.CONFLICT
                )
            self._verify(account, code)
            account.factor.secret_encrypted = None
            account.factor.pending_secret_encrypted = None
            account.factor.pending_expires_at = 0
            account.factor.recovery_hashes = "[]"
            account.factor.last_used_step = -1
            self.store.identity.audit(
                user_id, "auth.two_factor_disabled", "users", session=account.session
            )

    def change_password(
        self, user_id: str, current_password: str, new_password: str, code: str | None
    ) -> None:
        with self._account(user_id) as account:
            self._password(account, current_password)
            if current_password == new_password:
                raise TwoFactorError("New password must be different from current password")
            self._verify(account, code)
            account.user.password_hash = hash_password(new_password)
            account.user.updated_at = utc_now()
            account.factor.pending_secret_encrypted = None
            self.store.identity.audit(
                user_id, "auth.password_change", "users", session=account.session
            )

    def _revoke_other_sessions(self, account: TwoFactorAccount, keep: str | None) -> None:
        # 启用后让其他设备重新验证，保留完成绑定的当前会话。
        now = utc_now()
        account.session.execute(
            update(LoginSession)
            .where(
                LoginSession.user_id == account.user.id,
                LoginSession.id != keep,
                LoginSession.revoked_at.is_(None),
            )
            .values(revoked_at=now)
        )
        account.session.execute(
            update(RefreshToken)
            .where(
                RefreshToken.user_id == account.user.id,
                or_(RefreshToken.session_id != keep, RefreshToken.session_id.is_(None)),
                RefreshToken.revoked_at.is_(None),
            )
            .values(revoked_at=now)
        )
