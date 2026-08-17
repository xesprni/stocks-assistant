import tempfile
import unittest

from app.core.portfolio.service import PortfolioService
from app.core.research.evaluator import evaluate_due_alerts
from app.core.research.service import ResearchService
from app.core.watchlist.service import WatchlistService
from app.schemas.portfolio import PortfolioItemCreate
from app.schemas.research import AlertRuleCreate, DecisionCreate, ResearchDocumentCreate, ThesisPayload, ThesisSnapshotCreate


class Phase1ResearchServiceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.portfolio = PortfolioService(self.tmp.name)
        self.watchlist = WatchlistService(self.tmp.name)
        self.service = ResearchService(
            self.tmp.name,
            portfolio_service=self.portfolio,
            watchlist_service=self.watchlist,
        )

    def tearDown(self):
        self.tmp.cleanup()

    def test_thesis_versions_capture_changes_and_user_isolation(self):
        first = self.service.create_thesis(
            "user-1", "aapl.us",
            ThesisSnapshotCreate(payload=ThesisPayload(business_model="Hardware", confidence=0.5), reason="Initial thesis"),
        )
        second = self.service.create_thesis(
            "user-1", "AAPL.US",
            ThesisSnapshotCreate(
                payload=ThesisPayload(business_model="Hardware and services", confidence=0.7),
                reason="Services evidence", source_ids=["src_1"],
            ),
        )

        self.assertEqual(1, first["version"])
        self.assertEqual(2, second["version"])
        self.assertEqual(["business_model", "confidence"], second["change_summary"]["changed_fields"])
        self.assertEqual(["src_1"], second["source_ids"])
        self.assertEqual([], self.service.list_theses("user-2", "AAPL.US"))

    def test_document_versions_are_deduplicated_and_have_page_locators(self):
        first = self.service.ingest_document(
            "user-1", "AAPL.US",
            ResearchDocumentCreate(
                title="FY results", document_type="transcript", content="Revenue grew\nMargin stable",
                page_texts=["Revenue grew", "Margin stable"], source_url="https://example.com/fy",
            ),
        )
        duplicate = self.service.ingest_document(
            "user-1", "AAPL.US",
            ResearchDocumentCreate(
                document_id=first["id"], title="FY results", document_type="transcript",
                content="Revenue grew\nMargin stable", page_texts=["Revenue grew", "Margin stable"],
            ),
        )
        second = self.service.ingest_document(
            "user-1", "AAPL.US",
            ResearchDocumentCreate(
                document_id=first["id"], title="FY results", document_type="transcript",
                content="Revenue grew faster\nMargin expanded", page_texts=["Revenue grew faster", "Margin expanded"],
            ),
        )
        detail = self.service.get_document("user-1", first["id"])

        self.assertEqual(1, duplicate["latest_version"])
        self.assertEqual(2, second["latest_version"])
        self.assertEqual(2, len(detail["versions"]))
        self.assertEqual(2, len(detail["versions"][0]["locator"]["pages"]))
        self.assertGreater(detail["versions"][0]["change_summary"]["added_lines"], 0)

    def test_alert_event_is_deduplicated_and_contains_portfolio_and_thesis_context(self):
        self.portfolio.add_item(
            PortfolioItemCreate(market="US", symbol="AAPL.US", name="Apple", shares="10", cost_price="150"),
            user_id="user-1",
        )
        thesis = self.service.create_thesis(
            "user-1", "AAPL.US",
            ThesisSnapshotCreate(
                payload=ThesisPayload(invalidation_conditions=["Price below 100"], confidence=0.8), reason="Risk baseline"
            ),
        )
        rule = self.service.create_alert_rule(
            "user-1",
            AlertRuleCreate(
                symbol="AAPL.US", name="Price breakout", condition_type="price", operator="gt", threshold=200,
                thesis_snapshot_id=thesis["id"], severity="high",
            ),
        )

        event = self.service.record_evaluation(
            "user-1", rule["id"], observed_value=210, event_key="quote-1",
            source={"url": "https://example.com/quote"},
        )
        duplicate = self.service.record_evaluation(
            "user-1", rule["id"], observed_value=210, event_key="quote-1",
            source={"url": "https://example.com/quote"},
        )

        self.assertIsNotNone(event)
        self.assertIsNone(duplicate)
        self.assertTrue(event["portfolio_context"]["held"])
        self.assertEqual(thesis["id"], event["thesis_context"]["snapshot_id"])
        self.assertIn("held position", event["explanation"])

    def test_external_delivery_can_be_queued_and_retried(self):
        rule = self.service.create_alert_rule(
            "user-1",
            AlertRuleCreate(
                symbol="AAPL.US", name="Price alert", condition_type="price", operator="gt", threshold=200,
                channels=["in_app", "telegram"],
            ),
        )
        event = self.service.record_evaluation("user-1", rule["id"], observed_value=210, event_key="quote-delivery")

        self.assertEqual("pending", event["delivery_status"])
        self.assertEqual(1, len(self.service.list_pending_deliveries("user-1")))
        self.assertEqual([], self.service.list_pending_deliveries("user-2"))
        self.service.set_alert_delivery_result("user-1", event["id"], delivered=False, error="network")
        retried = self.service.retry_alert_delivery("user-1", event["id"])
        self.assertEqual("pending", retried["delivery_status"])
        self.assertEqual(1, retried["retry_count"])

    def test_decision_log_can_record_outcome(self):
        decision = self.service.create_decision(
            "user-1", "AAPL.US",
            DecisionCreate(action="Hold", rationale="Evidence remains intact", evidence_ids=["ev_1"]),
        )
        reviewed = self.service.update_decision_outcome("user-1", decision["id"], "Thesis confirmed after earnings")
        self.assertEqual("Thesis confirmed after earnings", reviewed["outcome"])
        self.assertIsNotNone(reviewed["reviewed_at"])

    def test_research_metrics_are_computable_from_audited_records(self):
        self.service.create_thesis(
            "user-1", "AAPL.US", ThesisSnapshotCreate(payload=ThesisPayload(confidence=0.6), reason="Baseline")
        )
        rule = self.service.create_alert_rule(
            "user-1", AlertRuleCreate(symbol="AAPL.US", name="Material move", condition_type="price", operator="gt", threshold=200, severity="high")
        )
        event = self.service.record_evaluation("user-1", rule["id"], observed_value=210, event_key="metrics-event")
        self.service.set_alert_status("user-1", event["id"], "read")

        metrics = self.service.research_metrics("user-1", days=30)
        self.assertEqual(1, metrics["significant_events"])
        self.assertEqual(1, metrics["significant_events_reviewed"])
        self.assertEqual(1.0, metrics["thesis_update_rate_after_alert"])
        self.assertEqual(0.0, metrics["alert_noise_rate"])

    def test_saved_evidence_and_materialized_document_feed_research_context(self):
        from app.schemas.research import ResearchEvidenceCreate

        evidence = self.service.save_evidence(
            "user-1", "AAPL.US",
            ResearchEvidenceCreate(
                source_id="src_1", source={"title": "Filing", "url": "https://example.com/filing"}, relation="supports"
            ),
        )
        document = self.service.ingest_document(
            "user-1", "AAPL.US",
            ResearchDocumentCreate(title="10-K", document_type="filing", content="Revenue evidence", source_url="https://example.com/10k"),
        )
        path = self.service.materialize_document_version("user-1", document["id"])

        self.assertEqual("supports", evidence["relation"])
        self.assertEqual(1, self.service.security_summary("user-1", "AAPL.US")["evidence_count"])
        self.assertTrue(path.is_file())
        self.assertIn("> Source: https://example.com/10k", path.read_text(encoding="utf-8"))


