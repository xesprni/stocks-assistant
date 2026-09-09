"""Research use cases combining durable records, portfolio context and indexing."""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from app.core.research.repository import ResearchRepository
from app.core.research.utils import _id, _iso_timestamp, _json, _now
from app.schemas.research import (
    AlertRuleCreate,
    AlertRuleUpdate,
    DecisionCreate,
    ResearchDocumentCreate,
    ResearchEvidenceCreate,
    ThesisSnapshotCreate,
)


class ResearchService:
    """Coordinate research workflows without owning SQLite statements."""

    def __init__(
        self,
        workspace_dir: str,
        *,
        portfolio_service=None,
        watchlist_service=None,
        repository: ResearchRepository | None = None,
    ):
        root = Path(workspace_dir).expanduser()
        self.repository = repository or ResearchRepository(root / "research" / "research.db")
        self.db_path = self.repository.db_path
        self.portfolio_service = portfolio_service
        self.watchlist_service = watchlist_service

    @staticmethod
    def normalize_symbol(symbol: str) -> str:
        return ResearchRepository.normalize_symbol(symbol)

    def create_thesis(
        self, user_id: str, symbol: str, request: ThesisSnapshotCreate
    ) -> dict[str, Any]:
        return self.repository.create_thesis(user_id, symbol, request)

    def list_theses(self, user_id: str, symbol: str) -> list[dict[str, Any]]:
        return self.repository.list_theses(user_id, symbol)

    def latest_theses(self, user_id: str, symbols: list[str]) -> dict[str, dict[str, Any]]:
        return self.repository.latest_theses(user_id, symbols)

    def get_thesis(self, user_id: str, thesis_id: str) -> dict[str, Any]:
        return self.repository.get_thesis(user_id, thesis_id)

    def validate_thesis_symbol(self, user_id: str, thesis_id: str, symbol: str) -> dict[str, Any]:
        return self.repository.validate_thesis_symbol(user_id, thesis_id, symbol)

    def create_decision(self, user_id: str, symbol: str, request: DecisionCreate) -> dict[str, Any]:
        return self.repository.create_decision(user_id, symbol, request)

    def list_decisions(self, user_id: str, symbol: str, limit: int = 50) -> list[dict[str, Any]]:
        return self.repository.list_decisions(user_id, symbol, limit)

    def update_decision_outcome(
        self, user_id: str, decision_id: str, outcome: str
    ) -> dict[str, Any]:
        return self.repository.update_decision_outcome(user_id, decision_id, outcome)

    def save_evidence(
        self, user_id: str, symbol: str, request: ResearchEvidenceCreate
    ) -> dict[str, Any]:
        return self.repository.save_evidence(user_id, symbol, request)

    def list_evidence(self, user_id: str, symbol: str) -> list[dict[str, Any]]:
        return self.repository.list_evidence(user_id, symbol)

    def ingest_document(
        self, user_id: str, symbol: str, request: ResearchDocumentCreate
    ) -> dict[str, Any]:
        return self.repository.ingest_document(user_id, symbol, request)

    def list_documents(self, user_id: str, symbol: str) -> list[dict[str, Any]]:
        return self.repository.list_documents(user_id, symbol)

    def get_document(
        self, user_id: str, document_id: str, *, include_content: bool = True
    ) -> dict[str, Any]:
        return self.repository.get_document(user_id, document_id, include_content=include_content)

    def materialize_document_version(self, user_id: str, document_id: str) -> Path:
        """将最新材料版本写入用户 knowledge 路径，供统一 RAG 索引和引用定位。"""
        document = self.get_document(user_id, document_id, include_content=True)
        version = document["versions"][0]
        target = (
            self.db_path.parent.parent
            / "users"
            / user_id
            / "knowledge"
            / "research"
            / document["symbol"]
        )
        target.mkdir(parents=True, exist_ok=True)
        file_path = target / f"{document_id}-v{version['version']}.md"
        frontmatter = [
            f"# {document['title']}",
            "",
            f"> Type: {document['document_type']}",
            f"> Symbol: {document['symbol']}",
            f"> Published: {version.get('published_at') or ''}",
        ]
        if document.get("source_url"):
            frontmatter.append(f"> Source: {document['source_url']}")
        frontmatter.extend(["", version.get("content") or ""])
        file_path.write_text("\n".join(frontmatter), encoding="utf-8")
        return file_path

    def research_metrics(self, user_id: str, *, days: int = 30) -> dict[str, Any]:
        """从可审计时间戳直接计算 Phase 1 的闭环指标，不依赖前端埋点。"""
        bounded_days = min(max(int(days), 1), 365)
        cutoff = (datetime.now(UTC) - timedelta(days=bounded_days)).isoformat()
        events, theses = self.repository.metric_records(user_id, cutoff)
        significant = [row for row in events if row["severity"] in {"high", "critical"}]
        review_delays = []
        for row in significant:
            if not row["read_at"]:
                continue
            try:
                occurred = datetime.fromisoformat(row["occurred_at"].replace("Z", "+00:00"))
                reviewed = datetime.fromisoformat(row["read_at"].replace("Z", "+00:00"))
                review_delays.append(max((reviewed - occurred).total_seconds() / 60, 0))
            except ValueError:
                continue
        alert_symbols = {row["symbol"] for row in events}
        thesis_symbols = {row["symbol"] for row in theses}
        dismissed = sum(1 for row in events if row["status"] == "dismissed")
        return {
            "window_days": bounded_days,
            "alert_events": len(events),
            "significant_events": len(significant),
            "significant_events_reviewed": len(review_delays),
            "average_significant_review_delay_minutes": round(
                sum(review_delays) / len(review_delays), 2
            )
            if review_delays
            else None,
            "thesis_updates": len(theses),
            "thesis_update_rate_after_alert": round(
                len(alert_symbols & thesis_symbols) / len(alert_symbols), 4
            )
            if alert_symbols
            else None,
            "alert_noise_rate": round(dismissed / len(events), 4) if events else None,
            "definitions": {
                "significant": "severity high or critical",
                "reviewed": "event marked read",
                "thesis_update_rate_after_alert": "symbols with both an alert and a Thesis snapshot in the selected window / symbols with alerts",
                "alert_noise_rate": "dismissed events / all events in the selected window",
            },
        }

    @staticmethod
    def _document_locator(content: str, page_texts: list[str]) -> dict[str, Any]:
        return ResearchRepository._document_locator(content, page_texts)

    @staticmethod
    def _document_diff(
        previous: str, current: str, previous_version_id: str | None
    ) -> dict[str, Any]:
        return ResearchRepository._document_diff(previous, current, previous_version_id)

    def create_alert_rule(self, user_id: str, request: AlertRuleCreate) -> dict[str, Any]:
        return self.repository.create_alert_rule(user_id, request)

    def list_alert_rules(
        self, user_id: str | None = None, symbol: str | None = None, *, due_only: bool = False
    ) -> list[dict[str, Any]]:
        return self.repository.list_alert_rules(user_id, symbol, due_only=due_only)

    def get_alert_rule(self, user_id: str, rule_id: str) -> dict[str, Any]:
        return self.repository.get_alert_rule(user_id, rule_id)

    def update_alert_rule(
        self, user_id: str, rule_id: str, request: AlertRuleUpdate
    ) -> dict[str, Any]:
        return self.repository.update_alert_rule(user_id, rule_id, request)

    def delete_alert_rule(self, user_id: str, rule_id: str) -> None:
        return self.repository.delete_alert_rule(user_id, rule_id)

    def record_evaluation(
        self,
        user_id: str,
        rule_id: str,
        *,
        observed_value: Any,
        observed_at: Any = None,
        event_key: str | None = None,
        title: str | None = None,
        source: dict | None = None,
    ) -> dict[str, Any] | None:
        rule = self.get_alert_rule(user_id, rule_id)
        occurred_at = _iso_timestamp(observed_at)
        triggered = self._condition_matches(rule["operator"], observed_value, rule["threshold"])
        self._mark_rule_evaluated(rule, error=None)
        if not triggered:
            return None
        source = source or {}
        identity = event_key or str(
            source.get("id") or source.get("url") or f"{occurred_at[:13]}:{observed_value}"
        )
        fingerprint = hashlib.sha256(f"{user_id}|{rule_id}|{identity}".encode()).hexdigest()
        portfolio_context = self._portfolio_context(user_id, rule["symbol"])
        thesis_context = self._thesis_context(user_id, rule)
        explanation = self._alert_explanation(
            rule, observed_value, portfolio_context, thesis_context
        )
        event_id = _id("alert")
        delivery_status = (
            "pending"
            if any(channel != "in_app" for channel in rule["channels"])
            else "not_requested"
        )
        saved = self.repository.insert_alert_event(
            (
                event_id,
                user_id,
                rule_id,
                rule["symbol"],
                fingerprint,
                rule["severity"],
                title or rule["name"],
                explanation,
                _json(source),
                _json(portfolio_context),
                _json(thesis_context),
                "unread",
                delivery_status,
                0,
                occurred_at,
                _now(),
            ),
        )
        if not saved:
            return None
        return self.get_alert_event(user_id, event_id)

    @staticmethod
    def _condition_matches(operator: str, observed: Any, threshold: Any) -> bool:
        if operator == "changed":
            return bool(observed)
        if operator == "contains":
            return str(threshold or "").lower() in str(observed or "").lower()
        if operator == "eq":
            return observed == threshold or str(observed) == str(threshold)
        try:
            left, right = float(observed), float(threshold)
        except (TypeError, ValueError):
            return False
        return {
            "gt": left > right,
            "gte": left >= right,
            "lt": left < right,
            "lte": left <= right,
        }.get(operator, False)

    def _mark_rule_evaluated(self, rule: dict[str, Any], error: str | None) -> None:
        return self.repository._mark_rule_evaluated(rule, error)

    def mark_rule_error(self, rule: dict[str, Any], error: str) -> None:
        return self.repository.mark_rule_error(rule, error)

    def list_alert_events(
        self,
        user_id: str,
        *,
        symbol: str | None = None,
        status: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        return self.repository.list_alert_events(user_id, symbol=symbol, status=status, limit=limit)

    def get_alert_event(self, user_id: str, event_id: str) -> dict[str, Any]:
        return self.repository.get_alert_event(user_id, event_id)

    def set_alert_status(self, user_id: str, event_id: str, status: str) -> dict[str, Any]:
        return self.repository.set_alert_status(user_id, event_id, status)

    def retry_alert_delivery(self, user_id: str, event_id: str) -> dict[str, Any]:
        return self.repository.retry_alert_delivery(user_id, event_id)

    def list_pending_deliveries(
        self, user_id: str | None = None, *, limit: int = 100
    ) -> list[dict[str, Any]]:
        return self.repository.list_pending_deliveries(user_id, limit=limit)

    def set_alert_delivery_result(
        self, user_id: str, event_id: str, *, delivered: bool, error: str | None = None
    ) -> dict[str, Any]:
        return self.repository.set_alert_delivery_result(
            user_id, event_id, delivered=delivered, error=error
        )

    def _portfolio_context(self, user_id: str, symbol: str) -> dict[str, Any]:
        if not self.portfolio_service:
            return {}
        for market in ("US", "A", "H"):
            for item in self.portfolio_service.repository.list_items(market, user_id=user_id):
                if str(item.get("symbol") or "").upper() == symbol:
                    return {
                        "held": True,
                        "market": market,
                        "shares": item.get("shares"),
                        "cost_price": item.get("cost_price"),
                        "note": item.get("note", ""),
                    }
        return {"held": False}

    def _thesis_context(self, user_id: str, rule: dict[str, Any]) -> dict[str, Any]:
        thesis = None
        if rule.get("thesis_snapshot_id"):
            try:
                thesis = self.get_thesis(user_id, rule["thesis_snapshot_id"])
            except KeyError:
                thesis = None
        if thesis is None:
            values = self.list_theses(user_id, rule["symbol"])
            thesis = values[0] if values else None
        if not thesis:
            return {}
        return {
            "snapshot_id": thesis["id"],
            "version": thesis["version"],
            "confidence": thesis["payload"].get("confidence"),
            "invalidation_conditions": thesis["payload"].get("invalidation_conditions", []),
        }

    @staticmethod
    def _alert_explanation(
        rule: dict[str, Any], observed: Any, portfolio: dict, thesis: dict
    ) -> str:
        pieces = [
            f"{rule['condition_type']} observed {observed!s} {rule['operator']} threshold {rule['threshold']!s}."
        ]
        if portfolio.get("held"):
            pieces.append(
                f"This affects a held position of {portfolio.get('shares') or '?'} shares."
            )
        if thesis.get("snapshot_id"):
            pieces.append(
                f"Review Thesis v{thesis.get('version')} and its invalidation conditions."
            )
        pieces.append(
            "Verify the linked source and decide whether the Thesis or monitoring rule should change."
        )
        return " ".join(pieces)

    def security_summary(self, user_id: str, symbol: str) -> dict[str, Any]:
        symbol = self.normalize_symbol(symbol)
        theses = self.list_theses(user_id, symbol)
        decisions = self.list_decisions(user_id, symbol, limit=5)
        documents = self.list_documents(user_id, symbol)
        rules = self.list_alert_rules(user_id, symbol)
        events = self.list_alert_events(user_id, symbol=symbol, status="unread", limit=500)
        evidence = self.list_evidence(user_id, symbol)
        watchlisted = False
        if self.watchlist_service:
            watchlisted = any(
                str(item.get("symbol") or "").upper() == symbol
                for item in self.watchlist_service.list_items(user_id=user_id)
            )
        position = self._portfolio_context(user_id, symbol)
        return {
            "symbol": symbol,
            "watchlisted": watchlisted,
            "position": position if position.get("held") else None,
            "latest_thesis": theses[0] if theses else None,
            "thesis_versions": len(theses),
            "documents": len(documents),
            "unread_alerts": len(events),
            "alert_rules": len(rules),
            "latest_decisions": decisions,
            "evidence_count": len(evidence),
        }
