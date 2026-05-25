import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from app.core.market.service import MarketService


class FakeQuoteContext:
    def __init__(self):
        self.requested_symbols = []

    def quote(self, symbols):
        self.requested_symbols = symbols
        return [
            SimpleNamespace(
                symbol="HSI.HK",
                last_done="10",
                prev_close="8",
                open=None,
                high=None,
                low=None,
                volume=None,
                turnover=None,
            )
        ]


class TestableMarketService(MarketService):
    def __init__(self, workspace_dir: str, quote_context: FakeQuoteContext):
        super().__init__(workspace_dir)
        self.fake_quote_context = quote_context

    def _quote_context(self, settings=None):
        return self.fake_quote_context


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


if __name__ == "__main__":
    unittest.main()
