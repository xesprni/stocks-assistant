"""Regression checks for repository transactions and historical store APIs."""

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import event

from app.core.app_store import AppStore
from app.core.labs.service import InvestmentLabService
from app.core.orm.models.app import AuditEvent
from app.core.research.service import ResearchService
from app.schemas.labs import ValuationModelCreate
from app.schemas.research import ResearchDocumentCreate


def test_config_and_role_changes_roll_back_together(tmp_path):
    store = AppStore(tmp_path / "app.db")
    store.set_config_values({"app_language": "zh", "multi_agent_roles": {"analyst": {"tools": []}}})

    with pytest.raises(ValueError, match="must be an object"):
        store.set_config_values({"app_language": "en", "multi_agent_roles": {"invalid": "role"}})

    assert store.get_config()["app_language"] == "zh"
    assert store.get_subagent_roles() == {"analyst": {"tools": []}}


def test_revoke_devices_rolls_back_sessions_and_tokens_when_audit_fails(tmp_path):
    store = AppStore(tmp_path / "app.db")
    user = store.create_user("reader", "test-password-hash")
    expires = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    current = store.create_login_session(user["id"], expires_at=expires, device_id="current")
    other = store.create_login_session(user["id"], expires_at=expires, device_id="other")
    store.create_refresh_token(user["id"], "refresh-hash", expires, session_id=other["id"])

    def reject_audit(session, _context, _instances):
        if any(isinstance(row, AuditEvent) for row in session.new):
            raise RuntimeError("audit unavailable")

    event.listen(store.session_factory, "before_flush", reject_audit)
    try:
        with pytest.raises(RuntimeError, match="audit unavailable"):
            store.revoke_other_login_devices(user["id"], current_session_id=current["id"])
    finally:
        event.remove(store.session_factory, "before_flush", reject_audit)

    assert store.get_login_session(other["id"])["revoked_at"] is None
    assert store.get_refresh_token("refresh-hash")["revoked_at"] is None


def test_legacy_config_migrates_once_and_stays_encrypted(tmp_path):
    legacy = tmp_path / "config.json"
    legacy.write_text(json.dumps({"llm_api_key": "fixture-secret", "app_language": "en"}))
    store = AppStore(tmp_path / "app.db")
    assert store.migrate_config_json_once(legacy)["app_language"] == "en"
    legacy.write_text(json.dumps({"app_language": "zh"}))
    assert store.migrate_config_json_once(legacy) == {}
    assert store.get_config()["app_language"] == "en"
    with store.connect() as connection:
        value = connection.execute(
            "SELECT value_json FROM app_config WHERE key='llm_api_key'"
        ).fetchone()[0]
    assert "fixture-secret" not in value


def test_document_deduplication_across_repository_instances(tmp_path):
    first = ResearchService(str(tmp_path))
    second = ResearchService(str(tmp_path))
    document = first.ingest_document(
        "reader", "AAA.US", ResearchDocumentCreate(title="Report", content="first version")
    )
    request = ResearchDocumentCreate(
        document_id=document["id"], title="Report", content="updated version"
    )
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(
            executor.map(
                lambda service: service.ingest_document("reader", "AAA.US", request),
                (first, second),
            )
        )
    assert all(result["latest_version"] == 2 for result in results)
    assert len(first.get_document("reader", document["id"])["versions"]) == 2
    with pytest.raises(KeyError):
        second.get_document("other-reader", document["id"])


def test_valuation_joins_callers_transaction_without_committing(tmp_path):
    service = InvestmentLabService(
        str(tmp_path),
        portfolio_service=None,
        market_service=None,
        fundamental_service=None,
        research_service=ResearchService(str(tmp_path)),
    )
    request = ValuationModelCreate(
        title="Relative", model_type="relative", assumptions={"peer_median": 12, "target_metric": 3}
    )
    with (
        pytest.raises(RuntimeError, match="report failed"),
        service.unit_of_work.transaction() as transaction,
    ):
        saved = service.create_valuation_model(
            "reader", "AAA.US", request, unit_of_work=transaction
        )
        assert saved["version"] == 1
        raise RuntimeError("report failed")
    assert service.list_valuation_models("reader") == []


def test_labs_transaction_rolls_back_model_and_run_when_run_update_fails(tmp_path):
    service = InvestmentLabService(
        str(tmp_path),
        portfolio_service=None,
        market_service=None,
        fundamental_service=None,
        research_service=ResearchService(str(tmp_path)),
    )
    run = {"id": "run", "lab": "valuation", "status": "running", "created_at": "now"}
    service.runs.create("reader", run)
    request = ValuationModelCreate(
        title="Relative", model_type="relative", assumptions={"peer_median": 12, "target_metric": 3}
    )
    with (
        pytest.raises(ValueError, match="JSON compliant"),
        service.unit_of_work.transaction() as transaction,
    ):
        service.create_valuation_model("reader", "AAA.US", request, unit_of_work=transaction)
        transaction.runs.update_running(
            "reader", {**run, "status": "completed", "report": float("nan")}
        )
    assert service.list_valuation_models("reader") == []
    assert service.runs.get("reader", "run")["status"] == "running"


def test_concurrent_labs_instances_allocate_distinct_versions(tmp_path):
    def service():
        return InvestmentLabService(
            str(tmp_path),
            portfolio_service=None,
            market_service=None,
            fundamental_service=None,
            research_service=ResearchService(str(tmp_path)),
        )

    first, second = service(), service()
    request = ValuationModelCreate(
        title="Relative", model_type="relative", assumptions={"peer_median": 12, "target_metric": 3}
    )
    original = first.create_valuation_model("reader", "AAA.US", request)
    update = request.model_copy(update={"model_id": original["id"]})
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(
            executor.map(
                lambda instance: instance.create_valuation_model("reader", "AAA.US", update),
                (first, second),
            )
        )
    assert sorted(row["version"] for row in results) == [2, 3]
