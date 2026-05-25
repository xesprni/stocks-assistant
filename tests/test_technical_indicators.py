import unittest

from app.core.market.technical_indicators import calculate_technical_indicators


def _bars(count: int) -> list[dict]:
    bars = []
    for index in range(count):
        close = 100 + index + (index % 3 - 1) * 0.2
        bars.append(
            {
                "timestamp": index + 1,
                "open": close - 0.5,
                "high": close + 1.0,
                "low": close - 1.0,
                "close": close,
                "volume": 1000 + index * 10,
            }
        )
    return bars


class TechnicalIndicatorsTest(unittest.TestCase):
    def test_calculates_common_indicators_and_limits_series(self):
        bars = _bars(80)

        result = calculate_technical_indicators(
            bars,
            indicators=["vol", "ma", "ema", "macd", "kdj", "rsi", "cci", "wr", "dmi", "osc", "boll", "bbiboll"],
            params={"vol_periods": [5], "ma_periods": [5], "ema_periods": [5], "wr_periods": [10]},
            series_limit=5,
        )

        self.assertEqual(result["bars_count"], 80)
        self.assertEqual(len(result["series_timestamps"]), 5)
        self.assertEqual(result["requested_indicators"][0], "VOL")
        expected_ma5 = sum(float(bar["close"]) for bar in bars[-5:]) / 5
        self.assertEqual(result["latest"]["MA"]["ma5"], round(expected_ma5, 6))
        self.assertIn("ema5", result["latest"]["EMA"])
        self.assertIn("macd", result["latest"]["MACD"])
        self.assertIsNotNone(result["latest"]["KDJ"]["j"])
        self.assertIsNotNone(result["latest"]["RSI"]["rsi6"])
        self.assertIsNotNone(result["latest"]["CCI"]["cci14"])
        self.assertIsNotNone(result["latest"]["WR"]["wr10"])
        self.assertIsNotNone(result["latest"]["DMI"]["adx"])
        self.assertIsNotNone(result["latest"]["OSC"]["osc_pct"])
        self.assertIsNotNone(result["latest"]["BOLL"]["upper"])
        self.assertIsNotNone(result["latest"]["BBIBOLL"]["bbi"])
        self.assertEqual(len(result["series"]["MA"]["ma5"]), 5)

    def test_supports_aliases_and_validates_parameters(self):
        result = calculate_technical_indicators(
            _bars(30),
            indicators=["volume", "bollinger_bands"],
            params={"boll_period": 10, "boll_std": 2.5},
        )

        self.assertEqual(result["requested_indicators"], ["VOL", "BOLL"])
        self.assertEqual(result["params"]["boll_period"], 10)
        self.assertEqual(result["params"]["boll_std"], 2.5)
        with self.assertRaisesRegex(ValueError, "unsupported technical indicator"):
            calculate_technical_indicators(_bars(10), indicators=["DMA"])
        with self.assertRaisesRegex(ValueError, "macd_fast"):
            calculate_technical_indicators(_bars(30), params={"macd_fast": 30, "macd_slow": 20})


if __name__ == "__main__":
    unittest.main()
