"""Application-level store facade.

The SQLAlchemy implementation lives in app.core.orm.repositories.app_store.
This module keeps the historical import path stable for API routes, security
helpers, tests, and tool integrations.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from app.core.app_store_defs import (
    APP_DB_ENV,
    CONFIG_ENCRYPTION_KEY,
    DEFAULT_APP_DB,
    ENCRYPTED_MARKER,
    ENCRYPTED_VERSION,
    JWT_SECRET_KEY,
    PAGE_PERMISSION_REQUIREMENTS,
    PERMISSION_DESCRIPTIONS,
    ROLE_PERMISSIONS,
    SENSITIVE_CONFIG_KEYS,
    app_db_path,
    json_dumps as _json_dumps,
    json_loads as _json_loads,
    utc_now,
)
from app.core.orm.repositories.app_store import AppStoreRepository


class AppStore(AppStoreRepository):
    """Compatibility facade for application-owned data."""


_app_store: Optional[AppStore] = None


def get_app_store() -> AppStore:
    global _app_store
    if _app_store is None:
        _app_store = AppStore()
    return _app_store


def reset_app_store_for_tests(db_path: Optional[str | Path] = None) -> AppStore:
    global _app_store
    _app_store = AppStore(db_path)
    return _app_store

