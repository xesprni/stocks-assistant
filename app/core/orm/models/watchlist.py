"""Watchlist ORM models."""

from __future__ import annotations

from sqlalchemy import CheckConstraint, Index, Integer, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.orm.base import WatchlistBase


class WatchlistItem(WatchlistBase):
    __tablename__ = "watchlist_items"
    __table_args__ = (
        CheckConstraint("category IN ('US', 'A', 'H')"),
        UniqueConstraint("user_id", "symbol"),
        Index("idx_watchlist_category", "category"),
        Index("idx_watchlist_user_category", "user_id", "category"),
        {"sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(Text, nullable=False, default="")
    category: Mapped[str] = mapped_column(Text, nullable=False)
    symbol: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False, default="")
    name_cn: Mapped[str] = mapped_column(Text, nullable=False, default="")
    name_en: Mapped[str] = mapped_column(Text, nullable=False, default="")
    name_hk: Mapped[str] = mapped_column(Text, nullable=False, default="")
    exchange: Mapped[str] = mapped_column(Text, nullable=False, default="")
    currency: Mapped[str] = mapped_column(Text, nullable=False, default="")
    last_done: Mapped[str | None] = mapped_column(Text)
    change_value: Mapped[str | None] = mapped_column(Text)
    change_rate: Mapped[str | None] = mapped_column(Text)
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False)

