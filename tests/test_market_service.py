import json
import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path
from types import SimpleNamespace

from app.core.market.service import MarketService


class FakeQuoteContext:
    def __init__(self):
        self.requested_symbols = []
        self.candlestick_args = None
        self.history_args = None
        self.intraday_args = None
        self.capital_flow_symbol = None
        self.trades_args = None
        self.depth_symbol = None
        self.trading_days_args = None
        self.calc_indexes_args = None

    def quote(self, symbols):
        self.requested_symbols = symbols
        return [
            SimpleNamespace(
                symbol="HSI.HK",
                timestamp=datetime(2026, 1, 2, 9, 30),
                last_done="10",
                prev_close="8",
                open=None,
                high=None,
                low=None,
                volume=None,
                turnover=None,
                trade_status="TradeStatus.Normal",
                pre_market_quote=SimpleNamespace(
                    timestamp=datetime(2026, 1, 2, 9, 0),
                    last_done="9",
                    prev_close="8",
                    high="9.2",
                    low="8.9",
                    volume="100",
                    turnover="900",
                ),
                post_market_quote=None,
                overnight_quote=None,
            )
        ]

    def candlesticks(self, symbol, period, count, adjust_type, *args):
        self.candlestick_args = (symbol, str(period), count, str(adjust_type), [str(arg) for arg in args])
        return [
            SimpleNamespace(
                timestamp=datetime(2026, 1, 2, 9, 30),
                open=str(10 + index),
                high=str(12 + index),
                low=str(9 + index),
                close=str(11 + index),
                volume=str(1000 + index),
                turnover=str(11000 + index),
                trade_session="TradeSession.Intraday",
            )
            for index in range(max(1, min(count, 80)))
        ]

    def history_candlesticks_by_date(self, symbol, period, adjust_type, start, end, *args):
        self.history_args = (symbol, str(period), str(adjust_type), start, end, [str(arg) for arg in args])
        return [
            SimpleNamespace(
                timestamp=datetime(2026, 1, 1),
                open="8",
                high="11",
                low="7",
                close="10",
                volume="900",
                turnover="9000",
            )
        ]

    def intraday(self, symbol, *args):
        self.intraday_args = (symbol, [str(arg) for arg in args])
        return [
            SimpleNamespace(timestamp=datetime(2026, 1, 2, 9, 30), price="10", volume="100", turnover="1000", avg_price="10"),
            SimpleNamespace(timestamp=datetime(2026, 1, 2, 9, 31), price="11", volume="200", turnover="2200", avg_price="10.5"),
        ]

    def capital_flow(self, symbol):
        self.capital_flow_symbol = symbol
        return [
            SimpleNamespace(timestamp=datetime(2026, 1, 2, 9, 31), inflow="-2000"),
            SimpleNamespace(timestamp=datetime(2026, 1, 2, 9, 30), inflow="1000"),
        ]

    def trades(self, symbol, count):
        self.trades_args = (symbol, count)
        return [
            SimpleNamespace(
                timestamp=datetime(2026, 1, 2, 9, 31),
                price="11",
                volume="200",
                direction="TradeDirection.Up",
                trade_type="odd_lot",
                trade_session="TradeSession.Intraday",
            )
        ]

    def depth(self, symbol):
        self.depth_symbol = symbol
        return SimpleNamespace(
            bids=[SimpleNamespace(position=1, price="10.9", volume="100", order_num=2)],
            asks=[SimpleNamespace(position=1, price="11.1", volume="120", order_num=3)],
        )

    def trading_days(self, market, begin, end):
        self.trading_days_args = (str(market), begin, end)
        return SimpleNamespace(trading_days=[date(2026, 1, 2)], half_trading_days=[date(2026, 1, 5)])

    def calc_indexes(self, symbols, indexes):
        self.calc_indexes_args = (symbols, [str(index) for index in indexes])
        return [SimpleNamespace(symbol="HSI.HK", last_done="10", change_rate="2.5", pe_ttm_ratio=None)]


