"""Fundamental data service backed by Longbridge SDK."""

from __future__ import annotations

from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor, as_completed
from copy import deepcopy
from datetime import date, datetime, timezone
from decimal import Decimal
import hashlib
import threading
import time
from typing import Any, Optional

from app.core.watchlist.service import LongbridgeUnavailableError


INSIGHTS_CACHE_TTL_SECONDS = 180
INSIGHTS_CACHE_MAX_ENTRIES = 128
INSIGHTS_SECTION_WORKERS = 6

STATEMENT_NAMES = {
    "IS": "利润表",
    "BS": "资产负债表",
    "CF": "现金流量表",
}

STATEMENT_TITLES = {
    "IS": "Income Statement",
    "BS": "Balance Sheet",
    "CF": "Cash Flow Statement",
}

KIND_ALIASES = {
    "ALL": "All",
    "IS": "IncomeStatement",
    "INCOME": "IncomeStatement",
    "INCOME_STATEMENT": "IncomeStatement",
    "INCOMESTATEMENT": "IncomeStatement",
    "BS": "BalanceSheet",
    "BALANCE": "BalanceSheet",
    "BALANCE_SHEET": "BalanceSheet",
    "BALANCESHEET": "BalanceSheet",
    "CF": "CashFlow",
    "CASH": "CashFlow",
    "CASH_FLOW": "CashFlow",
    "CASHFLOW": "CashFlow",
}

PERIOD_ALIASES = {
    "AF": "Annual",
    "ANNUAL": "Annual",
    "YEAR": "Annual",
    "FY": "Annual",
    "SAF": "SemiAnnual",
    "SEMI": "SemiAnnual",
    "SEMI_ANNUAL": "SemiAnnual",
    "SEMIANNUAL": "SemiAnnual",
    "Q1": "Q1",
    "Q2": "Q2",
    "Q3": "Q3",
    "3Q": "ThreeQ",
    "THREE_Q": "ThreeQ",
    "THREEQ": "ThreeQ",
    "QF": "QuarterlyFull",
    "QUARTER": "QuarterlyFull",
    "QUARTERLY": "QuarterlyFull",
    "QUARTERLY_FULL": "QuarterlyFull",
    "QUARTERLYFULL": "QuarterlyFull",
}


def _plain(value: Any) -> Any:
    """Convert SDK response objects into JSON-serializable Python values."""

    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Mapping):
        return {str(k): _plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(item) for item in value]
    if hasattr(value, "__dict__"):
        try:
            object_vars = vars(value)
        except Exception:
            object_vars = {}
        data = (
            {k: _plain(v) for k, v in object_vars.items() if not k.startswith("_") and not callable(v)}
            if isinstance(object_vars, Mapping)
            else {}
        )
        if data:
            return data
    descriptor_data = _descriptor_object_data(value)
    if descriptor_data:
        return descriptor_data
    return str(value)


def _descriptor_object_data(value: Any) -> dict[str, Any]:
    """Serialize PyO3/extension SDK objects whose fields are exposed as descriptors."""

    data: dict[str, Any] = {}
    for cls in type(value).__mro__:
        for name, descriptor in vars(cls).items():
            if name.startswith("_") or name in data:
                continue
            descriptor_type = type(descriptor).__name__
            if descriptor_type not in {"getset_descriptor", "member_descriptor"}:
                continue
            try:
                raw = getattr(value, name)
            except Exception:
                continue
            data[name] = _plain(raw)
    return data


def _as_dict(value: Any) -> dict[str, Any]:
    plain = _plain(value)
    return plain if isinstance(plain, dict) else {}


def _as_list(value: Any) -> list[Any]:
    plain = _plain(value)
    return plain if isinstance(plain, list) else []


def _string(value: Any) -> str:
    if value is None:
        return ""
    return str(value)


def _optional_string(value: Any) -> Optional[str]:
    if value is None:
        return None
    return str(value)


