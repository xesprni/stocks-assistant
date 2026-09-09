import os
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.core.market import longbridge_context
from app.core.watchlist.service import LongbridgeUnavailableError


class SlowFakeContext:
    created = 0
    closed = 0
    counter_lock = threading.Lock()

    def __init__(self, _config):
        self.config = _config
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
            ThreadPoolExecutor(max_workers=8) as executor,
        ):
            contexts = list(
                executor.map(
                    lambda _: longbridge_context.get_cached_context("QuoteContext", self.settings),
                    range(8),
                )
            )

        self.assertEqual(1, SlowFakeContext.created)
        self.assertTrue(all(context is contexts[0] for context in contexts))

    def test_quote_context_is_shared_across_user_languages(self):
        english = SimpleNamespace(**vars(self.settings), app_language="en")
        chinese = SimpleNamespace(**vars(self.settings), app_language="zh")
        with (
            patch.object(longbridge_context, "longbridge_config", return_value=object()) as config,
            patch("longbridge.openapi.QuoteContext", SlowFakeContext),
            ThreadPoolExecutor(max_workers=8) as executor,
        ):
            contexts = list(
                executor.map(
                    lambda settings: longbridge_context.get_cached_context(
                        "QuoteContext", settings
                    ),
                    [english, chinese] * 4,
                )
            )

        self.assertEqual(1, SlowFakeContext.created)
        self.assertTrue(all(context is contexts[0] for context in contexts))
        self.assertEqual(1, config.call_count)
        self.assertEqual({"localize": False}, config.call_args.kwargs)
        self.assertEqual(
            longbridge_context.credential_signature(english),
            longbridge_context.credential_signature(chinese),
        )

    def test_http_contexts_are_isolated_by_language_and_reused(self):
        english = SimpleNamespace(**vars(self.settings), app_language="en")
        chinese = SimpleNamespace(**vars(self.settings), app_language="zh")
        with (
            patch.object(longbridge_context, "longbridge_config", return_value=object()) as config,
            patch.multiple(
                "longbridge.openapi",
                MarketContext=SlowFakeContext,
                FundamentalContext=SlowFakeContext,
                ContentContext=SlowFakeContext,
            ),
        ):
            for context_type in ("MarketContext", "FundamentalContext", "ContentContext"):
                with self.subTest(context_type=context_type):
                    with ThreadPoolExecutor(max_workers=8) as executor:
                        contexts = list(
                            executor.map(
                                lambda settings, context_type=context_type: (
                                    longbridge_context.get_cached_context(context_type, settings)
                                ),
                                [english, chinese] * 4,
                            )
                        )

                    self.assertIsNot(contexts[0], contexts[1])
                    self.assertTrue(all(context is contexts[0] for context in contexts[::2]))
                    self.assertTrue(all(context is contexts[1] for context in contexts[1::2]))
                    self.assertIs(
                        contexts[1],
                        longbridge_context.get_cached_context(context_type, self.settings),
                    )

        self.assertEqual(6, SlowFakeContext.created)
        self.assertEqual(6, config.call_count)
        self.assertTrue(all(call.kwargs == {"localize": True} for call in config.call_args_list))


