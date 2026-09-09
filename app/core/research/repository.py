"""SQLite repository for versioned research records and alert state."""

from __future__ import annotations

import difflib
import hashlib
import sqlite3
import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from app.core.market.utils import canonical_symbol
from app.core.research.utils import _id, _json, _loads, _now
from app.schemas.research import (
    AlertRuleCreate,
    AlertRuleUpdate,
    DecisionCreate,
    ResearchDocumentCreate,
    ResearchEvidenceCreate,
    ThesisSnapshotCreate,
)


class ResearchRepository:
    """Own database access; version allocation and insertion share one write transaction."""

    def __init__(self, db_path: str | Path) -> None:
        self.db_path = Path(db_path).expanduser()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 15000")
        return connection

    def _init_schema(self) -> None:
        statements = [
            """CREATE TABLE IF NOT EXISTS thesis_snapshots (
                id TEXT PRIMARY KEY, user_id TEXT NOT NULL, symbol TEXT NOT NULL, version INTEGER NOT NULL,
                payload_json TEXT NOT NULL, change_summary_json TEXT NOT NULL, reason TEXT NOT NULL,
                source_ids_json TEXT NOT NULL, created_at TEXT NOT NULL,
                UNIQUE(user_id, symbol, version)
            )""",
            "CREATE INDEX IF NOT EXISTS idx_thesis_user_symbol ON thesis_snapshots(user_id, symbol, version DESC)",
            """CREATE TABLE IF NOT EXISTS research_decisions (
                id TEXT PRIMARY KEY, user_id TEXT NOT NULL, symbol TEXT NOT NULL, action TEXT NOT NULL,
                rationale TEXT NOT NULL, evidence_ids_json TEXT NOT NULL, thesis_snapshot_id TEXT,
                outcome TEXT NOT NULL, created_at TEXT NOT NULL, reviewed_at TEXT
            )""",
            "CREATE INDEX IF NOT EXISTS idx_decisions_user_symbol ON research_decisions(user_id, symbol, created_at DESC)",
            """CREATE TABLE IF NOT EXISTS research_evidence (
                id TEXT PRIMARY KEY, user_id TEXT NOT NULL, symbol TEXT NOT NULL, source_id TEXT NOT NULL,
                source_json TEXT NOT NULL, relation TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL,
                UNIQUE(user_id, symbol, source_id)
            )""",
            "CREATE INDEX IF NOT EXISTS idx_evidence_user_symbol ON research_evidence(user_id, symbol, created_at DESC)",
            """CREATE TABLE IF NOT EXISTS research_documents (
                id TEXT PRIMARY KEY, user_id TEXT NOT NULL, symbol TEXT NOT NULL, title TEXT NOT NULL,
                document_type TEXT NOT NULL, source_url TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            )""",
            "CREATE INDEX IF NOT EXISTS idx_documents_user_symbol ON research_documents(user_id, symbol, updated_at DESC)",
            """CREATE TABLE IF NOT EXISTS research_document_versions (
                id TEXT PRIMARY KEY, document_id TEXT NOT NULL, user_id TEXT NOT NULL, version INTEGER NOT NULL,
                published_at TEXT, content_hash TEXT NOT NULL, content_text TEXT NOT NULL,
                locator_json TEXT NOT NULL, change_summary_json TEXT NOT NULL, created_at TEXT NOT NULL,
                UNIQUE(document_id, version), UNIQUE(document_id, content_hash),
                FOREIGN KEY(document_id) REFERENCES research_documents(id) ON DELETE CASCADE
            )""",
            """CREATE TABLE IF NOT EXISTS alert_rules (
                id TEXT PRIMARY KEY, user_id TEXT NOT NULL, symbol TEXT NOT NULL, name TEXT NOT NULL,
                condition_type TEXT NOT NULL, operator TEXT NOT NULL, threshold_json TEXT NOT NULL,
                severity TEXT NOT NULL, thesis_snapshot_id TEXT, enabled INTEGER NOT NULL, channels_json TEXT NOT NULL,
                evaluation_interval_seconds INTEGER NOT NULL, metadata_json TEXT NOT NULL,
                last_evaluated_at TEXT, next_evaluation_at TEXT, last_error TEXT,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            )""",
            "CREATE INDEX IF NOT EXISTS idx_alert_rules_due ON alert_rules(enabled, next_evaluation_at)",
            """CREATE TABLE IF NOT EXISTS alert_events (
                id TEXT PRIMARY KEY, user_id TEXT NOT NULL, rule_id TEXT NOT NULL, symbol TEXT NOT NULL,
                fingerprint TEXT NOT NULL, severity TEXT NOT NULL, title TEXT NOT NULL, explanation TEXT NOT NULL,
                source_json TEXT NOT NULL, portfolio_context_json TEXT NOT NULL, thesis_context_json TEXT NOT NULL,
                status TEXT NOT NULL, delivery_status TEXT NOT NULL, retry_count INTEGER NOT NULL,
                last_error TEXT, occurred_at TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT,
                UNIQUE(user_id, fingerprint), FOREIGN KEY(rule_id) REFERENCES alert_rules(id) ON DELETE CASCADE
            )""",
            "CREATE INDEX IF NOT EXISTS idx_alert_events_inbox ON alert_events(user_id, status, occurred_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_alert_events_delivery ON alert_events(delivery_status, created_at)",
        ]
        with self._connect() as connection:
            # WAL 是数据库级持久配置，只在 schema 初始化阶段设置。
            connection.execute("PRAGMA journal_mode = WAL")
            connection.execute("PRAGMA synchronous = NORMAL")
            for statement in statements:
                connection.execute(statement)

    @staticmethod
    def normalize_symbol(symbol: str) -> str:
        value = canonical_symbol(symbol)
        if (
            not value
            or len(value) > 40
            or any(ch not in "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-_" for ch in value)
        ):
            raise ValueError("invalid symbol")
        return value

    def create_thesis(
        self, user_id: str, symbol: str, request: ThesisSnapshotCreate
    ) -> dict[str, Any]:
        symbol = self.normalize_symbol(symbol)
        payload = request.payload.model_dump(mode="json")
        with self._lock, self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            previous = connection.execute(
                "SELECT * FROM thesis_snapshots WHERE user_id = ? AND symbol = ? ORDER BY version DESC LIMIT 1",
                (user_id, symbol),
            ).fetchone()
            version = int(previous["version"]) + 1 if previous else 1
            previous_payload = _loads(previous["payload_json"], {}) if previous else {}
            changed_fields = sorted(
                key for key in payload if previous_payload.get(key) != payload.get(key)
            )
            change_summary = {
                "previous_version": int(previous["version"]) if previous else None,
                "changed_fields": changed_fields,
                "confidence_change": round(
                    float(payload.get("confidence", 0))
                    - float(previous_payload.get("confidence", 0)),
                    4,
                )
                if previous
                else None,
            }
            row_id = _id("thesis")
            created_at = _now()
            connection.execute(
                """INSERT INTO thesis_snapshots
                   (id,user_id,symbol,version,payload_json,change_summary_json,reason,source_ids_json,created_at)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (
                    row_id,
                    user_id,
                    symbol,
                    version,
                    _json(payload),
                    _json(change_summary),
                    request.reason.strip(),
                    _json(request.source_ids),
                    created_at,
                ),
            )
        return self.get_thesis(user_id, row_id)

    def list_theses(self, user_id: str, symbol: str) -> list[dict[str, Any]]:
        symbol = self.normalize_symbol(symbol)
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM thesis_snapshots WHERE user_id = ? AND symbol = ? ORDER BY version DESC",
                (user_id, symbol),
            ).fetchall()
        return [self._thesis_row(row) for row in rows]

    def latest_theses(self, user_id: str, symbols: list[str]) -> dict[str, dict[str, Any]]:
        """批量读取多个标的的最新 Thesis，避免组合分析逐标的 N+1。"""
        normalized = list(dict.fromkeys(self.normalize_symbol(symbol) for symbol in symbols))
        if not normalized:
            return {}
        placeholders = ",".join("?" for _ in normalized)
        with self._connect() as connection:
            rows = connection.execute(
                f"""WITH ranked AS (
                        SELECT thesis_snapshots.*,
                               ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY version DESC) AS row_rank
                        FROM thesis_snapshots
                        WHERE user_id = ? AND symbol IN ({placeholders})
                    )
                    SELECT * FROM ranked WHERE row_rank = 1 ORDER BY symbol ASC""",
                [user_id, *normalized],
            ).fetchall()
        return {row["symbol"]: self._thesis_row(row) for row in rows}

    def get_thesis(self, user_id: str, thesis_id: str) -> dict[str, Any]:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM thesis_snapshots WHERE id = ? AND user_id = ?", (thesis_id, user_id)
            ).fetchone()
        if not row:
            raise KeyError(thesis_id)
        return self._thesis_row(row)

    def validate_thesis_symbol(self, user_id: str, thesis_id: str, symbol: str) -> dict[str, Any]:
        thesis = self.get_thesis(user_id, thesis_id)
        if thesis["symbol"] != self.normalize_symbol(symbol):
            raise ValueError("linked Thesis belongs to a different symbol")
        return thesis

    def _thesis_row(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "symbol": row["symbol"],
            "version": row["version"],
            "payload": _loads(row["payload_json"], {}),
            "change_summary": _loads(row["change_summary_json"], {}),
            "reason": row["reason"],
            "source_ids": _loads(row["source_ids_json"], []),
            "created_at": row["created_at"],
        }

    def create_decision(self, user_id: str, symbol: str, request: DecisionCreate) -> dict[str, Any]:
        symbol = self.normalize_symbol(symbol)
        if request.thesis_snapshot_id:
            self.validate_thesis_symbol(user_id, request.thesis_snapshot_id, symbol)
        row = {
            "id": _id("decision"),
            "symbol": symbol,
            "action": request.action.strip(),
            "rationale": request.rationale.strip(),
            "evidence_ids": request.evidence_ids,
            "thesis_snapshot_id": request.thesis_snapshot_id,
            "outcome": request.outcome.strip(),
            "created_at": _now(),
            "reviewed_at": _now() if request.outcome.strip() else None,
        }
        with self._connect() as connection:
            connection.execute(
                """INSERT INTO research_decisions
                   (id,user_id,symbol,action,rationale,evidence_ids_json,thesis_snapshot_id,outcome,created_at,reviewed_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (
                    row["id"],
                    user_id,
                    symbol,
                    row["action"],
                    row["rationale"],
                    _json(row["evidence_ids"]),
                    row["thesis_snapshot_id"],
                    row["outcome"],
                    row["created_at"],
                    row["reviewed_at"],
                ),
            )
        return row

    def list_decisions(self, user_id: str, symbol: str, limit: int = 50) -> list[dict[str, Any]]:
        symbol = self.normalize_symbol(symbol)
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM research_decisions WHERE user_id = ? AND symbol = ? ORDER BY created_at DESC LIMIT ?",
                (user_id, symbol, min(max(limit, 1), 200)),
            ).fetchall()
        return [self._decision_row(row) for row in rows]

    def update_decision_outcome(
        self, user_id: str, decision_id: str, outcome: str
    ) -> dict[str, Any]:
        with self._connect() as connection:
            cursor = connection.execute(
                "UPDATE research_decisions SET outcome = ?, reviewed_at = ? WHERE id = ? AND user_id = ?",
                (outcome.strip(), _now(), decision_id, user_id),
            )
            if not cursor.rowcount:
                raise KeyError(decision_id)
            row = connection.execute(
                "SELECT * FROM research_decisions WHERE id = ?", (decision_id,)
            ).fetchone()
        return self._decision_row(row)

    def _decision_row(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "symbol": row["symbol"],
            "action": row["action"],
            "rationale": row["rationale"],
            "evidence_ids": _loads(row["evidence_ids_json"], []),
            "thesis_snapshot_id": row["thesis_snapshot_id"],
            "outcome": row["outcome"],
            "created_at": row["created_at"],
            "reviewed_at": row["reviewed_at"],
        }

    def save_evidence(
        self, user_id: str, symbol: str, request: ResearchEvidenceCreate
    ) -> dict[str, Any]:
        symbol = self.normalize_symbol(symbol)
        with self._connect() as connection:
            existing = connection.execute(
                "SELECT * FROM research_evidence WHERE user_id=? AND symbol=? AND source_id=?",
                (user_id, symbol, request.source_id),
            ).fetchone()
            if existing:
                connection.execute(
                    "UPDATE research_evidence SET source_json=?, relation=?, note=? WHERE id=?",
                    (_json(request.source), request.relation, request.note.strip(), existing["id"]),
                )
                evidence_id = existing["id"]
            else:
                evidence_id = _id("evidence")
                connection.execute(
                    """INSERT INTO research_evidence
                       (id,user_id,symbol,source_id,source_json,relation,note,created_at) VALUES (?,?,?,?,?,?,?,?)""",
                    (
                        evidence_id,
                        user_id,
                        symbol,
                        request.source_id,
                        _json(request.source),
                        request.relation,
                        request.note.strip(),
                        _now(),
                    ),
                )
            row = connection.execute(
                "SELECT * FROM research_evidence WHERE id=?", (evidence_id,)
            ).fetchone()
        return self._evidence_row(row)

    def list_evidence(self, user_id: str, symbol: str) -> list[dict[str, Any]]:
        symbol = self.normalize_symbol(symbol)
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM research_evidence WHERE user_id=? AND symbol=? ORDER BY created_at DESC",
                (user_id, symbol),
            ).fetchall()
        return [self._evidence_row(row) for row in rows]

    @staticmethod
    def _evidence_row(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "symbol": row["symbol"],
            "source_id": row["source_id"],
            "source": _loads(row["source_json"], {}),
            "relation": row["relation"],
            "note": row["note"],
            "created_at": row["created_at"],
        }

    def ingest_document(
        self, user_id: str, symbol: str, request: ResearchDocumentCreate
    ) -> dict[str, Any]:
        symbol = self.normalize_symbol(symbol)
        content = request.content.replace("\x00", "").strip()
        content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
        with self._lock, self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            document = None
            if request.document_id:
                document = connection.execute(
                    "SELECT * FROM research_documents WHERE id = ? AND user_id = ? AND symbol = ?",
                    (request.document_id, user_id, symbol),
                ).fetchone()
                if not document:
                    raise KeyError(request.document_id)
            if not document:
                document_id = _id("doc")
                created_at = _now()
                connection.execute(
                    """INSERT INTO research_documents
                       (id,user_id,symbol,title,document_type,source_url,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)""",
                    (
                        document_id,
                        user_id,
                        symbol,
                        request.title.strip(),
                        request.document_type,
                        request.source_url,
                        created_at,
                        created_at,
                    ),
                )
            else:
                document_id = document["id"]
                connection.execute(
                    "UPDATE research_documents SET title=?, document_type=?, source_url=?, updated_at=? WHERE id=?",
                    (
                        request.title.strip(),
                        request.document_type,
                        request.source_url or document["source_url"],
                        _now(),
                        document_id,
                    ),
                )
            duplicate = connection.execute(
                "SELECT id FROM research_document_versions WHERE document_id = ? AND content_hash = ?",
                (document_id, content_hash),
            ).fetchone()
            if not duplicate:
                previous = connection.execute(
                    "SELECT * FROM research_document_versions WHERE document_id = ? ORDER BY version DESC LIMIT 1",
                    (document_id,),
                ).fetchone()
                version = int(previous["version"]) + 1 if previous else 1
                previous_content = previous["content_text"] if previous else ""
                locator = self._document_locator(content, request.page_texts)
                change_summary = self._document_diff(
                    previous_content, content, previous["id"] if previous else None
                )
                connection.execute(
                    """INSERT INTO research_document_versions
                       (id,document_id,user_id,version,published_at,content_hash,content_text,locator_json,change_summary_json,created_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?)""",
                    (
                        _id("docv"),
                        document_id,
                        user_id,
                        version,
                        request.published_at,
                        content_hash,
                        content,
                        _json(locator),
                        _json(change_summary),
                        _now(),
                    ),
                )
        return self.get_document(user_id, document_id, include_content=False)

    def list_documents(self, user_id: str, symbol: str) -> list[dict[str, Any]]:
        symbol = self.normalize_symbol(symbol)
        with self._connect() as connection:
            rows = connection.execute(
                """SELECT d.*, COALESCE(MAX(v.version),0) AS latest_version
                   FROM research_documents d LEFT JOIN research_document_versions v ON v.document_id=d.id
                   WHERE d.user_id=? AND d.symbol=? GROUP BY d.id ORDER BY d.updated_at DESC""",
                (user_id, symbol),
            ).fetchall()
        return [self._document_row(row, []) for row in rows]

    def get_document(
        self, user_id: str, document_id: str, *, include_content: bool = True
    ) -> dict[str, Any]:
        with self._connect() as connection:
            document = connection.execute(
                "SELECT * FROM research_documents WHERE id = ? AND user_id = ?",
                (document_id, user_id),
            ).fetchone()
            if not document:
                raise KeyError(document_id)
            versions = connection.execute(
                "SELECT * FROM research_document_versions WHERE document_id = ? AND user_id = ? ORDER BY version DESC",
                (document_id, user_id),
            ).fetchall()
        parsed_versions = [
            self._document_version_row(row, include_content=include_content) for row in versions
        ]
        return self._document_row(
            document,
            parsed_versions,
            latest_version=parsed_versions[0]["version"] if parsed_versions else 0,
        )

    def _document_row(
        self, row: sqlite3.Row, versions: list[dict], latest_version: int | None = None
    ) -> dict[str, Any]:
        keys = set(row.keys())
        return {
            "id": row["id"],
            "symbol": row["symbol"],
            "title": row["title"],
            "document_type": row["document_type"],
            "source_url": row["source_url"],
            "latest_version": latest_version
            if latest_version is not None
            else (row["latest_version"] if "latest_version" in keys else 0),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "versions": versions,
        }

    def _document_version_row(self, row: sqlite3.Row, *, include_content: bool) -> dict[str, Any]:
        return {
            "id": row["id"],
            "document_id": row["document_id"],
            "version": row["version"],
            "published_at": row["published_at"],
            "content_hash": row["content_hash"],
            "content": row["content_text"] if include_content else None,
            "locator": _loads(row["locator_json"], {}),
            "change_summary": _loads(row["change_summary_json"], {}),
            "fetched_at": row["created_at"],
            "created_at": row["created_at"],
        }

    @staticmethod
    def _document_locator(content: str, page_texts: list[str]) -> dict[str, Any]:
        if not page_texts:
            return {"total_lines": len(content.splitlines()), "pages": []}
        pages = []
        line = 1
        for index, text in enumerate(page_texts, 1):
            count = max(len(text.splitlines()), 1)
            pages.append({"page": index, "start_line": line, "end_line": line + count - 1})
            line += count
        return {"total_lines": line - 1, "pages": pages}

    @staticmethod
    def _document_diff(
        previous: str, current: str, previous_version_id: str | None
    ) -> dict[str, Any]:
        if not previous_version_id:
            return {
                "previous_version_id": None,
                "added_lines": len(current.splitlines()),
                "removed_lines": 0,
                "diff": [],
            }
        diff = list(difflib.unified_diff(previous.splitlines(), current.splitlines(), lineterm=""))
        added = sum(1 for line in diff if line.startswith("+") and not line.startswith("+++"))
        removed = sum(1 for line in diff if line.startswith("-") and not line.startswith("---"))
        return {
            "previous_version_id": previous_version_id,
            "added_lines": added,
            "removed_lines": removed,
            "diff": diff[:500],
        }

    def create_alert_rule(self, user_id: str, request: AlertRuleCreate) -> dict[str, Any]:
        symbol = self.normalize_symbol(request.symbol)
        if request.thesis_snapshot_id:
            self.validate_thesis_symbol(user_id, request.thesis_snapshot_id, symbol)
        now = _now()
        rule_id = _id("rule")
        next_at = (
            datetime.now(UTC) + timedelta(seconds=request.evaluation_interval_seconds)
        ).isoformat()
        with self._connect() as connection:
            connection.execute(
                """INSERT INTO alert_rules
                   (id,user_id,symbol,name,condition_type,operator,threshold_json,severity,thesis_snapshot_id,enabled,
                    channels_json,evaluation_interval_seconds,metadata_json,next_evaluation_at,created_at,updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    rule_id,
                    user_id,
                    symbol,
                    request.name.strip(),
                    request.condition_type,
                    request.operator,
                    _json(request.threshold),
                    request.severity,
                    request.thesis_snapshot_id,
                    int(request.enabled),
                    _json(request.channels),
                    request.evaluation_interval_seconds,
                    _json(request.metadata),
                    next_at,
                    now,
                    now,
                ),
            )
        return self.get_alert_rule(user_id, rule_id)

    def list_alert_rules(
        self, user_id: str | None = None, symbol: str | None = None, *, due_only: bool = False
    ) -> list[dict[str, Any]]:
        clauses, values = [], []
        if user_id is not None:
            clauses.append("user_id = ?")
            values.append(user_id)
        if symbol:
            clauses.append("symbol = ?")
            values.append(self.normalize_symbol(symbol))
        if due_only:
            clauses.extend(
                ["enabled = 1", "(next_evaluation_at IS NULL OR next_evaluation_at <= ?)"]
            )
            values.append(_now())
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        with self._connect() as connection:
            rows = connection.execute(
                f"SELECT * FROM alert_rules{where} ORDER BY updated_at DESC", values
            ).fetchall()
        return [self._alert_rule_row(row) for row in rows]

    def get_alert_rule(self, user_id: str, rule_id: str) -> dict[str, Any]:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM alert_rules WHERE id = ? AND user_id = ?", (rule_id, user_id)
            ).fetchone()
        if not row:
            raise KeyError(rule_id)
        return self._alert_rule_row(row)

    def update_alert_rule(
        self, user_id: str, rule_id: str, request: AlertRuleUpdate
    ) -> dict[str, Any]:
        current = self.get_alert_rule(user_id, rule_id)
        patch = request.model_dump(exclude_unset=True)
        if patch.get("thesis_snapshot_id"):
            self.validate_thesis_symbol(user_id, patch["thesis_snapshot_id"], current["symbol"])
        mapping = {
            "name": "name",
            "operator": "operator",
            "severity": "severity",
            "thesis_snapshot_id": "thesis_snapshot_id",
            "enabled": "enabled",
            "evaluation_interval_seconds": "evaluation_interval_seconds",
        }
        assignments, values = [], []
        for key, column in mapping.items():
            if key in patch:
                assignments.append(f"{column} = ?")
                values.append(int(patch[key]) if key == "enabled" else patch[key])
        for key, column in (
            ("threshold", "threshold_json"),
            ("channels", "channels_json"),
            ("metadata", "metadata_json"),
        ):
            if key in patch:
                assignments.append(f"{column} = ?")
                values.append(_json(patch[key]))
        if "evaluation_interval_seconds" in patch:
            assignments.append("next_evaluation_at = ?")
            values.append(
                (
                    datetime.now(UTC) + timedelta(seconds=int(patch["evaluation_interval_seconds"]))
                ).isoformat()
            )
        if not assignments:
            return current
        assignments.append("updated_at = ?")
        values.append(_now())
        values.extend([rule_id, user_id])
        with self._connect() as connection:
            connection.execute(
                f"UPDATE alert_rules SET {', '.join(assignments)} WHERE id = ? AND user_id = ?",
                values,
            )
        return self.get_alert_rule(user_id, rule_id)

    def delete_alert_rule(self, user_id: str, rule_id: str) -> None:
        with self._connect() as connection:
            cursor = connection.execute(
                "DELETE FROM alert_rules WHERE id = ? AND user_id = ?", (rule_id, user_id)
            )
            if not cursor.rowcount:
                raise KeyError(rule_id)

    def _mark_rule_evaluated(self, rule: dict[str, Any], error: str | None) -> None:
        now = datetime.now(UTC)
        next_at = now + timedelta(seconds=int(rule["evaluation_interval_seconds"]))
        with self._connect() as connection:
            connection.execute(
                "UPDATE alert_rules SET last_evaluated_at=?, next_evaluation_at=?, last_error=?, updated_at=? WHERE id=?",
                (now.isoformat(), next_at.isoformat(), error, now.isoformat(), rule["id"]),
            )

    def mark_rule_error(self, rule: dict[str, Any], error: str) -> None:
        self._mark_rule_evaluated(rule, error[:1000])

    def list_alert_events(
        self,
        user_id: str,
        *,
        symbol: str | None = None,
        status: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        clauses, values = ["user_id = ?"], [user_id]
        if symbol:
            clauses.append("symbol = ?")
            values.append(self.normalize_symbol(symbol))
        if status:
            clauses.append("status = ?")
            values.append(status)
        values.append(min(max(limit, 1), 500))
        with self._connect() as connection:
            rows = connection.execute(
                f"SELECT * FROM alert_events WHERE {' AND '.join(clauses)} ORDER BY occurred_at DESC LIMIT ?",
                values,
            ).fetchall()
        return [self._alert_event_row(row) for row in rows]

    def get_alert_event(self, user_id: str, event_id: str) -> dict[str, Any]:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM alert_events WHERE id=? AND user_id=?", (event_id, user_id)
            ).fetchone()
        if not row:
            raise KeyError(event_id)
        return self._alert_event_row(row)

    def set_alert_status(self, user_id: str, event_id: str, status: str) -> dict[str, Any]:
        if status not in {"unread", "read", "dismissed"}:
            raise ValueError("invalid alert status")
        read_at = _now() if status == "read" else None
        with self._connect() as connection:
            cursor = connection.execute(
                "UPDATE alert_events SET status=?, read_at=? WHERE id=? AND user_id=?",
                (status, read_at, event_id, user_id),
            )
            if not cursor.rowcount:
                raise KeyError(event_id)
        return self.get_alert_event(user_id, event_id)

    def retry_alert_delivery(self, user_id: str, event_id: str) -> dict[str, Any]:
        with self._connect() as connection:
            cursor = connection.execute(
                """UPDATE alert_events SET delivery_status='pending', retry_count=retry_count+1, last_error=NULL
                   WHERE id=? AND user_id=?""",
                (event_id, user_id),
            )
            if not cursor.rowcount:
                raise KeyError(event_id)
        return self.get_alert_event(user_id, event_id)

    def list_pending_deliveries(
        self, user_id: str | None = None, *, limit: int = 100
    ) -> list[dict[str, Any]]:
        """返回待投递事件；后台检查用 user_id=None 扫描，API 场景仍可限定当前用户。"""
        clauses, values = ["delivery_status='pending'"], []
        if user_id is not None:
            clauses.append("user_id=?")
            values.append(user_id)
        values.append(min(max(limit, 1), 500))
        with self._connect() as connection:
            rows = connection.execute(
                f"SELECT * FROM alert_events WHERE {' AND '.join(clauses)} ORDER BY created_at LIMIT ?",
                values,
            ).fetchall()
        results = []
        for row in rows:
            event = self._alert_event_row(row)
            event["user_id"] = row["user_id"]
            results.append(event)
        return results

    def set_alert_delivery_result(
        self, user_id: str, event_id: str, *, delivered: bool, error: str | None = None
    ) -> dict[str, Any]:
        with self._connect() as connection:
            cursor = connection.execute(
                "UPDATE alert_events SET delivery_status=?, last_error=? WHERE id=? AND user_id=?",
                (
                    "delivered" if delivered else "failed",
                    None if delivered else str(error or "delivery failed")[:1000],
                    event_id,
                    user_id,
                ),
            )
            if not cursor.rowcount:
                raise KeyError(event_id)
        return self.get_alert_event(user_id, event_id)

    def _alert_rule_row(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "symbol": row["symbol"],
            "name": row["name"],
            "condition_type": row["condition_type"],
            "operator": row["operator"],
            "threshold": _loads(row["threshold_json"], None),
            "severity": row["severity"],
            "thesis_snapshot_id": row["thesis_snapshot_id"],
            "enabled": bool(row["enabled"]),
            "channels": _loads(row["channels_json"], []),
            "evaluation_interval_seconds": row["evaluation_interval_seconds"],
            "metadata": _loads(row["metadata_json"], {}),
            "last_evaluated_at": row["last_evaluated_at"],
            "next_evaluation_at": row["next_evaluation_at"],
            "last_error": row["last_error"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "user_id": row["user_id"],
        }

    def _alert_event_row(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "rule_id": row["rule_id"],
            "symbol": row["symbol"],
            "fingerprint": row["fingerprint"],
            "severity": row["severity"],
            "title": row["title"],
            "explanation": row["explanation"],
            "source": _loads(row["source_json"], {}),
            "portfolio_context": _loads(row["portfolio_context_json"], {}),
            "thesis_context": _loads(row["thesis_context_json"], {}),
            "status": row["status"],
            "delivery_status": row["delivery_status"],
            "retry_count": row["retry_count"],
            "last_error": row["last_error"],
            "occurred_at": row["occurred_at"],
            "created_at": row["created_at"],
            "read_at": row["read_at"],
        }

    def metric_records(
        self, user_id: str, cutoff: str
    ) -> tuple[list[sqlite3.Row], list[sqlite3.Row]]:
        with self._connect() as connection:
            events = connection.execute(
                "SELECT symbol,severity,status,occurred_at,read_at FROM alert_events WHERE user_id=? AND occurred_at>=?",
                (user_id, cutoff),
            ).fetchall()
            theses = connection.execute(
                "SELECT symbol,created_at FROM thesis_snapshots WHERE user_id=? AND created_at>=?",
                (user_id, cutoff),
            ).fetchall()
        return events, theses

    def insert_alert_event(self, values: tuple[Any, ...]) -> bool:
        """Deduplicate an event atomically through the existing fingerprint constraint."""
        try:
            with self._connect() as connection:
                connection.execute(
                    """INSERT INTO alert_events
                       (id,user_id,rule_id,symbol,fingerprint,severity,title,explanation,source_json,portfolio_context_json,
                        thesis_context_json,status,delivery_status,retry_count,occurred_at,created_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    values,
                )
        except sqlite3.IntegrityError:
            return False
        return True
