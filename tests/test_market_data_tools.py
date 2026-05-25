import unittest
from types import SimpleNamespace

from app.core.tools.market_data import (
    GetLongbridgeCandlesticksTool,
    GetLongbridgeDepthTool,
    GetLongbridgeHistoryCandlesticksTool,
    GetLongbridgeIntradayTool,
    GetLongbridgeMarketStatusTool,
    GetLongbridgeQuoteIndicatorsTool,
    GetLongbridgeRealtimeQuotesTool,
    GetLongbridgeTradesTool,
    GetLongbridgeTradingDaysTool,
)
from app.core.tools.tool_manager import ToolManager


class FakeMarketService:
    def __init__(self):
        self.calls = []

    def get_realtime_quotes(self, symbols, settings=None):
        self.calls.append(("get_realtime_quotes", symbols, settings))
        return {"quotes": [{"symbol": symbols[0], "last_done": "10"}], "total": 1}

    def get_candlesticks(self, symbol, period, count=200, adjust_type="forward", trade_sessions=None, settings=None):
        self.calls.append(("get_candlesticks", symbol, period, count, adjust_type, trade_sessions, settings))
        return {"symbol": symbol, "bars": []}

    def get_history_candlesticks(
        self,
        symbol,
        period="1D",
        start=None,
        end=None,
        adjust_type="forward",
        trade_sessions=None,
        settings=None,
    ):
        self.calls.append(("get_history_candlesticks", symbol, period, start, end, adjust_type, trade_sessions, settings))
        return {"symbol": symbol, "bars": []}

    def get_intraday(self, symbol, since=None, trade_sessions=None, settings=None):
        self.calls.append(("get_intraday", symbol, since, trade_sessions, settings))
        return {"symbol": symbol, "bars": []}

    def get_trades(self, symbol, count=50, settings=None):
        self.calls.append(("get_trades", symbol, count, settings))
        return {"symbol": symbol, "trades": []}

    def get_depth(self, symbol, settings=None):
        self.calls.append(("get_depth", symbol, settings))
        return {"symbol": symbol, "bids": [], "asks": []}

    def get_market_status(self, settings=None):
        self.calls.append(("get_market_status", settings))
        return {"market_time": []}

    def get_trading_days(self, market, begin, end, settings=None):
        self.calls.append(("get_trading_days", market, begin, end, settings))
        return {"market": market, "trading_days": []}

    def get_quote_indicators(self, symbols, indexes, settings=None):
        self.calls.append(("get_quote_indicators", symbols, indexes, settings))
        return {"indicators": []}


class MarketDataToolsTest(unittest.TestCase):
    def test_realtime_quotes_accepts_comma_separated_symbols(self):
        service = FakeMarketService()
        settings = SimpleNamespace(longbridge_app_key="demo")
        tool = GetLongbridgeRealtimeQuotesTool(market_service=service, user_id="user-1", settings=settings)

        result = tool.execute({"symbols": "AAPL.US, 700.HK"})

        self.assertEqual(result.status, "success")
        self.assertEqual(service.calls, [("get_realtime_quotes", ["AAPL.US", "700.HK"], settings)])

    def test_tools_validate_required_symbol(self):
        tool = GetLongbridgeDepthTool(market_service=FakeMarketService())

        result = tool.execute({})

        self.assertEqual(result.status, "error")
        self.assertIn("symbol is required", result.result)

    def test_market_data_tools_forward_arguments(self):
        service = FakeMarketService()
        settings = SimpleNamespace(longbridge_app_key="demo")
        cases = [
            (
                GetLongbridgeCandlesticksTool,
                {"symbol": "AAPL.US", "period": "5min", "count": 10, "adjust_type": "none", "trade_sessions": "all"},
                ("get_candlesticks", "AAPL.US", "5min", 10, "none", "all", settings),
            ),
            (
                GetLongbridgeHistoryCandlesticksTool,
                {"symbol": "AAPL.US", "start": "2026-01-01", "end": "2026-01-31"},
                ("get_history_candlesticks", "AAPL.US", "1D", "2026-01-01", "2026-01-31", "forward", None, settings),
            ),
            (
                GetLongbridgeIntradayTool,
                {"symbol": "AAPL.US", "since": 1767330000, "trade_sessions": "intraday"},
                ("get_intraday", "AAPL.US", 1767330000, "intraday", settings),
            ),
            (
                GetLongbridgeTradesTool,
                {"symbol": "AAPL.US", "count": 25},
                ("get_trades", "AAPL.US", 25, settings),
            ),
            (
                GetLongbridgeDepthTool,
                {"symbol": "AAPL.US"},
                ("get_depth", "AAPL.US", settings),
            ),
            (
                GetLongbridgeMarketStatusTool,
                {},
                ("get_market_status", settings),
            ),
            (
                GetLongbridgeTradingDaysTool,
                {"market": "US", "begin": "2026-01-01", "end": "2026-01-31"},
                ("get_trading_days", "US", "2026-01-01", "2026-01-31", settings),
            ),
            (
                GetLongbridgeQuoteIndicatorsTool,
                {"symbols": ["AAPL.US"], "indexes": ["LastDone", "VolumeRatio"]},
                ("get_quote_indicators", ["AAPL.US"], ["LastDone", "VolumeRatio"], settings),
            ),
        ]

        for cls, args, expected in cases:
            tool = cls(market_service=service, settings=settings)
            result = tool.execute(args)
            self.assertEqual(result.status, "success")
            self.assertEqual(service.calls[-1], expected)

    def test_builtin_market_tools_are_registered(self):
        manager = ToolManager()
        original_instantiate = manager._instantiate_tool

        def instantiate_without_scheduler_service(tool_class):
            if getattr(tool_class, "__name__", "") == "SchedulerTool":
                return tool_class()
            return original_instantiate(tool_class)

        manager._instantiate_tool = instantiate_without_scheduler_service
        manager.load_builtin_tools()

        names = set(manager.tool_classes)

        self.assertIn("get_longbridge_realtime_quotes", names)
        self.assertIn("get_longbridge_history_candlesticks", names)
        self.assertIn("get_longbridge_quote_indicators", names)


if __name__ == "__main__":
    unittest.main()
