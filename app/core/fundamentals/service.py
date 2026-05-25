"""Fundamental data service backed by Longbridge SDK."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional

from app.core.watchlist.service import LongbridgeUnavailableError


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
    if isinstance(value, dict):
        return {str(k): _plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(item) for item in value]
    if hasattr(value, "__dict__"):
        return {k: _plain(v) for k, v in vars(value).items() if not k.startswith("_")}
    return str(value)


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


class FundamentalService:
    """Fetch and normalize Longbridge fundamental data."""

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
        try:
            from longbridge.openapi import Config, FundamentalContext
        except ImportError as exc:
            raise LongbridgeUnavailableError(
                "Longbridge SDK with FundamentalContext is not installed. Upgrade longbridge to 4.1.0 or later."
            ) from exc

        if settings is None:
            from app.config import get_settings

            settings = get_settings()
        if (
            settings.longbridge_app_key
            and settings.longbridge_app_secret
            and settings.longbridge_access_token
        ):
            config = Config.from_apikey(
                settings.longbridge_app_key,
                settings.longbridge_app_secret,
                settings.longbridge_access_token,
                http_url=settings.longbridge_http_url or None,
                quote_ws_url=settings.longbridge_quote_ws_url or None,
            )
        else:
            try:
                config = Config.from_apikey_env()
            except Exception as exc:
                raise LongbridgeUnavailableError(
                    "Longbridge credentials are not configured. Set LONGBRIDGE_APP_KEY, "
                    "LONGBRIDGE_APP_SECRET and LONGBRIDGE_ACCESS_TOKEN, or add them to config.json."
                ) from exc

        return FundamentalContext(config)

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
