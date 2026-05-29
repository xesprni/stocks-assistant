"""Market monitoring service — dashboard config and quote aggregation."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

from app.core.market.longbridge_data import LongbridgeMarketDataMixin
from app.core.market.utils import (
    canonical_symbol,
    change_rate,
    change_value,
    enum_name,
    normalize_symbol_map,
    normalize_symbols,
    stringify,
)
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


def _default_config() -> dict:
    return {
        "indices": [dict(index) for index in DEFAULT_INDICES],
        "refresh_interval": DEFAULT_CONFIG["refresh_interval"],
    }


def _normalize_index_config(index: Any) -> dict:
    if not isinstance(index, dict):
        symbol = canonical_symbol(index)
        return {"symbol": symbol, "name": symbol, "enabled": True}

    symbol = canonical_symbol(index.get("symbol"))
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


class MarketService(LongbridgeMarketDataMixin):
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

    def get_index_quotes(self, user_id: Optional[str] = None, settings: Any = None) -> list[dict]:
        cfg = self.get_config(user_id=user_id)
        indices = cfg.get("indices", DEFAULT_INDICES)
        name_map = {idx["symbol"]: idx["name"] for idx in indices}
        symbols = [idx["symbol"] for idx in indices if idx.get("enabled", True)]
        if not symbols:
            return []
        return self._fetch_quotes(symbols, name_map=name_map, settings=settings)

    def get_watchlist_quotes(self, watchlist_items: list[dict], settings: Any = None) -> list[dict]:
        if not watchlist_items:
            return []
        symbols = [canonical_symbol(item["symbol"]) for item in watchlist_items]
        name_map = {
            canonical_symbol(item["symbol"]): (
                item.get("name") or item.get("name_cn") or item.get("symbol", "")
            )
            for item in watchlist_items
        }
        category_map = {
            canonical_symbol(item["symbol"]): item.get("category", "")
            for item in watchlist_items
        }
        return self._fetch_quotes(symbols, name_map=name_map, category_map=category_map, settings=settings)

    def get_security_static_info(self, symbols: list[str], settings: Any = None) -> list[dict]:
        """拉取 Longbridge 标的基础资料，用于 Dashboard 公司资料补全。"""
        normalized_symbols = normalize_symbols(symbols)
        if not normalized_symbols:
            return []

        ctx = self._quote_context(settings=settings)
        try:
            raw_infos = list(ctx.static_info(normalized_symbols))
        except Exception as exc:
            raise LongbridgeUnavailableError(str(exc)) from exc

        return [self._serialize_static_info(item) for item in raw_infos]

    def _fetch_quotes(
        self,
        symbols: list[str],
        name_map: Optional[dict] = None,
        category_map: Optional[dict] = None,
        settings: Any = None,
    ) -> list[dict]:
        # 批量报价前先做归一和去重，减少 Longbridge 请求量并稳定结果 key。
        normalized_symbols = normalize_symbols(symbols)
        if not normalized_symbols:
            return []

        normalized_name_map = normalize_symbol_map(name_map)
        normalized_category_map = normalize_symbol_map(category_map)

        ctx = self._quote_context(settings=settings)
        try:
            raw_quotes = list(ctx.quote(normalized_symbols))
        except Exception as exc:
            raise LongbridgeUnavailableError(str(exc)) from exc

        results: list[dict] = []
        for q in raw_quotes:
            symbol = canonical_symbol(getattr(q, "symbol", ""))
            if not symbol:
                continue
            last_done = getattr(q, "last_done", None)
            prev_close = getattr(q, "prev_close", None)
            results.append(
                {
                    "symbol": symbol,
                    "name": normalized_name_map.get(symbol, ""),
                    "category": normalized_category_map.get(symbol, ""),
                    "last_done": stringify(last_done),
                    "prev_close": stringify(prev_close),
                    "open": stringify(getattr(q, "open", None)),
                    "high": stringify(getattr(q, "high", None)),
                    "low": stringify(getattr(q, "low", None)),
                    "volume": stringify(getattr(q, "volume", None)),
                    "turnover": stringify(getattr(q, "turnover", None)),
                    "change_value": change_value(last_done, prev_close),
                    "change_rate": change_rate(last_done, prev_close),
                }
            )
        return results

    def _serialize_static_info(self, item: Any) -> dict:
        def value(attr: str) -> str:
            raw = getattr(item, attr, None)
            if raw in (None, ""):
                return ""
            return enum_name(raw) or stringify(raw) or str(raw)

        symbol = canonical_symbol(getattr(item, "symbol", ""))
        name_cn = value("name_cn")
        name_hk = value("name_hk")
        name_en = value("name_en")
        return {
            "symbol": symbol,
            "name": name_cn or name_hk or name_en or symbol,
            "name_cn": name_cn,
            "name_en": name_en,
            "name_hk": name_hk,
            "exchange": value("exchange"),
            "currency": value("currency"),
            "lot_size": value("lot_size"),
            "board": value("board"),
            "security_type": value("security_type"),
        }