class FakeMarketContext:
    def market_status(self):
        return SimpleNamespace(
            market_time=[
                SimpleNamespace(
                    market="Market.US",
                    trade_status="TradeStatus.Normal",
                    timestamp=datetime(2026, 1, 2, 9, 30),
                    delay_trade_status="TradeStatus.Normal",
                    delay_timestamp=datetime(2026, 1, 2, 9, 29),
                    sub_status="subscribed",
                    delay_sub_status="delayed",
                )
            ]
        )


class TestableMarketService(MarketService):
    def __init__(self, workspace_dir: str, quote_context: FakeQuoteContext, market_context=None):
        super().__init__(workspace_dir)
        self.fake_quote_context = quote_context
        self.fake_market_context = market_context or FakeMarketContext()

    def _quote_context(self, settings=None):
        return self.fake_quote_context

    def _market_context(self, settings=None):
        return self.fake_market_context


class MarketServiceConfigTest(unittest.TestCase):
    def test_get_config_normalizes_legacy_hk_index_symbols(self):
        with tempfile.TemporaryDirectory() as tmp:
            config_path = Path(tmp) / "market_config.json"
            config_path.write_text(
                json.dumps(
                    {
                        "indices": [
                            {"symbol": ".HSI.HK", "name": "恒生指数", "enabled": True},
                            {"symbol": ".HSCEI.HK", "name": "国企指数", "enabled": True},
                            {"symbol": ".HSTECH.HK", "name": "恒生科技指数", "enabled": True},
                        ],
                        "refresh_interval": 30,
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            config = MarketService(tmp).get_config()

        self.assertEqual(
            [index["symbol"] for index in config["indices"]],
            ["HSI.HK", "HSCEI.HK", "HSTECH.HK"],
        )
        self.assertEqual(config["refresh_interval"], 30)

    def test_save_config_persists_normalized_symbols(self):
        with tempfile.TemporaryDirectory() as tmp:
            service = MarketService(tmp)

            saved = service.save_config(
                {
                    "indices": [
                        {"symbol": ".HSI.HK", "name": "恒生指数", "enabled": True},
                        {"symbol": "hsi.hk", "name": "重复旧配置", "enabled": True},
                    ],
                    "refresh_interval": 45,
                }
            )

            stored = json.loads(service.config_path.read_text(encoding="utf-8"))

        self.assertEqual(saved["indices"], [{"symbol": "HSI.HK", "name": "恒生指数", "enabled": True}])
        self.assertEqual(stored, saved)

    def test_fetch_quotes_normalizes_legacy_symbols_and_metadata_maps(self):
        with tempfile.TemporaryDirectory() as tmp:
            quote_context = FakeQuoteContext()
            service = TestableMarketService(tmp, quote_context)

            quotes = service._fetch_quotes(
                [".HSI.HK", "HSI.HK"],
                name_map={".HSI.HK": "恒生指数"},
                category_map={".HSI.HK": "HK"},
            )

        self.assertEqual(quote_context.requested_symbols, ["HSI.HK"])
        self.assertEqual(quotes[0]["symbol"], "HSI.HK")
        self.assertEqual(quotes[0]["name"], "恒生指数")
        self.assertEqual(quotes[0]["category"], "HK")
        self.assertEqual(quotes[0]["change_rate"], "25.00%")

    def test_realtime_quotes_return_richer_longbridge_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            quote_context = FakeQuoteContext()
            service = TestableMarketService(tmp, quote_context)

            payload = service.get_realtime_quotes([".HSI.HK", "HSI.HK"])

        self.assertEqual(quote_context.requested_symbols, ["HSI.HK"])
        self.assertEqual(payload["source"], "Longbridge QuoteContext.quote")
        self.assertEqual(payload["total"], 1)
        quote = payload["quotes"][0]
        self.assertEqual(quote["symbol"], "HSI.HK")
        self.assertEqual(quote["trade_status"], "Normal")
        self.assertEqual(quote["pre_market_quote"]["change_rate"], "12.50%")

    def test_candlesticks_supports_minute_period_adjust_and_sessions(self):
        with tempfile.TemporaryDirectory() as tmp:
            quote_context = FakeQuoteContext()
            service = TestableMarketService(tmp, quote_context)

            payload = service.get_candlesticks("hsi.hk", "5min", count=1200, adjust_type="none", trade_sessions="all")

        self.assertEqual(quote_context.candlestick_args[0], "HSI.HK")
        self.assertEqual(quote_context.candlestick_args[1], "Period.Min_5")
        self.assertEqual(quote_context.candlestick_args[2], 1000)
        self.assertEqual(quote_context.candlestick_args[3], "AdjustType.NoAdjust")
        self.assertEqual(quote_context.candlestick_args[4], ["TradeSessions.All"])
        self.assertEqual(payload["bars"][0]["trade_session"], "Intraday")

    def test_technical_indicators_calculate_from_longbridge_candlesticks(self):
        with tempfile.TemporaryDirectory() as tmp:
            quote_context = FakeQuoteContext()
            service = TestableMarketService(tmp, quote_context)

            payload = service.get_technical_indicators(
                "hsi.hk",
                "1D",
                count=60,
                indicators=["MA", "MACD"],
                params={"ma_periods": [5]},
                series_limit=3,
            )

        self.assertEqual(quote_context.candlestick_args[0], "HSI.HK")
        self.assertEqual(payload["symbol"], "HSI.HK")
        self.assertEqual(payload["requested_indicators"], ["MA", "MACD"])
        self.assertEqual(payload["bars_count"], 60)
        self.assertEqual(len(payload["series_timestamps"]), 3)
        self.assertEqual(payload["latest"]["MA"]["ma5"], 68.0)

    def test_history_trades_depth_trading_days_status_and_indicators(self):
        with tempfile.TemporaryDirectory() as tmp:
            quote_context = FakeQuoteContext()
            service = TestableMarketService(tmp, quote_context)

            history = service.get_history_candlesticks("HSI.HK", start="2026-01-01", end="2026-01-31")
            trades = service.get_trades("HSI.HK", count=999)
            depth = service.get_depth("HSI.HK")
            days = service.get_trading_days("US", "2026-01-01", "2026-01-31")
            status = service.get_market_status()
            indicators = service.get_quote_indicators(["HSI.HK"], ["LastDone", "pe_ttm_ratio"])
            capital_flow = service.get_capital_flow(".HSI.HK")

        self.assertEqual(quote_context.history_args[3], date(2026, 1, 1))
        self.assertEqual(history["bars"][0]["close"], "10")
        self.assertEqual(quote_context.trades_args, ("HSI.HK", 500))
        self.assertEqual(trades["trades"][0]["direction"], "Up")
        self.assertEqual(depth["bids"][0]["price"], "10.9")
        self.assertEqual(quote_context.trading_days_args[0], "Market.US")
        self.assertEqual(days["trading_days"], ["2026-01-02"])
        self.assertEqual(status["market_time"][0]["market"], "US")
        self.assertEqual(quote_context.calc_indexes_args[1], ["CalcIndex.LastDone", "CalcIndex.PeTtmRatio"])
        self.assertEqual(indicators["indicators"][0]["last_done"], "10")
        self.assertEqual(quote_context.capital_flow_symbol, "HSI.HK")
        self.assertEqual(capital_flow["source"], "Longbridge QuoteContext.capital_flow")
        self.assertEqual(capital_flow["total"], 2)
        self.assertEqual([line["inflow"] for line in capital_flow["lines"]], ["1000", "-2000"])


if __name__ == "__main__":
    unittest.main()
