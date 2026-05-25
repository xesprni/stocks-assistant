"""Declarative bases for the project's separate SQLite databases."""

from sqlalchemy.orm import DeclarativeBase


class AppBase(DeclarativeBase):
    """Application-wide database: config, auth, RBAC, scheduler, MCP."""


class SessionBase(DeclarativeBase):
    """Chat session database, including trace tables."""


class WatchlistBase(DeclarativeBase):
    """Watchlist workspace database."""


class PortfolioBase(DeclarativeBase):
    """Portfolio workspace database."""

