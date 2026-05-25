import unittest
from datetime import datetime, timezone

from app.core.news.service import NewsService, normalize_news_symbol


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


if __name__ == "__main__":
    unittest.main()
