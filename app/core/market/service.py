"""Market monitoring service — fetches index and watchlist quotes via Longbridge SDK."""

from __future__ import annotations

import json
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Optional

from app.core.watchlist.service import LongbridgeUnavailableError

# 默认监控指数列表
DEFAULT_INDICES = [
    {"symbol": "HSI.HK", "name": "恒生指数", "enabled": True},
    {"symbol": "HSCEI.HK", "name": "国企指数", "enabled": True},
    {"symbol": ".SPX.US", "name": "S&P 500", "enabled": True},
    {"symbol": ".NDX.US", "name": "纳斯达克100", "enabled": True},
    {"symbol": ".DJI.US", "name": "道琼斯", "enabled": True},
    {"symbol": "000001.SH", "name": "上证综指", "enabled": True},
    {"symbol": "000300.SH", "name": "沪深300", "enabled": True},
]

DEFAULT_CONFIG = {
    "indices": DEFAULT_INDICES,
    "refresh_interval": 60,
}

SYMBOL_ALIASES = {
    # Longbridge 对部分指数会返回带前导点的 symbol，配置和结果统一归一成无前导点格式。
    ".HSI.HK": "HSI.HK",
    ".HSCEI.HK": "HSCEI.HK",
    ".HSTECH.HK": "HSTECH.HK",
    ".HSCFI.HK": "HSCFI.HK",
    ".HSHCI.HK": "HSHCI.HK",
}


def _default_config() -> dict:
    return {
        "indices": [dict(index) for index in DEFAULT_INDICES],
        "refresh_interval": DEFAULT_CONFIG["refresh_interval"],
    }


def _canonical_symbol(symbol: Any) -> str:
    raw = str(symbol or "").strip().upper()
    return SYMBOL_ALIASES.get(raw, raw)


def _normalize_index_config(index: Any) -> dict:
    if not isinstance(index, dict):
        symbol = _canonical_symbol(index)
        return {"symbol": symbol, "name": symbol, "enabled": True}

    symbol = _canonical_symbol(index.get("symbol"))
    normalized = dict(index)
    normalized["symbol"] = symbol
    normalized["name"] = str(index.get("name") or symbol)
    normalized["enabled"] = bool(index.get("enabled", True))
    return normalized


def _normalize_config(config: Any) -> dict:
    if not isinstance(config, dict):
        return _default_config()

    normalized = _default_config()
    normalized.update(config)

    indices = normalized.get("indices") or DEFAULT_INDICES
    seen: set[str] = set()
    normalized_indices = []
    for index in indices:
        item = _normalize_index_config(index)
        symbol = item.get("symbol", "")
        # 配置文件可能来自旧版本或手工编辑，保存/读取时顺手去掉空 symbol 和重复项。
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        normalized_indices.append(item)

    normalized["indices"] = normalized_indices
    return normalized


def _normalize_symbol_map(symbol_map: Optional[dict]) -> dict:
    if not symbol_map:
        return {}
    return {_canonical_symbol(symbol): value for symbol, value in symbol_map.items()}


def _str(value: Any) -> Optional[str]:
    if value is None:
        return None
    return str(value)


def _change_value(last_done: Any, prev_close: Any) -> Optional[str]:
    try:
        return str(Decimal(str(last_done)) - Decimal(str(prev_close)))
    except (InvalidOperation, TypeError, ValueError):
        return None


def _change_rate(last_done: Any, prev_close: Any) -> Optional[str]:
    try:
        last = Decimal(str(last_done))
        prev = Decimal(str(prev_close))
    except (InvalidOperation, TypeError, ValueError):
        return None
    if prev == 0:
        return None
    return f"{((last - prev) / prev * Decimal('100')):.2f}%"


