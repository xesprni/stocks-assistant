"""Watchlist repository."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.core.orm.database import create_session_factory, create_sqlite_engine, session_scope
from app.core.orm.migrations import init_watchlist_schema
from app.core.orm.models.watchlist import WatchlistItem


class WatchlistRepository:
    """Persist watchlist items in the workspace SQLite database."""

    def __init__(self, db_path: str | Path):
        self.db_path = Path(db_path).expanduser()
        self.engine = create_sqlite_engine(self.db_path)
        self.session_factory = create_session_factory(self.engine)
        init_watchlist_schema(self.engine)

    def list_items(self, category: Optional[str] = None, user_id: Optional[str] = None) -> list[dict[str, Any]]:
        with session_scope(self.session_factory) as session:
            stmt = select(WatchlistItem)
            if user_id:
                stmt = stmt.where(WatchlistItem.user_id == user_id)
            if category:
                stmt = stmt.where(WatchlistItem.category == category)
            rows = session.scalars(stmt.order_by(WatchlistItem.sort_order.asc(), WatchlistItem.id.asc())).all()
            return [self._item_to_dict(row) for row in rows]

    def reorder_items(self, ordered_ids: list[int], user_id: Optional[str] = None) -> None:
        with session_scope(self.session_factory) as session:
            for position, item_id in enumerate(ordered_ids):
                item = session.get(WatchlistItem, item_id)
                if not item or (user_id and item.user_id != user_id):
                    continue
                item.sort_order = position

    def add_item(self, payload: dict[str, Any]) -> dict[str, Any]:
        with session_scope(self.session_factory) as session:
            max_order = session.scalar(
                select(func.coalesce(func.max(WatchlistItem.sort_order), -1)).where(
                    WatchlistItem.user_id == payload["user_id"]
                )
            )
            payload["sort_order"] = int(max_order or -1) + 1
            stmt = sqlite_insert(WatchlistItem).values(**payload)
            update_values = {
                key: getattr(stmt.excluded, key)
                for key in (
                    "category",
                    "name",
                    "name_cn",
                    "name_en",
                    "name_hk",
                    "exchange",
                    "currency",
                    "last_done",
                    "change_value",
                    "change_rate",
                    "note",
                    "updated_at",
                )
            }
            session.execute(
                stmt.on_conflict_do_update(
                    index_elements=[WatchlistItem.user_id, WatchlistItem.symbol],
                    set_=update_values,
                )
            )
            session.flush()
            row = session.scalar(
                select(WatchlistItem).where(
                    WatchlistItem.user_id == payload["user_id"],
                    WatchlistItem.symbol == payload["symbol"],
                )
            )
            if row is None:
                raise RuntimeError("Failed to persist watchlist item")
            return self._item_to_dict(row)

    def delete_item(self, item_id: int, user_id: Optional[str] = None) -> bool:
        with session_scope(self.session_factory) as session:
            item = session.get(WatchlistItem, item_id)
            if not item or (user_id and item.user_id != user_id):
                return False
            session.delete(item)
            return True

    @staticmethod
    def _item_to_dict(item: WatchlistItem) -> dict[str, Any]:
        return {
            "id": item.id,
            "user_id": item.user_id,
            "category": item.category,
            "symbol": item.symbol,
            "name": item.name,
            "name_cn": item.name_cn,
            "name_en": item.name_en,
            "name_hk": item.name_hk,
            "exchange": item.exchange,
            "currency": item.currency,
            "last_done": item.last_done,
            "change_value": item.change_value,
            "change_rate": item.change_rate,
            "note": item.note,
            "sort_order": item.sort_order,
            "created_at": item.created_at,
            "updated_at": item.updated_at,
        }

