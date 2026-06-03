"""Longbridge quote data access for MarketService."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional

from app.core.market.technical_indicators import calculate_technical_indicators
from app.core.market.utils import (
    canonical_symbol,
    change_rate,
    change_value,
    date_iso,
    enum_name,
    normalize_symbols,
    stringify,
    timestamp,
)
from app.core.watchlist.service import LongbridgeUnavailableError


class LongbridgeMarketDataMixin:
    """Longbridge SDK quote/market-data methods shared by APIs and builtin tools."""

    def _longbridge_config(self, settings: Any = None):
        try:
            from longbridge.openapi import Config
        except ImportError as exc:
            raise LongbridgeUnavailableError("Longbridge SDK is not installed") from exc

        from app.config import get_settings

        settings = settings or get_settings()
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
                    "LONGBRIDGE_APP_SECRET and LONGBRIDGE_ACCESS_TOKEN, or configure them in the app."
                ) from exc

        return config

    def _quote_context(self, settings: Any = None):
        try:
            from longbridge.openapi import QuoteContext
        except ImportError as exc:
            raise LongbridgeUnavailableError("Longbridge SDK is not installed") from exc

        config = self._longbridge_config(settings=settings)
        return QuoteContext(config)

    def _market_context(self, settings: Any = None):
        try:
            from longbridge.openapi import MarketContext
        except ImportError as exc:
            raise LongbridgeUnavailableError("Longbridge SDK is not installed") from exc

        config = self._longbridge_config(settings=settings)
        return MarketContext(config)

    def get_realtime_quotes(self, symbols: list[str], settings: Any = None) -> dict:
        """拉取证券实时报价。"""
        normalized_symbols = normalize_symbols(symbols)
        if not normalized_symbols:
            return {"source": "Longbridge QuoteContext.quote", "quotes": [], "total": 0}

        ctx = self._quote_context(settings=settings)
        try:
            raw_quotes = list(ctx.quote(normalized_symbols))
        except Exception as exc:
            raise LongbridgeUnavailableError(str(exc)) from exc
        quotes = [self._serialize_quote(item) for item in raw_quotes]
        return {
            "source": "Longbridge QuoteContext.quote",
            "symbols": normalized_symbols,
            "quotes": quotes,
            "total": len(quotes),
        }

    def get_candlesticks(
        self,
        symbol: str,
        period: str,
        count: int = 200,
        adjust_type: str = "forward",
        trade_sessions: Optional[str] = None,
        settings: Any = None,
    ) -> dict:
        """拉取近期 K 线数据。period 支持日/周/月及 Longbridge 分钟周期。"""
        lb_period, period_name = self._longbridge_period(period)
        lb_adjust_type, adjust_name = self._longbridge_adjust_type(adjust_type)
        lb_trade_sessions, trade_sessions_name = self._longbridge_trade_sessions(trade_sessions)
        symbol = canonical_symbol(symbol)
        ctx = self._quote_context(settings=settings)
        try:
            if lb_trade_sessions is None:
                raw = ctx.candlesticks(symbol, lb_period, min(max(int(count), 1), 1000), lb_adjust_type)
            else:
                raw = ctx.candlesticks(
                    symbol,
                    lb_period,
                    min(max(int(count), 1), 1000),
                    lb_adjust_type,
                    lb_trade_sessions,
                )
        except Exception as exc:
            raise LongbridgeUnavailableError(str(exc)) from exc

        bars = [self._serialize_candlestick(item) for item in raw]
        return {
            "source": "Longbridge QuoteContext.candlesticks",
            "symbol": symbol,
            "period": period_name,
            "adjust_type": adjust_name,
            "trade_sessions": trade_sessions_name,
            "bars": bars,
        }

    def get_history_candlesticks(
        self,
        symbol: str,
        period: str = "1D",
        start: Optional[str] = None,
        end: Optional[str] = None,
        adjust_type: str = "forward",
        trade_sessions: Optional[str] = None,
        settings: Any = None,
    ) -> dict:
        """按日期区间拉取历史 K 线。start/end 使用 YYYY-MM-DD。"""
        lb_period, period_name = self._longbridge_period(period)
        lb_adjust_type, adjust_name = self._longbridge_adjust_type(adjust_type)
        lb_trade_sessions, trade_sessions_name = self._longbridge_trade_sessions(trade_sessions)
        symbol = canonical_symbol(symbol)
        start_date = self._parse_date(start)
        end_date = self._parse_date(end)
        ctx = self._quote_context(settings=settings)
        try:
            if lb_trade_sessions is None:
                raw = ctx.history_candlesticks_by_date(symbol, lb_period, lb_adjust_type, start_date, end_date)
            else:
                raw = ctx.history_candlesticks_by_date(
                    symbol,
                    lb_period,
                    lb_adjust_type,
                    start_date,
                    end_date,
                    lb_trade_sessions,
                )
        except Exception as exc:
            raise LongbridgeUnavailableError(str(exc)) from exc

        bars = [self._serialize_candlestick(item) for item in raw]
        return {
            "source": "Longbridge QuoteContext.history_candlesticks_by_date",
            "symbol": symbol,
            "period": period_name,
            "start": start_date.isoformat() if start_date else None,
            "end": end_date.isoformat() if end_date else None,
            "adjust_type": adjust_name,
            "trade_sessions": trade_sessions_name,
            "bars": bars,
        }

    def get_intraday(
        self,
        symbol: str,
        since: Optional[int] = None,
        trade_sessions: Optional[str] = None,
        settings: Any = None,
    ) -> dict:
        """拉取今日分时数据。"""
        symbol = canonical_symbol(symbol)
        lb_trade_sessions, trade_sessions_name = self._longbridge_trade_sessions(trade_sessions)
        ctx = self._quote_context(settings=settings)
        try:
            raw = ctx.intraday(symbol) if lb_trade_sessions is None else ctx.intraday(symbol, lb_trade_sessions)
        except Exception as exc:
            raise LongbridgeUnavailableError(str(exc)) from exc

        bars = [self._serialize_intraday_line(item) for item in raw]
        if since is not None:
            bars = [bar for bar in bars if int(bar["timestamp"]) >= since]
        return {
            "source": "Longbridge QuoteContext.intraday",
            "symbol": symbol,
            "trade_sessions": trade_sessions_name,
            "bars": bars,
        }

    def get_capital_flow(self, symbol: str, settings: Any = None) -> dict:
        """拉取标的当日资金净流入时序。"""
        symbol = canonical_symbol(symbol)
        if not symbol:
            raise ValueError("symbol is required")

        ctx = self._quote_context(settings=settings)
        try:
            raw = ctx.capital_flow(symbol)
        except Exception as exc:
            raise LongbridgeUnavailableError(str(exc)) from exc

        # Longbridge 返回的是盘中资金净流入曲线；按时间排序后前端和工具都能稳定消费。
        lines = sorted(
            (self._serialize_capital_flow_line(item) for item in raw),
            key=lambda item: item["timestamp"],
        )
        return {
            "source": "Longbridge QuoteContext.capital_flow",
            "symbol": symbol,
            "lines": lines,
            "total": len(lines),
        }

    def get_trades(self, symbol: str, count: int = 50, settings: Any = None) -> dict:
        """拉取逐笔成交。"""
        symbol = canonical_symbol(symbol)
        ctx = self._quote_context(settings=settings)
        try:
            raw = ctx.trades(symbol, min(max(int(count), 1), 500))
        except Exception as exc:
            raise LongbridgeUnavailableError(str(exc)) from exc
        trades = [self._serialize_trade(item) for item in raw]
        return {
            "source": "Longbridge QuoteContext.trades",
            "symbol": symbol,
            "trades": trades,
            "total": len(trades),
        }

    def get_depth(self, symbol: str, settings: Any = None) -> dict:
        """拉取买卖盘口深度。"""
        symbol = canonical_symbol(symbol)
        ctx = self._quote_context(settings=settings)
        try:
            raw = ctx.depth(symbol)
        except Exception as exc:
            raise LongbridgeUnavailableError(str(exc)) from exc
        return {
            "source": "Longbridge QuoteContext.depth",
            "symbol": symbol,
            "bids": [self._serialize_depth_level(item) for item in getattr(raw, "bids", [])],
            "asks": [self._serialize_depth_level(item) for item in getattr(raw, "asks", [])],
        }

    def get_market_status(self, settings: Any = None) -> dict:
        """拉取所有市场当前交易状态。"""
        ctx = self._market_context(settings=settings)
        try:
            raw = ctx.market_status()
        except Exception as exc:
            raise LongbridgeUnavailableError(str(exc)) from exc
        items = [self._serialize_market_time_item(item) for item in getattr(raw, "market_time", [])]
        return {
            "source": "Longbridge MarketContext.market_status",
            "market_time": items,
            "total": len(items),
        }

    def get_trading_days(self, market: str, begin: str, end: str, settings: Any = None) -> dict:
        """拉取指定市场交易日历。begin/end 使用 YYYY-MM-DD。"""
        lb_market, market_name = self._longbridge_market(market)
        begin_date = self._parse_date(begin)
        end_date = self._parse_date(end)
        if begin_date is None or end_date is None:
            raise ValueError("begin and end are required and must use YYYY-MM-DD")
        ctx = self._quote_context(settings=settings)
        try:
            raw = ctx.trading_days(lb_market, begin_date, end_date)
        except Exception as exc:
            raise LongbridgeUnavailableError(str(exc)) from exc
        return {
            "source": "Longbridge QuoteContext.trading_days",
            "market": market_name,
            "begin": begin_date.isoformat(),
            "end": end_date.isoformat(),
            "trading_days": [date_iso(item) for item in getattr(raw, "trading_days", [])],
            "half_trading_days": [date_iso(item) for item in getattr(raw, "half_trading_days", [])],
        }

    def get_quote_indicators(self, symbols: list[str], indexes: list[str], settings: Any = None) -> dict:
        """拉取 Longbridge 支持的证券计算指标。"""
        normalized_symbols = normalize_symbols(symbols)
        if not normalized_symbols:
            return {"source": "Longbridge QuoteContext.calc_indexes", "indicators": [], "total": 0}
        lb_indexes, index_names = self._longbridge_calc_indexes(indexes)
        ctx = self._quote_context(settings=settings)
        try:
            raw = ctx.calc_indexes(normalized_symbols, lb_indexes)
        except Exception as exc:
            raise LongbridgeUnavailableError(str(exc)) from exc
        indicators = [self._serialize_calc_index(item) for item in raw]
        return {
            "source": "Longbridge QuoteContext.calc_indexes",
            "symbols": normalized_symbols,
            "requested_indexes": index_names,
            "indicators": indicators,
            "total": len(indicators),
        }

    def get_technical_indicators(
        self,
        symbol: str,
        period: str = "1D",
        count: int = 300,
        indicators: Optional[list[str]] = None,
        adjust_type: str = "forward",
        trade_sessions: Optional[str] = None,
        params: Optional[dict[str, Any]] = None,
        series_limit: int = 120,
        settings: Any = None,
    ) -> dict:
        """基于 Longbridge K 线本地计算经典技术指标。"""
        try:
            bounded_count = min(max(int(count), 1), 1000)
        except (TypeError, ValueError) as exc:
            raise ValueError("count must be an integer") from exc

        # 复用同一条 K 线数据通道，保证 API 与内置工具的复权、盘段和 symbol 规范一致。
        kline_payload = self.get_candlesticks(
            symbol,
            period,
            count=bounded_count,
            adjust_type=adjust_type,
            trade_sessions=trade_sessions,
            settings=settings,
        )
        calculation = calculate_technical_indicators(
            kline_payload["bars"],
            indicators=indicators,
            params=params,
            series_limit=series_limit,
        )
        return {
            "source": "Longbridge QuoteContext.candlesticks + local technical indicator calculation",
            "symbol": kline_payload["symbol"],
            "period": kline_payload["period"],
            "adjust_type": kline_payload["adjust_type"],
            "trade_sessions": kline_payload["trade_sessions"],
            "bars_count": calculation["bars_count"],
            "latest_timestamp": calculation["latest_timestamp"],
            "requested_indicators": calculation["requested_indicators"],
            "available_indicators": calculation["available_indicators"],
            "params": calculation["params"],
            "series_limit": calculation["series_limit"],
            "series_timestamps": calculation["series_timestamps"],
            "latest": calculation["latest"],
            "series": calculation["series"],
        }

    def get_market_temperature(self, market: str = "US", settings: Any = None) -> dict:
        """获取市场温度。market: US / HK / CN"""
        try:
            from longbridge.openapi import Market
        except ImportError as exc:
            raise LongbridgeUnavailableError("Longbridge SDK is not installed") from exc

        market_map = {"US": Market.US, "HK": Market.HK, "CN": Market.CN}
        lb_market = market_map.get(market, Market.US)
        ctx = self._quote_context(settings=settings)
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

    def _longbridge_period(self, period: str):
        try:
            from longbridge.openapi import Period
        except ImportError as exc:
            raise LongbridgeUnavailableError("Longbridge SDK is not installed") from exc

        key = str(period or "1D").strip().upper().replace("-", "_").replace(" ", "")
        period_map = {
            "D": Period.Day,
            "DAY": Period.Day,
            "1D": Period.Day,
            "W": Period.Week,
            "WEEK": Period.Week,
            "1W": Period.Week,
            "M": Period.Month,
            "MONTH": Period.Month,
            "1M": Period.Month,
            "Q": Period.Quarter,
            "QUARTER": Period.Quarter,
            "1Q": Period.Quarter,
            "Y": Period.Year,
            "YEAR": Period.Year,
            "1Y": Period.Year,
            "1MIN": Period.Min_1,
            "MIN_1": Period.Min_1,
            "M1": Period.Min_1,
            "2M": Period.Min_2,
            "2MIN": Period.Min_2,
            "MIN_2": Period.Min_2,
            "3M": Period.Min_3,
            "3MIN": Period.Min_3,
            "MIN_3": Period.Min_3,
            "5M": Period.Min_5,
            "5MIN": Period.Min_5,
            "MIN_5": Period.Min_5,
            "10M": Period.Min_10,
            "10MIN": Period.Min_10,
            "MIN_10": Period.Min_10,
            "15M": Period.Min_15,
            "15MIN": Period.Min_15,
            "MIN_15": Period.Min_15,
            "20M": Period.Min_20,
            "20MIN": Period.Min_20,
            "MIN_20": Period.Min_20,
            "30M": Period.Min_30,
            "30MIN": Period.Min_30,
            "MIN_30": Period.Min_30,
            "45M": Period.Min_45,
            "45MIN": Period.Min_45,
            "MIN_45": Period.Min_45,
            "60M": Period.Min_60,
            "60MIN": Period.Min_60,
            "1H": Period.Min_60,
            "MIN_60": Period.Min_60,
            "120M": Period.Min_120,
            "120MIN": Period.Min_120,
            "2H": Period.Min_120,
            "MIN_120": Period.Min_120,
            "180M": Period.Min_180,
            "180MIN": Period.Min_180,
            "3H": Period.Min_180,
            "MIN_180": Period.Min_180,
            "240M": Period.Min_240,
            "240MIN": Period.Min_240,
            "4H": Period.Min_240,
            "MIN_240": Period.Min_240,
        }
        value = period_map.get(key)
        if value is None:
            raise ValueError("period must be one of: 1D, 1W, 1M, 1Y, 1min, 5min, 15min, 30min, 60min")
        return value, enum_name(value) or key

    def _longbridge_adjust_type(self, adjust_type: str):
        try:
            from longbridge.openapi import AdjustType
        except ImportError as exc:
            raise LongbridgeUnavailableError("Longbridge SDK is not installed") from exc

        key = str(adjust_type or "forward").strip().lower().replace("-", "_")
        if key in {"forward", "forward_adjust", "qfq", "前复权"}:
            value = AdjustType.ForwardAdjust
        elif key in {"none", "no", "no_adjust", "raw", "不复权"}:
            value = AdjustType.NoAdjust
        else:
            raise ValueError("adjust_type must be forward or none")
        return value, enum_name(value) or key

    def _longbridge_trade_sessions(self, trade_sessions: Optional[str]):
        if trade_sessions is None or str(trade_sessions).strip() == "":
            return None, None
        try:
            from longbridge.openapi import TradeSessions
        except ImportError as exc:
            raise LongbridgeUnavailableError("Longbridge SDK is not installed") from exc

        key = str(trade_sessions).strip().lower()
        if key in {"all", "extended", "prepost", "pre_post", "全部"}:
            value = TradeSessions.All
        elif key in {"intraday", "regular", "rth", "盘中"}:
            value = TradeSessions.Intraday
        else:
            raise ValueError("trade_sessions must be intraday or all")
        return value, enum_name(value) or key

    def _longbridge_market(self, market: str):
        try:
            from longbridge.openapi import Market
        except ImportError as exc:
            raise LongbridgeUnavailableError("Longbridge SDK is not installed") from exc

        key = str(market or "US").strip().upper()
        market_map = {
            "US": Market.US,
            "HK": Market.HK,
            "CN": Market.CN,
            "A": Market.CN,
            "SH": Market.CN,
            "SZ": Market.CN,
            "SG": Market.SG,
            "CRYPTO": Market.Crypto,
        }
        value = market_map.get(key)
        if value is None:
            raise ValueError("market must be one of: US, HK, CN, SG, Crypto")
        return value, enum_name(value) or key

    def _longbridge_calc_indexes(self, indexes: list[str]):
        try:
            from longbridge.openapi import CalcIndex
        except ImportError as exc:
            raise LongbridgeUnavailableError("Longbridge SDK is not installed") from exc

        default_indexes = [
            "LastDone",
            "ChangeRate",
            "ChangeValue",
            "Volume",
            "Turnover",
            "TurnoverRate",
            "VolumeRatio",
            "Amplitude",
            "FiveMinutesChangeRate",
            "FiveDayChangeRate",
            "TenDayChangeRate",
            "YtdChangeRate",
            "PeTtmRatio",
            "PbRatio",
            "TotalMarketValue",
        ]
        requested = indexes or default_indexes
        members = {name.lower(): name for name in dir(CalcIndex) if not name.startswith("_")}
        values = []
        names = []
        for raw in requested:
            key = str(raw or "").strip()
            if not key:
                continue
            normalized = key.replace("_", "").replace("-", "").replace(" ", "").lower()
            member_name = members.get(key.lower()) or next(
                (name for lower, name in members.items() if lower.replace("_", "").lower() == normalized),
                None,
            )
            if member_name is None:
                raise ValueError(f"unsupported Longbridge calc index: {key}")
            value = getattr(CalcIndex, member_name)
            values.append(value)
            names.append(member_name)
        if not values:
            raise ValueError("indexes must include at least one Longbridge calc index")
        return values, names

    @staticmethod
    def _parse_date(value: Any) -> Optional[date]:
        if value is None or value == "":
            return None
        if isinstance(value, datetime):
            return value.date()
        if isinstance(value, date):
            return value
        try:
            return date.fromisoformat(str(value)[:10])
        except ValueError as exc:
            raise ValueError("date must use YYYY-MM-DD") from exc

    def _serialize_quote(self, item: Any) -> dict:
        last_done = getattr(item, "last_done", None)
        prev_close = getattr(item, "prev_close", None)
        return {
            "symbol": canonical_symbol(getattr(item, "symbol", "")),
            "timestamp": timestamp(getattr(item, "timestamp", None)),
            "last_done": stringify(last_done),
            "prev_close": stringify(prev_close),
            "open": stringify(getattr(item, "open", None)),
            "high": stringify(getattr(item, "high", None)),
            "low": stringify(getattr(item, "low", None)),
            "volume": stringify(getattr(item, "volume", None)),
            "turnover": stringify(getattr(item, "turnover", None)),
            "trade_status": enum_name(getattr(item, "trade_status", None)),
            "change_value": change_value(last_done, prev_close),
            "change_rate": change_rate(last_done, prev_close),
            "pre_market_quote": self._serialize_prepost_quote(getattr(item, "pre_market_quote", None)),
            "post_market_quote": self._serialize_prepost_quote(getattr(item, "post_market_quote", None)),
            "overnight_quote": self._serialize_prepost_quote(getattr(item, "overnight_quote", None)),
        }

    def _serialize_prepost_quote(self, item: Any) -> Optional[dict]:
        if item is None:
            return None
        last_done = getattr(item, "last_done", None)
        prev_close = getattr(item, "prev_close", None)
        return {
            "timestamp": timestamp(getattr(item, "timestamp", None)),
            "last_done": stringify(last_done),
            "prev_close": stringify(prev_close),
            "high": stringify(getattr(item, "high", None)),
            "low": stringify(getattr(item, "low", None)),
            "volume": stringify(getattr(item, "volume", None)),
            "turnover": stringify(getattr(item, "turnover", None)),
            "change_value": change_value(last_done, prev_close),
            "change_rate": change_rate(last_done, prev_close),
        }

    def _serialize_candlestick(self, item: Any) -> dict:
        return {
            "timestamp": timestamp(getattr(item, "timestamp", None)) or 0,
            "open": stringify(getattr(item, "open", None)) or "0",
            "high": stringify(getattr(item, "high", None)) or "0",
            "low": stringify(getattr(item, "low", None)) or "0",
            "close": stringify(getattr(item, "close", None)) or "0",
            "volume": stringify(getattr(item, "volume", None)) or "0",
            "turnover": stringify(getattr(item, "turnover", None)) or "0",
            "trade_session": enum_name(getattr(item, "trade_session", None)),
        }

    def _serialize_intraday_line(self, item: Any) -> dict:
        return {
            "timestamp": timestamp(getattr(item, "timestamp", None)) or 0,
            "price": stringify(getattr(item, "price", None)) or "0",
            "volume": stringify(getattr(item, "volume", None)) or "0",
            "turnover": stringify(getattr(item, "turnover", None)) or "0",
            "avg_price": stringify(getattr(item, "avg_price", None)) or "0",
        }

    def _serialize_capital_flow_line(self, item: Any) -> dict:
        return {
            "timestamp": timestamp(getattr(item, "timestamp", None)) or 0,
            "inflow": stringify(getattr(item, "inflow", None)) or "0",
        }

    def _serialize_trade(self, item: Any) -> dict:
        return {
            "timestamp": timestamp(getattr(item, "timestamp", None)),
            "price": stringify(getattr(item, "price", None)),
            "volume": stringify(getattr(item, "volume", None)),
            "direction": enum_name(getattr(item, "direction", None)),
            "trade_type": stringify(getattr(item, "trade_type", None)),
            "trade_session": enum_name(getattr(item, "trade_session", None)),
        }

    def _serialize_depth_level(self, item: Any) -> dict:
        return {
            "position": stringify(getattr(item, "position", None)),
            "price": stringify(getattr(item, "price", None)),
            "volume": stringify(getattr(item, "volume", None)),
            "order_num": stringify(getattr(item, "order_num", None)),
        }

    def _serialize_market_time_item(self, item: Any) -> dict:
        return {
            "market": enum_name(getattr(item, "market", None)),
            "trade_status": enum_name(getattr(item, "trade_status", None)),
            "timestamp": timestamp(getattr(item, "timestamp", None)),
            "delay_trade_status": enum_name(getattr(item, "delay_trade_status", None)),
            "delay_timestamp": timestamp(getattr(item, "delay_timestamp", None)),
            "sub_status": stringify(getattr(item, "sub_status", None)),
            "delay_sub_status": stringify(getattr(item, "delay_sub_status", None)),
        }

    def _serialize_calc_index(self, item: Any) -> dict:
        data = {"symbol": canonical_symbol(getattr(item, "symbol", ""))}
        for name in [attr for attr in dir(item) if not attr.startswith("_") and attr != "symbol"]:
            value = getattr(item, name, None)
            if value is not None:
                data[name] = stringify(value)
        return data