class LongbridgeContentLanguageTest(unittest.TestCase):
    def setUp(self):
        self.settings = SimpleNamespace(
            longbridge_app_key="key",
            longbridge_app_secret="secret",
            longbridge_access_token="token",
            longbridge_http_url="https://example.test/api",
            longbridge_quote_ws_url="wss://example.test/quotes",
        )

    def test_explicit_user_language_overrides_environment_language(self):
        from longbridge.openapi import Language

        for app_language, expected in (("zh", Language.ZH_CN), ("en", Language.EN)):
            with (
                self.subTest(app_language=app_language),
                patch.dict(os.environ, {"LONGBRIDGE_LANGUAGE": "zh-HK"}),
                patch("longbridge.openapi.Config") as config,
            ):
                settings = SimpleNamespace(**vars(self.settings), app_language=app_language)
                longbridge_context.longbridge_config(settings)

                config.from_apikey.assert_called_once_with(
                    "key",
                    "secret",
                    "token",
                    http_url="https://example.test/api",
                    quote_ws_url="wss://example.test/quotes",
                    language=expected,
                )
                config.from_apikey_env.assert_not_called()
                self.assertEqual("zh-HK", os.environ["LONGBRIDGE_LANGUAGE"])

    def test_missing_or_unknown_app_language_defaults_to_chinese(self):
        from longbridge.openapi import Language

        with patch("longbridge.openapi.Config") as config:
            longbridge_context.longbridge_config(self.settings)
        self.assertEqual(Language.ZH_CN, config.from_apikey.call_args.kwargs["language"])
        self.assertEqual(
            "zh", longbridge_context.content_language(SimpleNamespace(app_language="invalid"))
        )
        self.assertEqual(
            "en", longbridge_context.content_language(SimpleNamespace(app_language=" EN-US "))
        )

    def test_quote_configuration_keeps_sdk_language_default(self):
        with patch("longbridge.openapi.Config") as config:
            longbridge_context.longbridge_config(self.settings, localize=False)
        self.assertNotIn("language", config.from_apikey.call_args.kwargs)

    def test_environment_credentials_follow_app_language_without_mutation(self):
        from longbridge.openapi import Language

        settings = SimpleNamespace(
            **{
                **vars(self.settings),
                "longbridge_app_key": "",
                "longbridge_app_secret": "",
                "longbridge_access_token": "",
                "app_language": "en",
            }
        )
        environment = {
            "LONGBRIDGE_APP_KEY": "env-key",
            "LONGBRIDGE_APP_SECRET": "env-secret",
            "LONGBRIDGE_ACCESS_TOKEN": "env-token",
            "LONGBRIDGE_LANGUAGE": "zh-CN",
            "LONGBRIDGE_ENABLE_OVERNIGHT": "true",
        }
        with (
            patch.dict(os.environ, environment, clear=True),
            patch("dotenv.find_dotenv", return_value=""),
            patch("longbridge.openapi.Config") as config,
        ):
            longbridge_context.longbridge_config(settings)

            config.from_apikey_env.assert_called_once_with()
            config.from_apikey.assert_called_once_with(
                "env-key",
                "env-secret",
                "env-token",
                language=Language.EN,
            )
            # 先走 SDK 原生初始化保留可选环境参数，再只覆盖这次请求的内容语言。
            self.assertEqual("from_apikey_env", config.mock_calls[0][0])
            self.assertEqual(environment, dict(os.environ))

    def test_dotenv_credentials_keep_aliases_and_environment_precedence(self):
        from longbridge.openapi import Language

        settings = SimpleNamespace(
            **{
                **vars(self.settings),
                "longbridge_app_key": "",
                "longbridge_app_secret": "",
                "longbridge_access_token": "",
            }
        )
        environment = {
            "LONGBRIDGE_ACCESS_TOKEN": "process-token",
            "LONGBRIDGE_LANGUAGE": "en",
        }
        with tempfile.TemporaryDirectory() as directory:
            dotenv_path = Path(directory) / ".env"
            dotenv_path.write_text(
                "LONGPORT_APP_KEY=dotenv-key\n"
                "LONGPORT_APP_SECRET=dotenv-secret\n"
                "LONGBRIDGE_ACCESS_TOKEN=dotenv-token\n"
                "LONGBRIDGE_HTTP_URL=https://example.test/dotenv\n"
                "LONGBRIDGE_PRINT_QUOTE_PACKAGES=false\n",
                encoding="utf-8",
            )
            with (
                patch.dict(os.environ, environment, clear=True),
                patch("dotenv.find_dotenv", return_value=str(dotenv_path)) as find_dotenv,
                patch("longbridge.openapi.Config") as config,
            ):
                longbridge_context.longbridge_config(settings)

                find_dotenv.assert_called_once_with(usecwd=True)
                config.from_apikey_env.assert_called_once_with()
                config.from_apikey.assert_called_once_with(
                    "dotenv-key",
                    "dotenv-secret",
                    "process-token",
                    language=Language.ZH_CN,
                )
                self.assertEqual(environment, dict(os.environ))

    def test_quote_environment_config_is_returned_unchanged(self):
        settings = SimpleNamespace(**{**vars(self.settings), "longbridge_app_key": ""})
        with patch("longbridge.openapi.Config") as config:
            actual = longbridge_context.longbridge_config(settings, localize=False)
        self.assertIs(config.from_apikey_env.return_value, actual)
        config.from_apikey.assert_not_called()

    def test_missing_environment_credentials_remain_actionable(self):
        settings = SimpleNamespace(**{**vars(self.settings), "longbridge_app_key": ""})
        config = MagicMock()
        config.from_apikey_env.side_effect = ValueError("missing credential")
        with (
            patch("longbridge.openapi.Config", config),
            self.assertRaisesRegex(LongbridgeUnavailableError, "credentials are not configured"),
        ):
            longbridge_context.longbridge_config(settings)


if __name__ == "__main__":
    unittest.main()
