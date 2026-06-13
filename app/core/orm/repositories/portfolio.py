"""Portfolio repository."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

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

    def list_items(self, market: str, user_id: Optional[str] = None) -> list[dict[str, Any]]:
        with session_scope(self.session_factory) as session:
            rows = session.scalars(
                select(PortfolioItem)
                .where(PortfolioItem.market == market, PortfolioItem.user_id == (user_id or ""))
                .order_by(PortfolioItem.sort_order.asc(), PortfolioItem.id.asc())
            ).all()
            return [self._item_to_dict(row) for row in rows]

    def get_settings(self, market: str, user_id: Optional[str] = None) -> dict[str, str] | None:
        with session_scope(self.session_factory) as session:
            row = session.get(PortfolioSetting, {"user_id": user_id or "", "market": market})
            return self._setting_to_dict(row) if row else None

    def save_settings(self, market: str, total_capital: str, user_id: Optional[str], updated_at: str) -> dict[str, str]:
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
                    set_={"total_capital": stmt.excluded.total_capital, "updated_at": stmt.excluded.updated_at},
                )
            )
        return {"market": market, "user_id": user_id or "", "total_capital": total_capital}

    def list_transactions(self, market: str, user_id: Optional[str] = None, limit: int = 100) -> list[dict[str, Any]]:
        with session_scope(self.session_factory) as session:
            rows = session.scalars(
                select(PortfolioTransaction)
                .where(PortfolioTransaction.market == market, PortfolioTransaction.user_id == (user_id or ""))
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

    def update_item(self, item_id: int, patch: dict[str, Any], user_id: Optional[str] = None) -> dict[str, Any]:
        with session_scope(self.session_factory) as session:
            item = session.get(PortfolioItem, item_id)
            if not item or (user_id and item.user_id != user_id):
                raise KeyError(item_id)
            for key, value in patch.items():
                setattr(item, key, value)
            session.flush()
            return self._item_to_dict(item)

    def sell_item(
        self,
        item_id: int,
        *,
        user_id: Optional[str],
        remaining_shares: str,
        total_capital: str,
        transaction: dict[str, Any],
        updated_at: str,
    ) -> tuple[dict[str, Any], dict[str, Any], dict[str, str]]:
        with session_scope(self.session_factory) as session:
            item = session.get(PortfolioItem, item_id)
            if not item or (user_id and item.user_id != user_id):
                raise KeyError(item_id)

            item.shares = remaining_shares
            item.updated_at = updated_at

            setting_key = {"user_id": user_id or "", "market": item.market}
            setting = session.get(PortfolioSetting, setting_key)
            if setting is None:
                setting = PortfolioSetting(
                    user_id=user_id or "",
                    market=item.market,
                    total_capital=total_capital,
                    updated_at=updated_at,
                )
                session.add(setting)
            else:
                setting.total_capital = total_capital
                setting.updated_at = updated_at

            row = PortfolioTransaction(**transaction)
            session.add(row)
            session.flush()
            return self._item_to_dict(item), self._transaction_to_dict(row), self._setting_to_dict(setting)

    def get_item(self, item_id: int, user_id: Optional[str] = None) -> dict[str, Any]:
        with session_scope(self.session_factory) as session:
            item = session.get(PortfolioItem, item_id)
            if not item or (user_id and item.user_id != user_id):
                raise KeyError(item_id)
            return self._item_to_dict(item)

    def delete_item(self, item_id: int, user_id: Optional[str] = None) -> bool:
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
