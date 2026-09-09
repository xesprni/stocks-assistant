"""Portfolio repository."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.core.orm.database import create_session_factory, create_sqlite_engine, session_scope
from app.core.orm.migrations import init_portfolio_schema
from app.core.orm.models.portfolio import PortfolioItem, PortfolioSetting, PortfolioTransaction


class PortfolioRepository:
    """Persist local portfolio positions and settings."""

    def __init__(self, db_path: str | Path):
        self.db_path = Path(db_path).expanduser()
        self.engine = create_sqlite_engine(self.db_path)
        self.session_factory = create_session_factory(self.engine)
        init_portfolio_schema(self.engine)

    def list_items(self, market: str, user_id: str | None = None) -> list[dict[str, Any]]:
        with session_scope(self.session_factory) as session:
            rows = session.scalars(
                select(PortfolioItem)
                .where(PortfolioItem.market == market, PortfolioItem.user_id == (user_id or ""))
                .order_by(PortfolioItem.sort_order.asc(), PortfolioItem.id.asc())
            ).all()
            return [self._item_to_dict(row) for row in rows]

    def snapshot(self, market: str, user_id: str | None = None) -> tuple[list[dict[str, Any]], str]:
        with session_scope(self.session_factory) as session:
            # 同一次读取快照包含现金和持仓，避免卖出提交恰好夹在两次查询之间。
            session.connection().exec_driver_sql("BEGIN")
            rows = session.scalars(
                select(PortfolioItem)
                .where(PortfolioItem.market == market, PortfolioItem.user_id == (user_id or ""))
                .order_by(PortfolioItem.sort_order.asc(), PortfolioItem.id.asc())
            ).all()
            setting = session.get(PortfolioSetting, {"user_id": user_id or "", "market": market})
            return [self._item_to_dict(row) for row in rows], (
                setting.total_capital if setting else "0"
            )

    def get_settings(self, market: str, user_id: str | None = None) -> dict[str, str] | None:
        with session_scope(self.session_factory) as session:
            row = session.get(PortfolioSetting, {"user_id": user_id or "", "market": market})
            return self._setting_to_dict(row) if row else None

    def save_settings(
        self, market: str, total_capital: str, user_id: str | None, updated_at: str
    ) -> dict[str, str]:
        payload = {
            "user_id": user_id or "",
            "market": market,
            "total_capital": total_capital,
            "updated_at": updated_at,
        }
        with session_scope(self.session_factory) as session:
            stmt = sqlite_insert(PortfolioSetting).values(**payload)
            session.execute(
                stmt.on_conflict_do_update(
                    index_elements=[PortfolioSetting.user_id, PortfolioSetting.market],
                    set_={
                        "total_capital": stmt.excluded.total_capital,
                        "updated_at": stmt.excluded.updated_at,
                    },
                )
            )
        return {"market": market, "user_id": user_id or "", "total_capital": total_capital}

    def list_transactions(
        self, market: str, user_id: str | None = None, limit: int = 100
    ) -> list[dict[str, Any]]:
        with session_scope(self.session_factory) as session:
            rows = session.scalars(
                select(PortfolioTransaction)
                .where(
                    PortfolioTransaction.market == market,
                    PortfolioTransaction.user_id == (user_id or ""),
                )
                .order_by(PortfolioTransaction.created_at.desc(), PortfolioTransaction.id.desc())
                .limit(limit)
            ).all()
            return [self._transaction_to_dict(row) for row in rows]

    def add_item(self, payload: dict[str, Any]) -> dict[str, Any]:
        with session_scope(self.session_factory) as session:
            max_order = session.scalar(
                select(func.coalesce(func.max(PortfolioItem.sort_order), -1)).where(
                    PortfolioItem.user_id == payload["user_id"],
                    PortfolioItem.market == payload["market"],
                )
            )
            payload["sort_order"] = int(max_order or -1) + 1
            stmt = sqlite_insert(PortfolioItem).values(**payload)
            session.execute(
                stmt.on_conflict_do_update(
                    index_elements=[PortfolioItem.user_id, PortfolioItem.symbol],
                    set_={
                        "market": stmt.excluded.market,
                        "name": stmt.excluded.name,
                        "shares": stmt.excluded.shares,
                        "cost_price": stmt.excluded.cost_price,
                        "note": stmt.excluded.note,
                        "updated_at": stmt.excluded.updated_at,
                    },
                )
            )
            session.flush()
            row = session.scalar(
                select(PortfolioItem).where(
                    PortfolioItem.user_id == payload["user_id"],
                    PortfolioItem.symbol == payload["symbol"],
                )
            )
            if row is None:
                raise RuntimeError("Failed to persist portfolio item")
            return self._item_to_dict(row)

    def update_item(
        self, item_id: int, patch: dict[str, Any], user_id: str | None = None
    ) -> dict[str, Any]:
        with session_scope(self.session_factory) as session:
            item = session.get(PortfolioItem, item_id)
            if not item or (user_id and item.user_id != user_id):
                raise KeyError(item_id)
            for key, value in patch.items():
                setattr(item, key, value)
            session.flush()
            return self._item_to_dict(item)

    @contextmanager
    def sale(self, item_id: int, user_id: str | None = None) -> Iterator[PortfolioSale]:
        """Lock before reading the holding and cash used by a sale command."""
        with session_scope(self.session_factory) as session:
            # SQLite 的写锁必须先于读取；仅将预计算结果放进事务仍会丢失并发更新。
            session.connection().exec_driver_sql("BEGIN IMMEDIATE")
            item = session.get(PortfolioItem, item_id)
            if not item or (user_id and item.user_id != user_id):
                raise KeyError(item_id)
            yield PortfolioSale(session, item, user_id)

    def get_item(self, item_id: int, user_id: str | None = None) -> dict[str, Any]:
        with session_scope(self.session_factory) as session:
            item = session.get(PortfolioItem, item_id)
            if not item or (user_id and item.user_id != user_id):
                raise KeyError(item_id)
            return self._item_to_dict(item)

    def delete_item(self, item_id: int, user_id: str | None = None) -> bool:
        with session_scope(self.session_factory) as session:
            item = session.get(PortfolioItem, item_id)
            if not item or (user_id and item.user_id != user_id):
                return False
            session.delete(item)
            return True

    @staticmethod
    def _item_to_dict(item: PortfolioItem) -> dict[str, Any]:
        return {
            "id": item.id,
            "user_id": item.user_id,
            "market": item.market,
            "symbol": item.symbol,
            "name": item.name,
            "shares": item.shares,
            "cost_price": item.cost_price,
            "note": item.note,
            "sort_order": item.sort_order,
            "created_at": item.created_at,
            "updated_at": item.updated_at,
        }

    @staticmethod
    def _setting_to_dict(setting: PortfolioSetting) -> dict[str, str]:
        return {
            "user_id": setting.user_id,
            "market": setting.market,
            "total_capital": setting.total_capital,
            "updated_at": setting.updated_at,
        }

    @staticmethod
    def _transaction_to_dict(transaction: PortfolioTransaction) -> dict[str, Any]:
        return {
            "id": transaction.id,
            "user_id": transaction.user_id,
            "market": transaction.market,
            "symbol": transaction.symbol,
            "name": transaction.name,
            "side": transaction.side,
            "shares": transaction.shares,
            "price": transaction.price,
            "amount": transaction.amount,
            "realized_pnl": transaction.realized_pnl,
            "note": transaction.note,
            "created_at": transaction.created_at,
        }


class PortfolioSale:
    """A holding, cash balance and ledger entry in one caller-owned transaction."""

    def __init__(self, session: Session, item: PortfolioItem, user_id: str | None):
        self._session = session
        self._item = item
        self._user_id = user_id or ""
        self._setting = session.get(
            PortfolioSetting, {"user_id": self._user_id, "market": item.market}
        )

    @property
    def item(self) -> dict[str, Any]:
        return PortfolioRepository._item_to_dict(self._item)

    @property
    def total_capital(self) -> str:
        return self._setting.total_capital if self._setting is not None else "0"

    def record(
        self,
        *,
        remaining_shares: str,
        total_capital: str,
        transaction: dict[str, Any],
        updated_at: str,
    ) -> tuple[dict[str, Any], dict[str, Any], dict[str, str]]:
        self._item.shares = remaining_shares
        self._item.updated_at = updated_at
        if self._setting is None:
            self._setting = PortfolioSetting(
                user_id=self._user_id,
                market=self._item.market,
                total_capital=total_capital,
                updated_at=updated_at,
            )
            self._session.add(self._setting)
        else:
            self._setting.total_capital = total_capital
            self._setting.updated_at = updated_at
        row = PortfolioTransaction(**transaction)
        self._session.add(row)
        self._session.flush()
        return (
            PortfolioRepository._item_to_dict(self._item),
            PortfolioRepository._transaction_to_dict(row),
            PortfolioRepository._setting_to_dict(self._setting),
        )
