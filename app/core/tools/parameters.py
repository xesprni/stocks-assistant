"""Common scalar conversions for Agent tool arguments."""

from typing import Any


def optional_positive_int(value: Any, name: str) -> int | None:
    if value is None or value == "":
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be an integer") from exc
    if parsed <= 0:
        raise ValueError(f"{name} must be a positive integer")
    return parsed


def bounded_positive_int(value: Any, default: int, minimum: int, maximum: int, name: str) -> int:
    parsed = optional_positive_int(value, name)
    return default if parsed is None else max(minimum, min(parsed, maximum))
