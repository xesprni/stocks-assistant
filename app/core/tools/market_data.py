"""Read-only Longbridge market data tools."""

from __future__ import annotations

from typing import Any, Dict, Optional

from app.core.tools.base_tool import BaseTool, ToolResult
from app.core.watchlist.service import LongbridgeUnavailableError


def _string_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [str(value).strip()] if str(value).strip() else []


def _int_arg(value: Any, default: Optional[int], name: str) -> Optional[int]:
    if value is None or value == "":
        return default
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be an integer") from exc


class _LongbridgeMarketTool(BaseTool):
    def __init__(self, market_service: Any = None, user_id: Optional[str] = None, settings: Any = None):
        self.market_service = market_service
        self.user_id = user_id
        self.settings = settings

    def _get_market_service(self):
        if self.market_service is not None:
            return self.market_service
        try:
            from app.deps import get_market_service

            return get_market_service()
        except Exception:
            return None

    def _call(self, func_name: str, *args, **kwargs) -> ToolResult:
        service = self._get_market_service()
        if service is None:
            return ToolResult.fail("Market service not initialized")
        try:
            data = getattr(service, func_name)(*args, settings=self.settings, **kwargs)
        except (ValueError, LongbridgeUnavailableError) as exc:
            return ToolResult.fail(str(exc))
        return ToolResult.success(data)


class GetLongbridgeRealtimeQuotesTool(_LongbridgeMarketTool):
    name = "get_longbridge_realtime_quotes"
    description = (
        "查询 Longbridge 证券实时报价时使用此工具。Use for current price, quote, open/high/low, "
        "volume, turnover, change, pre/post/overnight quote, or 实时行情. Symbols use Longbridge "
        "format such as AAPL.US, TSLA.US, 700.HK, 600519.SH."
    )
    params = {
        "type": "object",
        "properties": {
            "symbols": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Longbridge symbols, e.g. ['AAPL.US', '700.HK']. A comma-separated string is also accepted.",
            },
        },
        "required": ["symbols"],
    }

    def execute(self, args: Dict[str, Any]) -> ToolResult:
        symbols = _string_list(args.get("symbols") or args.get("symbol"))
        if not symbols:
            return ToolResult.fail("symbols is required")
        return self._call("get_realtime_quotes", symbols)


class GetLongbridgeCandlesticksTool(_LongbridgeMarketTool):
    name = "get_longbridge_candlesticks"
    description = (
        "查询 Longbridge 近期 K 线/蜡烛图数据时使用此工具。Use for daily/weekly/monthly or minute "
        "candlesticks, OHLCV, recent price history, K线. For one-minute bars use 1min; 1M means monthly."
    )
    params = {
        "type": "object",
        "properties": {
            "symbol": {"type": "string", "description": "Longbridge symbol, e.g. AAPL.US, 700.HK."},
            "period": {
                "type": "string",
                "description": "K-line period: 1D, 1W, 1M, 1Y, 1min, 5min, 15min, 30min, 60min.",
                "default": "1D",
            },
            "count": {"type": "integer", "description": "Number of bars, capped at 1000.", "default": 200},
            "adjust_type": {
                "type": "string",
                "enum": ["forward", "none"],
                "description": "Forward-adjusted or raw prices. Default: forward.",
                "default": "forward",
            },
            "trade_sessions": {
                "type": "string",
                "enum": ["intraday", "all"],
                "description": "Use all to include extended sessions where supported.",
            },
        },
        "required": ["symbol"],
    }

    def execute(self, args: Dict[str, Any]) -> ToolResult:
        symbol = str(args.get("symbol") or "").strip()
        if not symbol:
            return ToolResult.fail("symbol is required")
        try:
            count = _int_arg(args.get("count"), 200, "count")
        except ValueError as exc:
            return ToolResult.fail(str(exc))
        return self._call(
            "get_candlesticks",
            symbol,
            str(args.get("period") or "1D"),
            count,
            adjust_type=str(args.get("adjust_type") or "forward"),
            trade_sessions=args.get("trade_sessions"),
        )


class GetLongbridgeHistoryCandlesticksTool(_LongbridgeMarketTool):
    name = "get_longbridge_history_candlesticks"
    description = (
        "按日期区间查询 Longbridge 历史行情/K 线时使用此工具。Use when the user asks for historical "
        "quotes over a specific date range, 历史行情, historical K-line, or past OHLCV data."
    )
    params = {
        "type": "object",
        "properties": {
            "symbol": {"type": "string", "description": "Longbridge symbol, e.g. AAPL.US, 700.HK."},
            "period": {"type": "string", "description": "1D, 1W, 1M, 1Y, 1min, 5min, etc.", "default": "1D"},
            "start": {"type": "string", "description": "Start date in YYYY-MM-DD."},
            "end": {"type": "string", "description": "End date in YYYY-MM-DD."},
            "adjust_type": {"type": "string", "enum": ["forward", "none"], "default": "forward"},
            "trade_sessions": {"type": "string", "enum": ["intraday", "all"]},
        },
        "required": ["symbol"],
    }

    def execute(self, args: Dict[str, Any]) -> ToolResult:
        symbol = str(args.get("symbol") or "").strip()
        if not symbol:
            return ToolResult.fail("symbol is required")
        return self._call(
            "get_history_candlesticks",
            symbol,
            period=str(args.get("period") or "1D"),
            start=args.get("start"),
            end=args.get("end"),
            adjust_type=str(args.get("adjust_type") or "forward"),
            trade_sessions=args.get("trade_sessions"),
        )


