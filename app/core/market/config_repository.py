"""Scope-aware storage adapters for market dashboard preferences."""

from __future__ import annotations

import json
import logging
import os
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol

logger = logging.getLogger("stocks-assistant.market.config")


class MarketConfigError(RuntimeError):
    """Market preferences could not be read or persisted in their requested scope."""


class MarketConfigStore(Protocol):
    def get_market_config(self, user_id: str) -> dict[str, Any] | None: ...

    def save_market_config(self, user_id: str, config: dict[str, Any]) -> dict[str, Any]: ...


def _app_store() -> MarketConfigStore:
    from app.core.app_store import get_app_store

    return get_app_store()


class MarketConfigRepository:
    def __init__(
        self,
        legacy_path: Path,
        store_factory: Callable[[], MarketConfigStore] = _app_store,
    ) -> None:
        self.legacy_path = legacy_path
        self._store_factory = store_factory

    def load(self, user_id: str | None = None) -> dict[str, Any] | None:
        try:
            if user_id:
                return self._store_factory().get_market_config(user_id)
            if not self.legacy_path.exists():
                return None
            value = json.loads(self.legacy_path.read_text(encoding="utf-8"))
            return value if isinstance(value, dict) else None
        except Exception as exc:
            logger.exception("Unable to read market preferences (user_id=%s)", user_id)
            raise MarketConfigError("Unable to read market configuration") from exc

    def save(self, config: dict[str, Any], user_id: str | None = None) -> dict[str, Any]:
        try:
            # 作用域在操作前确定；个人数据库失败绝不能退回共享文件并返回成功。
            if user_id:
                return self._store_factory().save_market_config(user_id, config)
            self.legacy_path.parent.mkdir(parents=True, exist_ok=True)
            temporary: Path | None = None
            try:
                with tempfile.NamedTemporaryFile(
                    mode="w", encoding="utf-8", dir=self.legacy_path.parent, delete=False
                ) as handle:
                    temporary = Path(handle.name)
                    json.dump(config, handle, ensure_ascii=False, indent=2)
                    handle.flush()
                    os.fsync(handle.fileno())
                temporary.replace(self.legacy_path)
            finally:
                if temporary is not None:
                    temporary.unlink(missing_ok=True)
            return config
        except Exception as exc:
            logger.exception("Unable to save market preferences (user_id=%s)", user_id)
            raise MarketConfigError("Unable to save market configuration") from exc
