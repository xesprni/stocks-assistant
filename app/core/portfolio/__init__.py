"""Portfolio services."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .service import PortfolioService

__all__ = ["PortfolioService"]


def __getattr__(name: str) -> Any:
    """延迟加载服务，避免轻量 symbol helper 触发 watchlist 反向导入。"""
    if name == "PortfolioService":
        from .service import PortfolioService

        return PortfolioService
    raise AttributeError(name)