class MarketService:
    """行情监控服务，依赖 Longbridge SDK 拉取报价数据。"""

    def __init__(self, workspace_dir: str) -> None:
        root = Path(workspace_dir).expanduser()
        root.mkdir(parents=True, exist_ok=True)
        self.config_path = root / "market_config.json"

    # ------------------------------------------------------------------ config

    def get_config(self, user_id: Optional[str] = None) -> dict:
        if user_id:
            try:
                from app.core.app_store import get_app_store

                stored = get_app_store().get_market_config(user_id)
                if stored:
                    return _normalize_config(stored)
            except Exception:
                pass
            return _default_config()
        if self.config_path.exists():
            try:
                with open(self.config_path, encoding="utf-8") as f:
                    return _normalize_config(json.load(f))
            except Exception:
                pass
        return _default_config()

    def save_config(self, config: dict, user_id: Optional[str] = None) -> dict:
        config = _normalize_config(config)
        if user_id:
            try:
                from app.core.app_store import get_app_store

                return get_app_store().save_market_config(user_id, config)
            except Exception:
                pass
        with open(self.config_path, "w", encoding="utf-8") as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
        return config

    # ------------------------------------------------------------------ quotes

    def get_index_quotes(self, user_id: Optional[str] = None) -> list[dict]:
        cfg = self.get_config(user_id=user_id)
        indices = cfg.get("indices", DEFAULT_INDICES)
        name_map = {idx["symbol"]: idx["name"] for idx in indices}
        symbols = [idx["symbol"] for idx in indices if idx.get("enabled", True)]
        if not symbols:
            return []
        return self._fetch_quotes(symbols, name_map=name_map)

    def get_watchlist_quotes(self, watchlist_items: list[dict]) -> list[dict]:
        if not watchlist_items:
            return []
        symbols = [_canonical_symbol(item["symbol"]) for item in watchlist_items]
        name_map = {
            _canonical_symbol(item["symbol"]): (
                item.get("name") or item.get("name_cn") or item.get("symbol", "")
            )
            for item in watchlist_items
        }
        category_map = {
            _canonical_symbol(item["symbol"]): item.get("category", "")
            for item in watchlist_items
        }
        return self._fetch_quotes(symbols, name_map=name_map, category_map=category_map)

    # ------------------------------------------------------------------ internal

    def _fetch_quotes(
        self,
        symbols: list[str],
        name_map: Optional[dict] = None,
        category_map: Optional[dict] = None,
    ) -> list[dict]:
        normalized_symbols = []
        seen_symbols: set[str] = set()
        for symbol in symbols:
            canonical = _canonical_symbol(symbol)
            # 批量报价前先做归一和去重，减少 Longbridge 请求量并稳定结果 key。
            if not canonical or canonical in seen_symbols:
                continue
            seen_symbols.add(canonical)
            normalized_symbols.append(canonical)
        if not normalized_symbols:
            return []

        normalized_name_map = _normalize_symbol_map(name_map)
        normalized_category_map = _normalize_symbol_map(category_map)

        ctx = self._quote_context()
        try:
            raw_quotes = list(ctx.quote(normalized_symbols))
        except Exception as exc:
            raise LongbridgeUnavailableError(str(exc)) from exc

        results: list[dict] = []
        for q in raw_quotes:
            symbol = _canonical_symbol(getattr(q, "symbol", ""))
            if not symbol:
                continue
            last_done = getattr(q, "last_done", None)
            prev_close = getattr(q, "prev_close", None)
            results.append(
                {
                    "symbol": symbol,
                    "name": normalized_name_map.get(symbol, ""),
                    "category": normalized_category_map.get(symbol, ""),
                    "last_done": _str(last_done),
                    "prev_close": _str(prev_close),
                    "open": _str(getattr(q, "open", None)),
                    "high": _str(getattr(q, "high", None)),
                    "low": _str(getattr(q, "low", None)),
                    "volume": _str(getattr(q, "volume", None)),
                    "turnover": _str(getattr(q, "turnover", None)),
                    "change_value": _change_value(last_done, prev_close),
                    "change_rate": _change_rate(last_done, prev_close),
                }
            )
        return results

    def _quote_context(self):
        try:
            from longbridge.openapi import Config, QuoteContext
        except ImportError as exc:
            raise LongbridgeUnavailableError("Longbridge SDK is not installed") from exc

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

        return QuoteContext(config)

    # ---------------------------------------------------------------- candlestick / intraday

    def get_candlesticks(self, symbol: str, period: str, count: int = 200) -> dict:
        """拉取历史 K 线数据。period: 1D | 1W | 1M。"""
        try:
            from longbridge.openapi import AdjustType, Period
        except ImportError as exc:
            raise LongbridgeUnavailableError("Longbridge SDK is not installed") from exc

        period_map = {
            "1D": Period.Day,
            "1W": Period.Week,
            "1M": Period.Month,
        }
        lb_period = period_map.get(period, Period.Day)
        symbol = _canonical_symbol(symbol)
        ctx = self._quote_context()
        try:
            raw = ctx.candlesticks(symbol, lb_period, min(count, 1000), AdjustType.ForwardAdjust)
        except Exception as exc:
            raise LongbridgeUnavailableError(str(exc)) from exc

        bars = []
        for c in raw:
            ts = getattr(c, "timestamp", None)
            bars.append(
                {
                    "timestamp": int(ts.timestamp()) if ts is not None else 0,
                    "open": _str(getattr(c, "open", None)) or "0",
                    "high": _str(getattr(c, "high", None)) or "0",
                    "low": _str(getattr(c, "low", None)) or "0",
                    "close": _str(getattr(c, "close", None)) or "0",
                    "volume": _str(getattr(c, "volume", None)) or "0",
                    "turnover": _str(getattr(c, "turnover", None)) or "0",
                }
            )
        return {"symbol": symbol, "period": period, "bars": bars}

    def get_intraday(self, symbol: str, since: Optional[int] = None) -> dict:
        """拉取今日分时数据。"""
        symbol = _canonical_symbol(symbol)
        ctx = self._quote_context()
        try:
            raw = ctx.intraday(symbol)
        except Exception as exc:
            raise LongbridgeUnavailableError(str(exc)) from exc

        bars = []
        for line in raw:
            ts = getattr(line, "timestamp", None)
            bars.append(
                {
                    "timestamp": int(ts.timestamp()) if ts is not None else 0,
                    "price": _str(getattr(line, "price", None)) or "0",
                    "volume": _str(getattr(line, "volume", None)) or "0",
                    "turnover": _str(getattr(line, "turnover", None)) or "0",
                    "avg_price": _str(getattr(line, "avg_price", None)) or "0",
                }
            )
        if since is not None:
            bars = [bar for bar in bars if int(bar["timestamp"]) >= since]
        return {"symbol": symbol, "bars": bars}

    def get_market_temperature(self, market: str = "US") -> dict:
        """获取市场温度。market: US / HK / CN"""
        try:
            from longbridge.openapi import Market
        except ImportError as exc:
            raise LongbridgeUnavailableError("Longbridge SDK is not installed") from exc

        market_map = {"US": Market.US, "HK": Market.HK, "CN": Market.CN}
        lb_market = market_map.get(market, Market.US)
        ctx = self._quote_context()
        try:
            resp = ctx.market_temperature(lb_market)
        except Exception as exc:
            raise LongbridgeUnavailableError(str(exc)) from exc
        return {
            "market": market,
            "temperature": getattr(resp, "temperature", None),
            "description": getattr(resp, "description", ""),
            "valuation": getattr(resp, "valuation", None),
            "sentiment": getattr(resp, "sentiment", None),
            "updated_at": getattr(resp, "updated_at", None),
        }
