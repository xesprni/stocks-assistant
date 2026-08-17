import asyncio
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from pydantic import ValidationError

from app.api.config import _readiness_checks
from app.config import Settings
from app.core.memory.config import MemoryConfig
from app.core.memory.manager import MemoryManager
from app.core.tools.knowledge_get import KnowledgeGetTool
from app.core.tools.knowledge_search import KnowledgeSearchTool
from app.core.tools.research_data import GetSecurityInsightsTool, GetSecurityNewsTool
from app.core.tools.web_search import WebSearchTool
from app.core.watchlist.service import WatchlistService
from app.core.portfolio.service import PortfolioService
from app.schemas.telemetry import ProductEventRequest


class _SearchResponse:
    status_code = 200

    def raise_for_status(self):
        return None

    def json(self):
        return {
            "data": {
                "webPages": {
                    "value": [
                        {
                            "name": "Example filing",
                            "url": "https://example.com/filing",
                            "snippet": "Revenue grew 12 percent.",
                        }
                    ]
                }
            }
        }


class Phase0EvidenceTest(unittest.TestCase):
    @mock.patch("app.core.tools.web_search.httpx.post", return_value=_SearchResponse())
    def test_web_search_returns_resolvable_evidence(self, post):
        tool = WebSearchTool(config={"api_url": "https://search.test/v1", "api_key": "secret"})

        result = tool.execute({"query": "example filing", "count": 1})

        self.assertEqual("success", result.status)
        self.assertEqual("https://example.com/filing", result.result["results"][0]["url"])
        self.assertTrue(result.result["fetched_at"])
        self.assertEqual("https://example.com/filing", result.ext_data["sources"][0]["url"])
        self.assertTrue(result.ext_data["sources"][0]["fetched_at"])
        post.assert_called_once()

    def test_longbridge_research_tools_return_source_and_symbol(self):
        news_service = SimpleNamespace(
            get_security_news=lambda symbol, limit, settings: {
                "symbol": symbol,
                "news": [{"title": "Result", "published_at": "2026-08-17T01:00:00Z"}],
                "total": 1,
            }
        )
        insight_service = SimpleNamespace(
            get_security_insights=lambda symbol, settings: {"symbol": symbol, "valuation": {"items": []}}
        )

        news = GetSecurityNewsTool(service=news_service).execute({"symbol": "aapl.us"})
        insights = GetSecurityInsightsTool(service=insight_service).execute({"symbol": "aapl.us"})

        for result in (news, insights):
            self.assertEqual("success", result.status)
            source = result.ext_data["sources"][0]
            self.assertEqual("AAPL.US", source["symbol"])
            self.assertEqual("Longbridge OpenAPI", source["provider"])
            self.assertTrue(source["fetched_at"])
            self.assertTrue(source["url"].startswith("https://"))


class Phase0KnowledgeRagTest(unittest.TestCase):
    def test_imported_user_knowledge_is_searchable_and_citable(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(
            os.environ,
            {"OPENAI_API_KEY": "", "EMBEDDING_API_KEY": ""},
        ):
            workspace = Path(tmp)
            knowledge_file = workspace / "users" / "user-1" / "knowledge" / "company.md"
            knowledge_file.parent.mkdir(parents=True)
            knowledge_file.write_text(
                "# Company note\n\n> Source: https://example.com/report\n\n"
                "The project codename is blue-orchid and recurring revenue grew.\n",
                encoding="utf-8",
            )
            manager = MemoryManager(
                config=MemoryConfig(
                    workspace_root=str(workspace),
                    index_db_path=str(workspace / "index.db"),
                    owner_user_id="user-1",
                )
            )
            try:
                asyncio.run(manager.sync())
                search = KnowledgeSearchTool(manager, "user-1").execute(
                    {"query": "blue orchid recurring revenue", "min_score": 0.01}
                )
                self.assertEqual("success", search.status)
                self.assertGreaterEqual(search.result["count"], 1)
                hit = search.result["results"][0]
                self.assertEqual("users/user-1/knowledge/company.md", hit["path"])

                read = KnowledgeGetTool(manager, "user-1").execute(
                    {"path": hit["path"], "start_line": hit["start_line"], "num_lines": 20}
                )
                self.assertEqual("success", read.status)
                self.assertIn("blue-orchid", read.result["content"])
                self.assertEqual("https://example.com/report", read.ext_data["sources"][0]["url"])
                self.assertRegex(read.ext_data["sources"][0]["locator"], r"lines \d+-\d+")
            finally:
                manager.close()


class Phase0ReadinessAndPrivacyTest(unittest.TestCase):
    def test_readiness_reports_required_dependencies_and_optional_search(self):
        settings = Settings(
            llm_api_key="llm-key",
            embedding_api_key="embedding-key",
            longbridge_app_key="key",
            longbridge_app_secret="secret",
            longbridge_access_token="token",
            search_api_key="search-key",
        )

        checks = {item.component: item for item in _readiness_checks(settings)}

        self.assertTrue(checks["llm"].configured)
        self.assertTrue(checks["embedding"].configured)
        self.assertTrue(checks["longbridge"].configured)
        self.assertTrue(checks["web_search"].configured)

    def test_product_event_rejects_nested_or_prompt_payloads(self):
        with self.assertRaises(ValidationError):
            ProductEventRequest(event="research_done", properties={"prompt": {"raw": "secret"}})
        with self.assertRaises(ValidationError):
            ProductEventRequest(event="research_done", properties={"symbol": "AAPL.US"})

    def test_sample_watchlist_and_portfolio_are_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            watchlist = WatchlistService(tmp)
            portfolio = PortfolioService(tmp)

            self.assertEqual(2, len(watchlist.seed_sample_items("user-1")))
            self.assertEqual(2, len(portfolio.seed_sample_items("user-1")))
            self.assertEqual([], watchlist.seed_sample_items("user-1"))
            self.assertEqual([], portfolio.seed_sample_items("user-1"))
            self.assertTrue(all("[Sample]" in item["note"] for item in watchlist.list_items(user_id="user-1")))


if __name__ == "__main__":
    unittest.main()