class GetLongbridgeIntradayTool(_LongbridgeMarketTool):
    name = "get_longbridge_intraday"
    description = "查询 Longbridge 当日盘中分时行情时使用此工具。Use for intraday lines, 分时图, 盘中价格/成交量."
    params = {
        "type": "object",
        "properties": {
            "symbol": {"type": "string", "description": "Longbridge symbol, e.g. AAPL.US, 700.HK."},
            "since": {"type": "integer", "description": "Optional Unix timestamp; return data at or after this time."},
            "trade_sessions": {"type": "string", "enum": ["intraday", "all"]},
        },
        "required": ["symbol"],
    }

    def execute(self, args: Dict[str, Any]) -> ToolResult:
        symbol = str(args.get("symbol") or "").strip()
        if not symbol:
            return ToolResult.fail("symbol is required")
        try:
            since = _int_arg(args.get("since"), None, "since")
        except ValueError as exc:
            return ToolResult.fail(str(exc))
        return self._call(
            "get_intraday",
            symbol,
            since=since,
            trade_sessions=args.get("trade_sessions"),
        )


class GetLongbridgeTradesTool(_LongbridgeMarketTool):
    name = "get_longbridge_trades"
    description = "查询 Longbridge 逐笔成交明细时使用此工具。Use for time-and-sales, prints, tick trades, 逐笔成交."
    params = {
        "type": "object",
        "properties": {
            "symbol": {"type": "string", "description": "Longbridge symbol, e.g. AAPL.US, 700.HK."},
            "count": {"type": "integer", "description": "Number of trades, capped at 500.", "default": 50},
        },
        "required": ["symbol"],
    }

    def execute(self, args: Dict[str, Any]) -> ToolResult:
        symbol = str(args.get("symbol") or "").strip()
        if not symbol:
            return ToolResult.fail("symbol is required")
        try:
            count = _int_arg(args.get("count"), 50, "count")
        except ValueError as exc:
            return ToolResult.fail(str(exc))
        return self._call("get_trades", symbol, count=count)


class GetLongbridgeDepthTool(_LongbridgeMarketTool):
    name = "get_longbridge_depth"
    description = "查询 Longbridge 买卖盘口/深度报价时使用此工具。Use for order book, bid/ask depth, 盘口, 买卖盘."
    params = {
        "type": "object",
        "properties": {
            "symbol": {"type": "string", "description": "Longbridge symbol, e.g. AAPL.US, 700.HK."},
        },
        "required": ["symbol"],
    }

    def execute(self, args: Dict[str, Any]) -> ToolResult:
        symbol = str(args.get("symbol") or "").strip()
        if not symbol:
            return ToolResult.fail("symbol is required")
        return self._call("get_depth", symbol)


class GetLongbridgeMarketStatusTool(_LongbridgeMarketTool):
    name = "get_longbridge_market_status"
    description = "查询 Longbridge 各市场当前交易状态时使用此工具。Use for market open/closed/pre-market status, 市场状态."
    params = {"type": "object", "properties": {}}

    def execute(self, args: Dict[str, Any]) -> ToolResult:
        return self._call("get_market_status")


class GetLongbridgeTradingDaysTool(_LongbridgeMarketTool):
    name = "get_longbridge_trading_days"
    description = "查询 Longbridge 市场交易日历时使用此工具。Use for trading days, holidays, half trading days, 交易日."
    params = {
        "type": "object",
        "properties": {
            "market": {"type": "string", "enum": ["US", "HK", "CN", "SG"], "description": "Market code.", "default": "US"},
            "begin": {"type": "string", "description": "Begin date in YYYY-MM-DD."},
            "end": {"type": "string", "description": "End date in YYYY-MM-DD."},
        },
        "required": ["market", "begin", "end"],
    }

    def execute(self, args: Dict[str, Any]) -> ToolResult:
        return self._call(
            "get_trading_days",
            str(args.get("market") or "US"),
            str(args.get("begin") or ""),
            str(args.get("end") or ""),
        )


class GetLongbridgeQuoteIndicatorsTool(_LongbridgeMarketTool):
    name = "get_longbridge_quote_indicators"
    description = (
        "查询 Longbridge Quotes calc_indexes 支持的证券计算指标时使用此工具。Use for quote indicators "
        "such as turnover rate, volume ratio, amplitude, short-term change rates, PE/PB, market value, 技术/行情指标."
    )
    params = {
        "type": "object",
        "properties": {
            "symbols": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Longbridge symbols, e.g. ['AAPL.US', '700.HK']. A comma-separated string is also accepted.",
            },
            "indexes": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "Optional Longbridge CalcIndex names. Examples: LastDone, ChangeRate, VolumeRatio, "
                    "TurnoverRate, Amplitude, FiveDayChangeRate, TenDayChangeRate, PeTtmRatio, PbRatio."
                ),
            },
        },
        "required": ["symbols"],
    }

    def execute(self, args: Dict[str, Any]) -> ToolResult:
        symbols = _string_list(args.get("symbols") or args.get("symbol"))
        if not symbols:
            return ToolResult.fail("symbols is required")
        indexes = _string_list(args.get("indexes"))
        return self._call("get_quote_indicators", symbols, indexes)
