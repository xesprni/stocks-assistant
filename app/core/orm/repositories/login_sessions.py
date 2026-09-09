"""LoginSessionRepository implementation."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, desc, func, select
from sqlalchemy.orm import Session, sessionmaker

from app.core.app_store_defs import LOGIN_DEVICE_ONLINE_SECONDS, json_dumps, utc_now
from app.core.orm.database import session_scope
from app.core.orm.models.app import AuditEvent, LoginSession, RefreshToken, User


def _parse_utc(value: str | None) -> datetime:
    if not value:
        return datetime.min.replace(tzinfo=UTC)
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return datetime.min.replace(tzinfo=UTC)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


class LoginSessionRepository:
    """Application login sessions persistence."""

    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self.session_factory = session_factory

    def create_login_session(
        self,
        user_id: str,
        *,
        expires_at: str,
        user_agent: str = "",
        ip_address: str = "",
        device_id: str = "",
    ) -> dict[str, Any]:
        session_id = str(uuid.uuid4())
        clean_device_id = (device_id or session_id).strip()[:128] or session_id
        now = utc_now()
        with session_scope(self.session_factory) as session:
            # 设备维度只保留一个活跃登录，避免同一浏览器反复登录显示成多台设备。
            old_sessions = session.scalars(
                select(LoginSession).where(
                    LoginSession.user_id == user_id,
                    LoginSession.device_id == clean_device_id,
                    LoginSession.revoked_at.is_(None),
                )
            ).all()
            for old_session in old_sessions:
                old_session.revoked_at = now
                for token in session.scalars(
                    select(RefreshToken).where(RefreshToken.session_id == old_session.id)
                ).all():
                    if not token.revoked_at:
                        token.revoked_at = now
            session.add(
                LoginSession(
                    id=session_id,
                    user_id=user_id,
                    device_id=clean_device_id,
                    created_at=now,
                    last_seen_at=now,
                    expires_at=expires_at,
                    user_agent=user_agent[:500],
                    ip_address=ip_address[:100],
                    last_ip_address=ip_address[:100],
                )
            )
        login_session = self.get_login_session(session_id)
        if not login_session:
            raise RuntimeError("Failed to create login session")
        return login_session

    def get_login_session(self, session_id: str) -> dict[str, Any] | None:
        with session_scope(self.session_factory) as session:
            row = session.get(LoginSession, session_id)
            return self._login_session_to_dict(session, row) if row else None

    def get_login_device(
        self, identifier: str, user_id: str | None = None
    ) -> dict[str, Any] | None:
        with session_scope(self.session_factory) as session:
            row = session.get(LoginSession, identifier)
            if row and (not user_id or row.user_id == user_id):
                rows = session.scalars(
                    select(LoginSession).where(
                        LoginSession.user_id == row.user_id, LoginSession.device_id == row.device_id
                    )
                ).all()
                return self._device_group_to_dict(session, rows)
            stmt = select(LoginSession).where(LoginSession.device_id == identifier)
            if user_id:
                stmt = stmt.where(LoginSession.user_id == user_id)
            rows = session.scalars(stmt).all()
            return self._device_group_to_dict(session, rows) if rows else None

    def list_login_sessions(self, user_id: str | None = None) -> list[dict[str, Any]]:
        with session_scope(self.session_factory) as session:
            stmt = select(LoginSession)
            if user_id:
                stmt = stmt.where(LoginSession.user_id == user_id)
            rows = session.scalars(
                stmt.order_by(desc(LoginSession.last_seen_at), desc(LoginSession.created_at))
            ).all()
            groups: dict[tuple[str, str], list[LoginSession]] = {}
            for row in rows:
                groups.setdefault((row.user_id, row.device_id or row.id), []).append(row)
            devices = [self._device_group_to_dict(session, group) for group in groups.values()]
            devices.sort(
                key=lambda item: (item["is_active"], item["last_seen_at"], item["created_at"]),
                reverse=True,
            )
            return devices

    def touch_login_session(
        self,
        session_id: str,
        *,
        user_agent: str = "",
        ip_address: str = "",
        device_id: str = "",
    ) -> None:
        with session_scope(self.session_factory) as session:
            row = session.get(LoginSession, session_id)
            if not row:
                return
            row.last_seen_at = utc_now()
            row.last_ip_address = ip_address[:100]
            if device_id:
                row.device_id = device_id[:128]
            if user_agent:
                row.user_agent = user_agent[:500]

    def heartbeat_login_device(
        self,
        user_id: str,
        *,
        expires_at: str,
        session_id: str | None = None,
        user_agent: str = "",
        ip_address: str = "",
        device_id: str = "",
    ) -> dict[str, Any]:
        clean_device_id = (device_id or session_id or str(uuid.uuid4())).strip()[:128]
        now = utc_now()
        with session_scope(self.session_factory) as session:
            row = session.get(LoginSession, session_id) if session_id else None
            if row and row.user_id != user_id:
                row = None
            if row and (row.revoked_at or _parse_utc(row.expires_at) <= _parse_utc(now)):
                row = None

            if row is None:
                existing_rows = session.scalars(
                    select(LoginSession)
                    .where(
                        LoginSession.user_id == user_id, LoginSession.device_id == clean_device_id
                    )
                    .order_by(desc(LoginSession.last_seen_at), desc(LoginSession.created_at))
                ).all()
                row = next(
                    (
                        item
                        for item in existing_rows
                        if not item.revoked_at and _parse_utc(item.expires_at) > _parse_utc(now)
                    ),
                    None,
                )

            if row is None:
                row = LoginSession(
                    id=str(uuid.uuid4()),
                    user_id=user_id,
                    device_id=clean_device_id,
                    created_at=now,
                    last_seen_at=now,
                    expires_at=expires_at,
                    user_agent=user_agent[:500],
                    ip_address=ip_address[:100],
                    last_ip_address=ip_address[:100],
                )
                session.add(row)
                session.flush()
            else:
                row.device_id = clean_device_id
                row.last_seen_at = now
                row.last_ip_address = ip_address[:100]
                if user_agent:
                    row.user_agent = user_agent[:500]
                session.flush()

            rows = session.scalars(
                select(LoginSession).where(
                    LoginSession.user_id == user_id, LoginSession.device_id == row.device_id
                )
            ).all()
            return self._device_group_to_dict(session, rows)

    def revoke_login_session(self, session_id: str) -> bool:
        now = utc_now()
        with session_scope(self.session_factory) as session:
            row = session.get(LoginSession, session_id)
            if row and not row.revoked_at:
                row.revoked_at = now
            tokens = session.scalars(
                select(RefreshToken).where(RefreshToken.session_id == session_id)
            ).all()
            for token in tokens:
                if not token.revoked_at:
                    token.revoked_at = now
            return row is not None

    def revoke_login_device(self, identifier: str, user_id: str | None = None) -> bool:
        now = utc_now()
        with session_scope(self.session_factory) as session:
            first = session.get(LoginSession, identifier)
            device_id = (
                first.device_id
                if first and (not user_id or first.user_id == user_id)
                else identifier
            )
            stmt = select(LoginSession).where(LoginSession.device_id == device_id)
            if user_id:
                stmt = stmt.where(LoginSession.user_id == user_id)
            rows = session.scalars(stmt).all()
            if not rows:
                return False
            for row in rows:
                if not row.revoked_at:
                    row.revoked_at = now
                for token in session.scalars(
                    select(RefreshToken).where(RefreshToken.session_id == row.id)
                ).all():
                    if not token.revoked_at:
                        token.revoked_at = now
            return True

    def revoke_other_login_devices(
        self,
        user_id: str,
        *,
        current_session_id: str | None,
    ) -> dict[str, int]:
        with session_scope(self.session_factory) as session:
            # 校验、撤销及审计使用同一写事务，避免并发请求重复统计或保留已失效的当前会话。
            session.connection().exec_driver_sql("BEGIN IMMEDIATE")
            now = utc_now()
            now_dt = _parse_utc(now)
            current = session.get(LoginSession, current_session_id) if current_session_id else None
            if (
                not current
                or current.user_id != user_id
                or current.revoked_at
                or _parse_utc(current.expires_at) <= now_dt
                or not current.device_id.strip()
            ):
                # 旧 token 的设备头及 UA/IP 指纹不可信，不能据此执行批量撤销。
                raise ValueError("Current login device could not be verified; please sign in again")

            rows = [
                row
                for row in session.scalars(
                    select(LoginSession).where(
                        LoginSession.user_id == user_id,
                        LoginSession.device_id != current.device_id,
                        LoginSession.revoked_at.is_(None),
                    )
                ).all()
                if _parse_utc(row.expires_at) > now_dt
            ]
            session_ids = [row.id for row in rows]
            device_ids = sorted({row.device_id or row.id for row in rows})
            for row in rows:
                # 未过期且未撤销的会话仍可持有访问 token，离线状态也必须撤销。
                row.revoked_at = now
            if session_ids:
                tokens = session.scalars(
                    select(RefreshToken).where(
                        RefreshToken.session_id.in_(session_ids), RefreshToken.revoked_at.is_(None)
                    )
                ).all()
                for token in tokens:
                    token.revoked_at = now

            result = {"revoked_devices": len(device_ids), "revoked_sessions": len(session_ids)}
            session.add(
                AuditEvent(
                    id=str(uuid.uuid4()),
                    user_id=user_id,
                    action="auth.sessions_revoke_others",
                    resource="login_sessions",
                    detail_json=json_dumps(
                        {
                            "current_device_id": current.device_id,
                            "current_session_id": current.id,
                            "revoked_device_ids": device_ids,
                            "revoked_session_ids": session_ids,
                            **result,
                        }
                    ),
                    created_at=now,
                )
            )
            return result

    def delete_login_session_record(self, session_id: str, user_id: str | None = None) -> bool:
        with session_scope(self.session_factory) as session:
            row = session.get(LoginSession, session_id)
            if not row or (user_id and row.user_id != user_id):
                return False
            session.execute(delete(RefreshToken).where(RefreshToken.session_id == row.id))
            session.delete(row)
            return True

    def delete_login_device(self, identifier: str, user_id: str | None = None) -> list[str]:
        with session_scope(self.session_factory) as session:
            first = session.get(LoginSession, identifier)
            device_id = (
                first.device_id
                if first and (not user_id or first.user_id == user_id)
                else identifier
            )
            stmt = select(LoginSession).where(LoginSession.device_id == device_id)
            if user_id:
                stmt = stmt.where(LoginSession.user_id == user_id)
            rows = session.scalars(stmt).all()
            if not rows:
                return []
            session_ids = [row.id for row in rows]
            session.execute(delete(RefreshToken).where(RefreshToken.session_id.in_(session_ids)))
            for row in rows:
                session.delete(row)
            return session_ids

    def enforce_login_session_limit(
        self, user_id: str, max_sessions: int, *, keep_session_id: str
    ) -> list[str]:
        max_sessions = max(1, int(max_sessions))
        now = utc_now()
        with session_scope(self.session_factory) as session:
            current = session.get(LoginSession, keep_session_id)
            keep_device_id = current.device_id if current else ""
            active_token_exists = (
                select(RefreshToken.id)
                .where(
                    RefreshToken.session_id == LoginSession.id,
                    RefreshToken.revoked_at.is_(None),
                    RefreshToken.expires_at > now,
                )
                .exists()
            )
            active_rows = session.scalars(
                select(LoginSession).where(
                    LoginSession.user_id == user_id,
                    LoginSession.revoked_at.is_(None),
                    LoginSession.expires_at > now,
                    active_token_exists,
                )
            ).all()
            devices: dict[str, list[LoginSession]] = {}
            for row in active_rows:
                devices.setdefault(row.device_id or row.id, []).append(row)

            def device_sort_key(item: tuple[str, list[LoginSession]]) -> tuple[int, str, str]:
                device_id, rows = item
                latest = max(rows, key=lambda row: (row.last_seen_at, row.created_at))
                return (
                    1 if device_id == keep_device_id else 0,
                    latest.last_seen_at,
                    latest.created_at,
                )

            ordered_devices = sorted(devices.items(), key=device_sort_key, reverse=True)
            revoke_device_ids = [
                device_id
                for device_id, _rows in ordered_devices[max_sessions:]
                if device_id != keep_device_id
            ]
            revoke_ids: list[str] = []
            for device_id in revoke_device_ids:
                for row in devices.get(device_id, []):
                    revoke_ids.append(row.id)
                    if not row.revoked_at:
                        row.revoked_at = now
                    for token in session.scalars(
                        select(RefreshToken).where(RefreshToken.session_id == row.id)
                    ).all():
                        if not token.revoked_at:
                            token.revoked_at = now
            return revoke_ids

    def _device_group_to_dict(self, session: Session, rows: list[LoginSession]) -> dict[str, Any]:
        now_dt = datetime.now(UTC).replace(microsecond=0)
        sorted_rows = sorted(rows, key=lambda row: (row.last_seen_at, row.created_at), reverse=True)
        row_payloads = [self._login_session_to_dict(session, row) for row in sorted_rows]
        active_payloads = [
            item
            for item in row_payloads
            if not item.get("revoked_at")
            and _parse_utc(item.get("expires_at")) > now_dt
            and (int(item.get("active_refresh_tokens") or 0) > 0 or bool(item.get("is_online")))
        ]
        representative = active_payloads[0] if active_payloads else row_payloads[0]
        created_at = min(item["created_at"] for item in row_payloads)
        last_seen_at = max(item["last_seen_at"] for item in row_payloads)
        expires_at = max(
            (item["expires_at"] for item in active_payloads), default=representative["expires_at"]
        )
        active_tokens = sum(int(item.get("active_refresh_tokens") or 0) for item in row_payloads)
        is_online = any(bool(item.get("is_online")) for item in row_payloads)
        session_ids = [item["id"] for item in row_payloads]
        return {
            **representative,
            "id": representative["device_id"],
            "created_at": created_at,
            "last_seen_at": last_seen_at,
            "expires_at": expires_at,
            "revoked_at": None if active_payloads else representative.get("revoked_at"),
            "session_count": len(row_payloads),
            "active_refresh_tokens": active_tokens,
            "is_active": bool(active_payloads),
            "is_online": is_online,
            "session_ids": session_ids,
            "records": row_payloads,
        }

    def _login_session_to_dict(self, session: Session, row: LoginSession) -> dict[str, Any]:
        user = session.get(User, row.user_id)
        active_tokens = session.scalar(
            select(func.count())
            .select_from(RefreshToken)
            .where(
                RefreshToken.session_id == row.id,
                RefreshToken.revoked_at.is_(None),
                RefreshToken.expires_at > utc_now(),
            )
        )
        now_dt = datetime.now(UTC).replace(microsecond=0)
        is_online = (
            not row.revoked_at
            and _parse_utc(row.expires_at) > now_dt
            and _parse_utc(row.last_seen_at)
            >= now_dt - timedelta(seconds=LOGIN_DEVICE_ONLINE_SECONDS)
        )
        return {
            "id": row.id,
            "user_id": row.user_id,
            "username": user.username if user else "",
            "display_name": user.display_name if user else "",
            "device_id": row.device_id or row.id,
            "created_at": row.created_at,
            "last_seen_at": row.last_seen_at,
            "expires_at": row.expires_at,
            "revoked_at": row.revoked_at,
            "user_agent": row.user_agent,
            "ip_address": row.ip_address,
            "last_ip_address": row.last_ip_address,
            "session_count": 1,
            "active_refresh_tokens": int(active_tokens or 0),
            "is_active": bool(
                not row.revoked_at
                and _parse_utc(row.expires_at) > now_dt
                and (active_tokens or is_online)
            ),
            "is_online": is_online,
        }

    def create_refresh_token(
        self,
        user_id: str,
        token_hash: str,
        expires_at: str,
        *,
        session_id: str | None = None,
        user_agent: str = "",
        ip_address: str = "",
    ) -> str:
        token_id = str(uuid.uuid4())
        with session_scope(self.session_factory) as session:
            session.add(
                RefreshToken(
                    id=token_id,
                    user_id=user_id,
                    session_id=session_id,
                    token_hash=token_hash,
                    expires_at=expires_at,
                    created_at=utc_now(),
                    user_agent=user_agent[:500],
                    ip_address=ip_address[:100],
                )
            )
        return token_id

    def get_refresh_token(self, token_hash: str) -> dict[str, Any] | None:
        with session_scope(self.session_factory) as session:
            row = session.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
            return self._refresh_token_to_dict(row) if row else None

    def revoke_refresh_token(self, token_id: str, *, replaced_by: str | None = None) -> None:
        with session_scope(self.session_factory) as session:
            row = session.get(RefreshToken, token_id)
            if row:
                row.revoked_at = utc_now()
                row.replaced_by = replaced_by

    @staticmethod
    def _refresh_token_to_dict(row: RefreshToken) -> dict[str, Any]:
        return {
            "id": row.id,
            "user_id": row.user_id,
            "session_id": row.session_id,
            "token_hash": row.token_hash,
            "expires_at": row.expires_at,
            "created_at": row.created_at,
            "revoked_at": row.revoked_at,
            "replaced_by": row.replaced_by,
            "user_agent": row.user_agent,
            "ip_address": row.ip_address,
        }
