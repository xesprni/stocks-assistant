import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import patch

from app.core.market import longbridge_context


class SlowFakeContext:
    created = 0
    closed = 0
    counter_lock = threading.Lock()

    def __init__(self, _config):
        with self.counter_lock:
            type(self).created += 1
        # 放大并发 cache miss 的窗口，确保回归测试能稳定覆盖竞态。
        time.sleep(0.03)

    def close(self):
        with self.counter_lock:
            type(self).closed += 1


class LongbridgeContextCacheTest(unittest.TestCase):
    def setUp(self):
        longbridge_context.clear_context_cache()
        SlowFakeContext.created = 0
        SlowFakeContext.closed = 0
        self.settings = SimpleNamespace(
            longbridge_app_key="key",
            longbridge_app_secret="secret",
            longbridge_access_token="token",
            longbridge_http_url="",
            longbridge_quote_ws_url="",
        )

    def tearDown(self):
        longbridge_context.clear_context_cache()

    def test_concurrent_cache_miss_creates_one_context(self):
        with (
            patch.object(longbridge_context, "longbridge_config", return_value=object()),
            patch.multiple(
                "longbridge.openapi",
                QuoteContext=SlowFakeContext,
                MarketContext=SlowFakeContext,
                FundamentalContext=SlowFakeContext,
                ContentContext=SlowFakeContext,
            ),
        ):
            with ThreadPoolExecutor(max_workers=8) as executor:
                contexts = list(
                    executor.map(
                        lambda _: longbridge_context.get_cached_context("QuoteContext", self.settings),
                        range(8),
                    )
                )

        self.assertEqual(1, SlowFakeContext.created)
        self.assertTrue(all(context is contexts[0] for context in contexts))


if __name__ == "__main__":
    unittest.main()
