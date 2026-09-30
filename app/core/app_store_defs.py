"""Shared constants and helpers for the application store."""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.constants.security import (
    APP_DB_ENV as APP_DB_ENV,
)
from app.constants.security import (
    CONFIG_ENCRYPTION_KEY as CONFIG_ENCRYPTION_KEY,
)
from app.constants.security import (
    DEFAULT_APP_DB as DEFAULT_APP_DB,
)
from app.constants.security import (
    ENCRYPTED_MARKER as ENCRYPTED_MARKER,
)
from app.constants.security import (
    ENCRYPTED_VERSION as ENCRYPTED_VERSION,
)
from app.constants.security import (
    JWT_SECRET_KEY as JWT_SECRET_KEY,
)
from app.constants.security import (
    LOGIN_DEVICE_ONLINE_SECONDS as LOGIN_DEVICE_ONLINE_SECONDS,
)
from app.constants.security import (
    PAGE_PERMISSION_REQUIREMENTS as PAGE_PERMISSION_REQUIREMENTS,
)
from app.constants.security import (
    PERMISSION_DESCRIPTIONS as PERMISSION_DESCRIPTIONS,
)
from app.constants.security import (
    ROLE_PERMISSIONS as ROLE_PERMISSIONS,
)
from app.constants.security import (
    SENSITIVE_CONFIG_KEYS as SENSITIVE_CONFIG_KEYS,
)


def utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def app_db_path() -> Path:
    return Path(os.environ.get(APP_DB_ENV) or DEFAULT_APP_DB).expanduser()


def json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def json_loads(value: str | None, fallback: Any = None) -> Any:
    if value is None:
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


def is_encrypted_payload(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and value.get(ENCRYPTED_MARKER) == ENCRYPTED_VERSION
        and isinstance(value.get("value"), str)
    )
