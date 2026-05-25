"""Market data formatting helpers."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Optional

SYMBOL_ALIASES = {
    # Longbridge 对部分指数会返回带前导点的 symbol，配置和结果统一归一成无前导点格式。
    ".HSI.HK": "HSI.HK",
    ".HSCEI.HK": "HSCEI.HK",
    ".HSTECH.HK": "HSTECH.HK",
    ".HSCFI.HK": "HSCFI.HK",
    ".HSHCI.HK": "HSHCI.HK",
}


def canonical_symbol(symbol: Any) -> str:
    raw = str(symbol or "").strip().upper()
    return SYMBOL_ALIASES.get(raw, raw)


def normalize_symbol_map(symbol_map: Optional[dict]) -> dict:
    if not symbol_map:
        return {}
    return {canonical_symbol(symbol): value for symbol, value in symbol_map.items()}


def normalize_symbols(symbols: list[str]) -> list[str]:
    normalized_symbols = []
    seen_symbols: set[str] = set()
    for symbol in symbols:
        canonical = canonical_symbol(symbol)
        if not canonical or canonical in seen_symbols:
            continue
        seen_symbols.add(canonical)
        normalized_symbols.append(canonical)
    return normalized_symbols


def stringify(value: Any) -> Optional[str]:
    if value is None:
        return None
    return str(value)


def enum_name(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value)
    return text.split(".", 1)[1] if "." in text else text


def timestamp(value: Any) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    if hasattr(value, "timestamp"):
        return int(value.timestamp())
    return None


def date_iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, (date, datetime)):
        return value.date().isoformat() if isinstance(value, datetime) else value.isoformat()
    return str(value)


def change_value(last_done: Any, prev_close: Any) -> Optional[str]:
    try:
        return str(Decimal(str(last_done)) - Decimal(str(prev_close)))
    except (InvalidOperation, TypeError, ValueError):
        return None


def change_rate(last_done: Any, prev_close: Any) -> Optional[str]:
    try:
        last = Decimal(str(last_done))
        prev = Decimal(str(prev_close))
    except (InvalidOperation, TypeError, ValueError):
        return None
    if prev == 0:
        return None
    return f"{((last - prev) / prev * Decimal('100')):.2f}%"
