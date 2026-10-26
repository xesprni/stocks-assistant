"""双重验证的持久化和串行事务边界。"""

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.orm import Session, sessionmaker

from app.core.orm.database import session_scope
from app.core.orm.models.app import User, UserTwoFactor


@dataclass
class TwoFactorAccount:
    session: Session
    user: User
    factor: UserTwoFactor


class TwoFactorRepository:
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self.session_factory = session_factory

    def is_enabled(self, user_id: str) -> bool:
        with session_scope(self.session_factory) as session:
            state = session.get(UserTwoFactor, user_id)
            return bool(state and state.secret_encrypted)

    @contextmanager
    def account(self, user_id: str) -> Iterator[TwoFactorAccount]:
        with session_scope(self.session_factory) as session:
            # SQLite 行锁无效；抢先取得写锁，确保并发请求不能重复消费同一验证码/恢复码。
            session.execute(text("BEGIN IMMEDIATE"))
            user = session.get(User, user_id)
            if user is None or not user.is_active:
                raise KeyError(user_id)
            factor = session.get(UserTwoFactor, user_id)
            if factor is None:
                factor = UserTwoFactor(user_id=user_id)
                session.add(factor)
                session.flush()
            yield TwoFactorAccount(session=session, user=user, factor=factor)
