"""Portfolio ORM models."""

from __future__ import annotations

from sqlalchemy import CheckConstraint, Index, Integer, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.orm.base import PortfolioBase


class PortfolioItem(PortfolioBase):
    __tablename__ = "portfolio_items"
    __table_args__ = (
        CheckConstraint("market IN ('US', 'A')"),
        UniqueConstraint("user_id", "symbol"),
        Index("idx_portfolio_market", "market"),
        Index("idx_portfolio_user_market", "user_id", "market"),
        {"sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(Text, nullable=False, default="")
    market: Mapped[str] = mapped_column(Text, nullable=False)
    symbol: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False, default="")
    shares: Mapped[str | None] = mapped_column(Text)
    cost_price: Mapped[str | None] = mapped_column(Text)
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False)


class PortfolioSetting(PortfolioBase):
    __tablename__ = "portfolio_settings"

    user_id: Mapped[str] = mapped_column(Text, primary_key=True, default="")
    market: Mapped[str] = mapped_column(Text, primary_key=True)
    total_capital: Mapped[str] = mapped_column(Text, nullable=False, default="0")
    updated_at: Mapped[str] = mapped_column(Text, nullable=False)