class _Market:
    def get_realtime_quotes(self, symbols, settings=None):
        return {"quotes": [{"symbol": symbols[0], "last_done": "210", "timestamp": "2026-08-17T10:00:00Z"}]}


class _Fundamentals:
    def get_security_insights(self, symbol, settings=None):
        return {"symbol": symbol, "valuation": {"items": []}, "company": {"revenue": 120}, "fetched_at": "2026-08-17T10:00:00Z"}


class _News:
    def get_security_news(self, symbol, limit=10, settings=None):
        return {"symbol": symbol, "news": []}


class Phase1AlertEvaluatorTest(unittest.TestCase):
    def test_live_price_evaluation_creates_event(self):
        with tempfile.TemporaryDirectory() as tmp:
            service = ResearchService(tmp)
            service.create_alert_rule(
                "user-1",
                AlertRuleCreate(symbol="AAPL.US", name="Breakout", condition_type="price", operator="gt", threshold=200),
            )
            result = evaluate_due_alerts(
                service, market_service=_Market(), fundamental_service=_Fundamentals(), news_service=_News(),
                user_id="user-1", force=True,
            )
            self.assertEqual(1, result["checked"])
            self.assertEqual(1, result["created"])

    def test_kpi_evaluation_uses_named_fundamental_metric(self):
        with tempfile.TemporaryDirectory() as tmp:
            service = ResearchService(tmp)
            service.create_alert_rule(
                "user-1",
                AlertRuleCreate(
                    symbol="AAPL.US", name="Revenue threshold", condition_type="kpi", operator="gt",
                    threshold=100, metadata={"metric": "revenue"},
                ),
            )
            result = evaluate_due_alerts(
                service, market_service=_Market(), fundamental_service=_Fundamentals(), news_service=_News(),
                user_id="user-1", force=True,
            )
            self.assertEqual(1, result["created"])


if __name__ == "__main__":
    unittest.main()