def _period_key(value: dict[str, Any], fallback: str) -> str:
    return _string(value.get("period") or value.get("label") or fallback)


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class FundamentalService:
    """Fetch and normalize Longbridge fundamental data."""

    def __init__(self) -> None:
        self._insights_cache: dict[tuple[str, str], tuple[float, dict[str, Any]]] = {}
        self._insights_cache_lock = threading.RLock()

    def get_security_insights(self, symbol: str, settings: Any = None) -> dict[str, Any]:
        """Fetch Dashboard-ready Longbridge content and fundamental sections."""

        normalized_symbol = symbol.strip().upper()
        if not normalized_symbol:
            raise ValueError("symbol is required")

        cache_key = (normalized_symbol, self._settings_cache_key(settings))
        cached = self._get_cached_insights(cache_key)
        if cached is not None:
            return cached

        fundamental_ctx = None
        quote_ctx = None
        fundamental_error: str | None = None
        quote_error: str | None = None
        fundamental_ctx_lock = threading.Lock()
        quote_ctx_lock = threading.Lock()

        def get_fundamental_ctx():
            nonlocal fundamental_ctx, fundamental_error
            with fundamental_ctx_lock:
                if fundamental_error:
                    raise LongbridgeUnavailableError(fundamental_error)
                if fundamental_ctx is None:
                    try:
                        fundamental_ctx = self._fundamental_context(settings=settings)
                    except LongbridgeUnavailableError as exc:
                        fundamental_error = str(exc)
                        raise
                return fundamental_ctx

        def get_quote_ctx():
            nonlocal quote_ctx, quote_error
            with quote_ctx_lock:
                if quote_error:
                    raise LongbridgeUnavailableError(quote_error)
                if quote_ctx is None:
                    try:
                        quote_ctx = self._quote_context(settings=settings)
                    except LongbridgeUnavailableError as exc:
                        quote_error = str(exc)
                        raise
                return quote_ctx

        def section(fetcher, *, collection_keys: tuple[str, ...] = ("list", "items")) -> dict[str, Any]:
            try:
                return self._section_from_raw(fetcher(), collection_keys=collection_keys)
            except LongbridgeUnavailableError as exc:
                return self._error_section(str(exc))
            except Exception as exc:
                return self._error_section(str(exc))

        sections = {
            "filings": self._error_section("not loaded"),
            "company": self._error_section("not loaded"),
            "valuation": self._error_section("not loaded"),
            "dividends": self._error_section("not loaded"),
            "institution_rating": self._error_section("not loaded"),
            "corporate_actions": self._error_section("not loaded"),
        }
        section_specs = {
            "filings": (lambda: get_quote_ctx().filings(normalized_symbol), ("list", "items", "filings")),
            "company": (lambda: get_fundamental_ctx().company(normalized_symbol), ("list", "items")),
            "valuation": (lambda: get_fundamental_ctx().valuation(normalized_symbol), ("list", "items")),
            "dividends": (lambda: get_fundamental_ctx().dividend(normalized_symbol), ("list", "items", "dividends")),
            "institution_rating": (lambda: get_fundamental_ctx().institution_rating(normalized_symbol), ("list", "items")),
            "corporate_actions": (lambda: get_fundamental_ctx().corp_action(normalized_symbol), ("items", "list", "actions")),
        }

        # Longbridge 各板块相互独立，并发拉取能缩短 Dashboard 选中公司后的等待时间。
        with ThreadPoolExecutor(max_workers=min(INSIGHTS_SECTION_WORKERS, len(section_specs))) as executor:
            futures = {
                executor.submit(section, fetcher, collection_keys=collection_keys): name
                for name, (fetcher, collection_keys) in section_specs.items()
            }
            for future in as_completed(futures):
                sections[futures[future]] = future.result()

        # 每个板块单独捕获错误，避免某个 Longbridge 子接口失败导致 Dashboard 整列空白。
        # 财报明细由独立 Fundamentals API 提供，这里只保留公司资料和轻量研究信息。
        payload = {
            "symbol": normalized_symbol,
            "source": "Longbridge FundamentalContext + QuoteContext",
            "fetched_at": _iso_now(),
            **sections,
        }
        if any(payload[name]["available"] for name in section_specs):
            self._set_cached_insights(cache_key, payload)
        return payload

    def clear_cache(self) -> None:
        """Clear process-local Longbridge insights cache after config changes."""

        with self._insights_cache_lock:
            self._insights_cache.clear()

    def _get_cached_insights(self, cache_key: tuple[str, str]) -> dict[str, Any] | None:
        now = time.monotonic()
        with self._insights_cache_lock:
            cached = self._insights_cache.get(cache_key)
            if not cached:
                return None
            expires_at, payload = cached
            if expires_at <= now:
                self._insights_cache.pop(cache_key, None)
                return None
            return deepcopy(payload)

    def _set_cached_insights(self, cache_key: tuple[str, str], payload: dict[str, Any]) -> None:
        expires_at = time.monotonic() + INSIGHTS_CACHE_TTL_SECONDS
        with self._insights_cache_lock:
            self._insights_cache[cache_key] = (expires_at, deepcopy(payload))
            if len(self._insights_cache) > INSIGHTS_CACHE_MAX_ENTRIES:
                overflow = len(self._insights_cache) - INSIGHTS_CACHE_MAX_ENTRIES
                for key, _ in sorted(self._insights_cache.items(), key=lambda item: item[1][0])[:overflow]:
                    self._insights_cache.pop(key, None)

    @staticmethod
    def _settings_cache_key(settings: Any = None) -> str:
        if settings is None:
            return "env"
        material = "\0".join(
            str(getattr(settings, key, "") or "")
            for key in (
                "longbridge_app_key",
                "longbridge_app_secret",
                "longbridge_access_token",
                "longbridge_http_url",
                "longbridge_quote_ws_url",
            )
        )
        return hashlib.sha256(material.encode("utf-8")).hexdigest()

    def get_financial_reports(
        self,
        symbol: str,
        kind: str = "All",
        period: Optional[str] = None,
        settings: Any = None,
    ) -> dict[str, Any]:
        normalized_symbol = symbol.strip().upper()
        if not normalized_symbol:
            raise ValueError("symbol is required")

        lb_kind_name = self._normalize_kind(kind)
        lb_period_name = self._normalize_period(period) if period else None
        ctx = self._fundamental_context(settings=settings)

        try:
            lb_kind = self._sdk_enum("FinancialReportKind", lb_kind_name)
            lb_period = self._sdk_enum("FinancialReportPeriod", lb_period_name) if lb_period_name else None
            raw_response = ctx.financial_report(normalized_symbol, lb_kind, lb_period)
        except LongbridgeUnavailableError:
            raise
        except Exception as exc:
            raise LongbridgeUnavailableError(str(exc)) from exc

        raw = _as_dict(getattr(raw_response, "list", raw_response))
        return {
            "symbol": normalized_symbol,
            "kind": lb_kind_name,
            "period": lb_period_name,
            "statements": self._map_statements(raw),
        }

    def _fundamental_context(self, settings: Any = None):
        from app.core.market.longbridge_context import get_cached_context

        try:
            return get_cached_context("FundamentalContext", settings=settings)
        except LongbridgeUnavailableError:
            raise
        except Exception as exc:
            raise LongbridgeUnavailableError(
                "Longbridge SDK with FundamentalContext is not installed. Upgrade longbridge to 4.1.0 or later."
            ) from exc

    def _quote_context(self, settings: Any = None):
        from app.core.market.longbridge_context import get_cached_context

        return get_cached_context("QuoteContext", settings=settings)

    @staticmethod
    def _error_section(message: str) -> dict[str, Any]:
        return {
            "available": False,
            "error": message,
            "data": {},
            "items": [],
            "total": 0,
        }

    @staticmethod
    def _section_from_raw(raw: Any, *, collection_keys: tuple[str, ...] = ("list", "items")) -> dict[str, Any]:
        plain = _plain(raw)
        data: dict[str, Any] = {}
        items: list[Any] = []

        if isinstance(plain, list):
            items = plain
        elif isinstance(plain, dict):
            data = dict(plain)
            for key in collection_keys:
                value = data.get(key)
                if isinstance(value, list):
                    items = value
                    if key not in {"statements"}:
                        data.pop(key, None)
                    break

        return {
            "available": True,
            "error": None,
            "data": data,
            "items": items,
            "total": len(items),
        }

    @staticmethod
    def _sdk_enum(enum_name: str, member_name: Optional[str]) -> Any:
        if not member_name:
            return None
        try:
            import longbridge.openapi as op
        except ImportError as exc:
            raise LongbridgeUnavailableError("Longbridge SDK is not installed") from exc

        enum_cls = getattr(op, enum_name)
        return getattr(enum_cls, member_name)

    @staticmethod
    def _normalize_kind(kind: str) -> str:
        value = (kind or "All").strip()
        key = value.replace("-", "_").replace(" ", "_").upper()
        normalized = KIND_ALIASES.get(key, value)
        allowed = {"IncomeStatement", "BalanceSheet", "CashFlow", "All"}
        if normalized not in allowed:
            raise ValueError("kind must be one of All, IncomeStatement, BalanceSheet, CashFlow, IS, BS, CF")
        return normalized

    @staticmethod
    def _normalize_period(period: Optional[str]) -> Optional[str]:
        if not period:
            return None
        value = period.strip()
        key = value.replace("-", "_").replace(" ", "_").upper()
        normalized = PERIOD_ALIASES.get(key, value)
        allowed = {"Annual", "SemiAnnual", "Q1", "Q2", "Q3", "ThreeQ", "QuarterlyFull"}
        if normalized not in allowed:
            raise ValueError("period must be one of Annual, SemiAnnual, Q1, Q2, Q3, ThreeQ, QuarterlyFull")
        return normalized

    def _map_statements(self, raw: dict[str, Any]) -> list[dict[str, Any]]:
        statements = []
        for code in ("IS", "BS", "CF"):
            section = _as_dict(raw.get(code))
            if not section:
                continue
            table = self._map_section(code, [_as_dict(item) for item in _as_list(section.get("indicators"))])
            if table["rows"]:
                statements.append(table)
        return statements

    def _map_section(self, code: str, indicators: list[dict[str, Any]]) -> dict[str, Any]:
        accounts: list[dict[str, Any]] = []
        currency = ""
        has_yoy = False

        for indicator in indicators:
            currency = currency or _string(indicator.get("currency"))
            has_yoy = has_yoy or bool(indicator.get("has_yoy", False))
            indicator_title = _string(indicator.get("title"))
            indicator_short_title = _string(indicator.get("short_title"))
            for account in _as_list(indicator.get("accounts")):
                account_dict = _as_dict(account)
                if not account_dict.get("name"):
                    account_dict["name"] = indicator_title
                if not account_dict.get("field"):
                    account_dict["field"] = indicator_short_title or indicator_title
                accounts.append(account_dict)

        column_meta: dict[str, dict[str, Any]] = {}
        column_order: list[str] = []

        for account in accounts:
            for index, value in enumerate(_as_list(account.get("values"))):
                item = _as_dict(value)
                key = _period_key(item, f"period_{index + 1}")
                if not key:
                    continue
                if key not in column_order:
                    column_order.append(key)
                column_meta.setdefault(key, item)

        if not column_order:
            for indicator in indicators:
                for index, period in enumerate(_as_list(indicator.get("periods"))):
                    key = _string(period) or f"period_{index + 1}"
                    if key not in column_order:
                        column_order.append(key)
                    column_meta.setdefault(key, {"period": key})

        rows = [self._map_account(account, column_order) for account in accounts]
        return {
            "code": code,
            "name": STATEMENT_NAMES.get(code, code),
            "title": STATEMENT_TITLES.get(code, code),
            "short_title": code,
            "currency": currency,
            "has_yoy": has_yoy,
            "columns": [
                {
                    "key": key,
                    "label": key,
                    "year": column_meta.get(key, {}).get("year"),
                    "fp_end": _optional_string(column_meta.get(key, {}).get("fp_end")),
                }
                for key in column_order
            ],
            "rows": rows,
        }

    def _map_account(self, account: dict[str, Any], column_order: list[str]) -> dict[str, Any]:
        values_by_period: dict[str, dict[str, Any]] = {}
        for index, value in enumerate(_as_list(account.get("values"))):
            item = _as_dict(value)
            key = _period_key(item, f"period_{index + 1}")
            if key:
                values_by_period[key] = item

        return {
            "field": _string(account.get("field")),
            "name": _string(account.get("name")),
            "percent": bool(account.get("percent", False)),
            "tip": _string(account.get("tip")),
            "cells": [
                {
                    "period": key,
                    "value": _optional_string(values_by_period.get(key, {}).get("value")),
                    "ratio": _optional_string(values_by_period.get(key, {}).get("ratio")),
                    "yoy": _optional_string(values_by_period.get(key, {}).get("yoy")),
                    "year": values_by_period.get(key, {}).get("year"),
                    "fp_end": _optional_string(values_by_period.get(key, {}).get("fp_end")),
                }
                for key in column_order
            ],
        }
