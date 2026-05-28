import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from app.core.news.service import (
    GuardianConfigError,
    NewsService,
    normalize_guardian_feed_url,
    normalize_news_symbol,
)


class FakeNewsItem:
    id = 123
    title = "Apple announces product update"
    description = "Short summary"
    url = "https://example.com/news/123"
    published_at = datetime(2026, 5, 21, 12, 0, tzinfo=timezone.utc)
    likes_count = 3
    comments_count = 2
    shares_count = 1


class FakeContentContext:
    def __init__(self):
        self.symbol = ""

    def news(self, symbol):
        self.symbol = symbol
        return [FakeNewsItem()]


class NewsServiceTest(unittest.TestCase):
    def test_normalize_news_symbol(self):
        self.assertEqual(normalize_news_symbol("aapl"), "AAPL.US")
        self.assertEqual(normalize_news_symbol("700"), "700.HK")
        self.assertEqual(normalize_news_symbol("00700"), "700.HK")
        self.assertEqual(normalize_news_symbol("600519"), "600519.SH")
        self.assertEqual(normalize_news_symbol("000001"), "000001.SZ")
        self.assertEqual(normalize_news_symbol("MSFT.US"), "MSFT.US")

    def test_get_security_news_maps_sdk_items(self):
        service = NewsService()
        fake_context = FakeContentContext()
        service._content_context = lambda settings=None: fake_context

        result = service.get_security_news("aapl", limit=10)

        self.assertEqual(result["symbol"], "AAPL.US")
        self.assertEqual(fake_context.symbol, "AAPL.US")
        self.assertEqual(result["total"], 1)
        item = result["news"][0]
        self.assertEqual(item["id"], "123")
        self.assertEqual(item["title"], "Apple announces product update")
        self.assertEqual(item["published_at_ts"], 1779364800)
        self.assertEqual(item["likes_count"], 3)

    def test_normalize_guardian_feed_url(self):
        self.assertEqual(normalize_guardian_feed_url("https://www.theguardian.com/world"), "https://www.theguardian.com/world/rss")
        self.assertEqual(normalize_guardian_feed_url("www.theguardian.com/business/rss"), "https://www.theguardian.com/business/rss")
        self.assertEqual(normalize_guardian_feed_url("https://theguardian.com"), "https://www.theguardian.com/rss")
        with self.assertRaises(ValueError):
            normalize_guardian_feed_url("https://example.com/world")

    def test_get_guardian_feed_parses_rss_items(self):
        service = NewsService()
        service._fetch_guardian_rss = lambda feed_url: """<?xml version="1.0"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>World news</title>
    <item>
      <title>Story title</title>
      <link>https://www.theguardian.com/world/2026/may/28/story</link>
      <guid>world/story</guid>
      <description><![CDATA[<p>Short <b>summary</b></p>]]></description>
      <pubDate>Thu, 28 May 2026 10:15:00 GMT</pubDate>
      <dc:creator>Reporter Name</dc:creator>
      <category>World news</category>
      <category>Europe</category>
    </item>
  </channel>
</rss>"""

        result = service.get_guardian_feed("https://www.theguardian.com/world", limit=10)

        self.assertEqual(result["feed_url"], "https://www.theguardian.com/world/rss")
        self.assertEqual(result["title"], "World news")
        self.assertEqual(result["total"], 1)
        item = result["items"][0]
        self.assertEqual(item["id"], "world/story")
        self.assertEqual(item["description"], "Short summary")
        self.assertEqual(item["author"], "Reporter Name")
        self.assertEqual(item["categories"], ["World news", "Europe"])

    def test_get_guardian_article_requires_api_key(self):
        service = NewsService()
        with self.assertRaises(GuardianConfigError):
            service.get_guardian_article(
                "https://www.theguardian.com/world/2026/may/28/story",
                settings=SimpleNamespace(guardian_api_key=""),
            )

    def test_get_guardian_article_maps_content_api_response(self):
        service = NewsService()

        class FakeResponse:
            status_code = 200

            def raise_for_status(self):
                return None

            def json(self):
                return {
                    "response": {
                        "content": {
                            "id": "world/2026/may/28/story",
                            "webTitle": "Fallback title",
                            "webUrl": "https://www.theguardian.com/world/2026/may/28/story",
                            "apiUrl": "https://content.guardianapis.com/world/2026/may/28/story",
                            "webPublicationDate": "2026-05-28T10:15:00Z",
                            "fields": {
                                "headline": "Guardian headline",
                                "trailText": "<p>Trail text</p>",
                                "byline": "Reporter Name",
                                "thumbnail": "https://media.example/thumb.jpg",
                                "body": "<p>First paragraph.</p><p>Second paragraph.</p>",
                            },
                        }
                    }
                }

        class FakeClient:
            def __init__(self, *args, **kwargs):
                self.args = args
                self.kwargs = kwargs

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return None

            def get(self, url, params=None, headers=None):
                self.url = url
                self.params = params
                return FakeResponse()

        with patch("app.core.news.service.httpx.Client", FakeClient):
            result = service.get_guardian_article(
                "https://www.theguardian.com/world/2026/may/28/story",
                settings=SimpleNamespace(guardian_api_key="guardian-key"),
            )

        self.assertEqual(result["title"], "Guardian headline")
        self.assertEqual(result["api_url"], "https://content.guardianapis.com/world/2026/may/28/story")
        self.assertEqual(result["body_text"], "First paragraph.\n\nSecond paragraph.")
        self.assertEqual(result["author"], "Reporter Name")

    def test_translate_guardian_text_uses_llm_provider(self):
        service = NewsService()

        class FakeProvider:
            model = "test-model"

            def __init__(self):
                self.request = None

            def call(self, request):
                self.request = request
                return {"choices": [{"message": {"content": "翻译后的正文"}}]}

        provider = FakeProvider()
        result = service.translate_guardian_text("Original article", llm_provider=provider)

        self.assertEqual(result["translation"], "翻译后的正文")
        self.assertEqual(result["model"], "test-model")
        self.assertIn("Original article", provider.request.messages[0]["content"])


if __name__ == "__main__":
    unittest.main()
