"""Market monitoring service — dashboard config and quote aggregation."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.constants.market import (
    DEFAULT_CONFIG as DEFAULT_CONFIG,
)
from app.constants.market import (
    DEFAULT_INDICES as DEFAULT_INDICES,
)
from app.core.market.config_repository import MarketConfigRepository
from app.core.market.errors import LongbridgeUnavailableError
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
from app.schemas.market import IndexConfig, MarketDashboardConfig, QuoteItem
from app.schemas.market_data import SecurityStaticInfo

# 默认监控指数列表


def _default_config() -> MarketDashboardConfig:
    return MarketDashboardConfig(
        indices=[dict(index) for index in DEFAULT_INDICES],
        refresh_interval=DEFAULT_CONFIG["refresh_interval"],
    )


def _normalize_index_config(index: Any) -> IndexConfig:
    if not isinstance(index, dict):
        symbol = canonical_symbol(index)
        return IndexConfig(symbol=symbol, name=symbol, enabled=True)

    symbol = canonical_symbol(index.get("symbol"))
    normalized = dict(index)
    normalized["symbol"] = symbol
    normalized["name"] = str(index.get("name") or symbol)
    normalized["enabled"] = bool(index.get("enabled", True))
    return IndexConfig.model_validate(normalized)


def _normalize_config(config: Any) -> MarketDashboardConfig:
    if not isinstance(config, dict):
        return _default_config()

    normalized = _default_config().model_dump()
    normalized.update(config)

    indices = normalized.get("indices") or DEFAULT_INDICES
    seen: set[str] = set()
    normalized_indices = []
    for index in indices:
        item = _normalize_index_config(index)
        symbol = item.symbol
        # 配置文件可能来自旧版本或手工编辑，保存/读取时顺手去掉空 symbol 和重复项。
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        normalized_indices.append(item)

    normalized["indices"] = normalized_indices
    return MarketDashboardConfig.model_validate(normalized)


class MarketService(LongbridgeMarketDataMixin):
    """行情监控服务，依赖 Longbridge SDK 拉取报价数据。"""

    def __init__(
        self, workspace_dir: str, *, config_repository: MarketConfigRepository | None = None
    ) -> None:
        root = Path(workspace_dir).expanduser()
        root.mkdir(parents=True, exist_ok=True)
        self.config_path = root / "market_config.json"
        self.config_repository = config_repository or MarketConfigRepository(self.config_path)

    # ------------------------------------------------------------------ config

    def get_config(self, user_id: str | None = None) -> MarketDashboardConfig:
        stored = self.config_repository.load(user_id)
        return _normalize_config(stored) if stored else _default_config()

    def save_config(self, config: dict, user_id: str | None = None) -> MarketDashboardConfig:
        return MarketDashboardConfig.model_validate(
            self.config_repository.save(_normalize_config(config).model_dump(), user_id)
        )

    # ------------------------------------------------------------------ quotes

    def get_index_quotes(self, user_id: str | None = None, settings: Any = None) -> list[QuoteItem]:
        cfg = self.get_config(user_id=user_id)
        indices = cfg.indices
        name_map = {idx.symbol: idx.name for idx in indices}
        symbols = [idx.symbol for idx in indices if idx.enabled]
        if not symbols:
            return []
        return self._fetch_quotes(symbols, name_map=name_map, settings=settings)

    def get_watchlist_quotes(
        self, watchlist_items: list[dict], settings: Any = None
    ) -> list[QuoteItem]:
        if not watchlist_items:
            return []
        watchlist_items = [QuoteItem.model_validate(item) for item in watchlist_items]
        symbols = [canonical_symbol(item.symbol) for item in watchlist_items]
        name_map = {
            canonical_symbol(item.symbol): (item.name or item.symbol) for item in watchlist_items
        }
        category_map = {canonical_symbol(item.symbol): item.category for item in watchlist_items}
        return self._fetch_quotes(
            symbols, name_map=name_map, category_map=category_map, settings=settings
        )

    def get_security_static_info(
        self, symbols: list[str], settings: Any = None
    ) -> list[SecurityStaticInfo]:
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
        name_map: dict | None = None,
        category_map: dict | None = None,
        settings: Any = None,
    ) -> list[QuoteItem]:
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

        results: list[QuoteItem] = []
        for q in raw_quotes:
            symbol = canonical_symbol(getattr(q, "symbol", ""))
            if not symbol:
                continue
            last_done = getattr(q, "last_done", None)
            prev_close = getattr(q, "prev_close", None)
            results.append(
                QuoteItem(
                    symbol=symbol,
                    name=normalized_name_map.get(symbol, ""),
                    category=normalized_category_map.get(symbol, ""),
                    last_done=stringify(last_done),
                    prev_close=stringify(prev_close),
                    open=stringify(getattr(q, "open", None)),
                    high=stringify(getattr(q, "high", None)),
                    low=stringify(getattr(q, "low", None)),
                    volume=stringify(getattr(q, "volume", None)),
                    turnover=stringify(getattr(q, "turnover", None)),
                    change_value=change_value(last_done, prev_close),
                    change_rate=change_rate(last_done, prev_close),
                )
            )
        return results

    def _serialize_static_info(self, item: Any) -> SecurityStaticInfo:
        def value(attr: str) -> str:
            raw = getattr(item, attr, None)
            if raw in (None, ""):
                return ""
            return enum_name(raw) or stringify(raw) or str(raw)

        symbol = canonical_symbol(getattr(item, "symbol", ""))
        name_cn = value("name_cn")
        name_hk = value("name_hk")
        name_en = value("name_en")
        return SecurityStaticInfo(
            symbol=symbol,
            name=name_cn or name_hk or name_en or symbol,
            name_cn=name_cn,
            name_en=name_en,
            name_hk=name_hk,
            exchange=value("exchange"),
            currency=value("currency"),
            lot_size=value("lot_size"),
            board=value("board"),
            security_type=value("security_type"),
        )
