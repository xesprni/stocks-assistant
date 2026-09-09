"""SQLite persistence for valuation model versions."""

from __future__ import annotations

import json
import sqlite3
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.core.labs.database import LabsDatabase
from app.core.research.utils import _json, _loads, _now
from app.schemas.labs import ValuationModelCreate


class ValuationRepository:
    """Keep atomic version allocation independent from valuation calculations."""

    def __init__(
        self,
        db_path: str | Path,
        *,
        database: LabsDatabase | None = None,
        connection: sqlite3.Connection | None = None,
    ) -> None:
        self.database = database or LabsDatabase(db_path)
        self.db_path = self.database.db_path
        self._connection = connection

    @contextmanager
    def _read(self) -> Iterator[sqlite3.Connection]:
        if self._connection is not None:
            yield self._connection
        else:
            with self.database.connect() as connection:
                yield connection

    def save_model(
        self,
        user_id: str,
        symbol: str,
        model_key: str,
        request: ValuationModelCreate,
        result: dict[str, Any],
        peer_symbols: list[str],
    ) -> dict[str, Any]:
        model_id = f"val_{uuid.uuid4().hex[:20]}"

        def insert(active_connection: sqlite3.Connection) -> dict[str, Any]:
            version = int(
                active_connection.execute(
                    "SELECT COALESCE(MAX(version),0)+1 FROM valuation_models WHERE user_id=? AND model_key=?",
                    (user_id, model_key),
                ).fetchone()[0]
            )
            active_connection.execute(
                """INSERT INTO valuation_models
                   (id,model_key,user_id,symbol,version,model_type,title,assumptions_json,peer_symbols_json,result_json,
                    source_ids_json,thesis_snapshot_id,reason,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    model_id,
                    model_key,
                    user_id,
                    symbol,
                    version,
                    request.model_type,
                    request.title.strip(),
                    _json(request.assumptions),
                    _json(peer_symbols),
                    _json(result),
                    _json(request.source_ids),
                    request.thesis_snapshot_id,
                    request.reason,
                    _now(),
                ),
            )
            row = active_connection.execute(
                "SELECT * FROM valuation_models WHERE id=? AND user_id=?", (model_id, user_id)
            ).fetchone()
            return self._valuation_row(row)

        # AI 实验传入同一事务，仓储不能提交该连接，避免报告失败后留下孤立模型。
        if self._connection is not None:
            return insert(self._connection)
        # 版本读取及写入处于同一写事务，保留独立仓储实例间的并发约束。
        with self.database.write_lock, self.database.connect() as owned_connection:
            owned_connection.execute("BEGIN IMMEDIATE")
            insert(owned_connection)
        return self.get_model(user_id, model_id)

    def list_models(self, user_id: str, symbol: str | None = None) -> list[dict[str, Any]]:
        clauses, values = ["user_id=?"], [user_id]
        if symbol:
            clauses.append("symbol=?")
            values.append(symbol)
        with self._read() as connection:
            rows = connection.execute(
                f"SELECT * FROM valuation_models WHERE {' AND '.join(clauses)} ORDER BY created_at DESC",
                values,
            ).fetchall()
        return [self._valuation_row(row) for row in rows]

    def get_model(self, user_id: str, model_id: str) -> dict[str, Any]:
        with self._read() as connection:
            row = connection.execute(
                "SELECT * FROM valuation_models WHERE id=? AND user_id=?", (model_id, user_id)
            ).fetchone()
        if not row:
            raise KeyError(model_id)
        return self._valuation_row(row)

    @staticmethod
    def _valuation_row(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "model_key": row["model_key"],
            "symbol": row["symbol"],
            "version": row["version"],
            "model_type": row["model_type"],
            "title": row["title"],
            "assumptions": _loads(row["assumptions_json"], {}),
            "peer_symbols": _loads(row["peer_symbols_json"], []),
            "result": _loads(row["result_json"], {}),
            "source_ids": _loads(row["source_ids_json"], []),
            "thesis_snapshot_id": row["thesis_snapshot_id"],
            "reason": row["reason"],
            "created_at": row["created_at"],
        }


class LabRunRepository:
    """Persist run records without knowing agents, runtime state or valuation use cases."""

    def __init__(
        self, database: LabsDatabase, *, connection: sqlite3.Connection | None = None
    ) -> None:
        self.database = database
        self._connection = connection

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        if self._connection is not None:
            yield self._connection
        else:
            with self.database.connect() as connection:
                yield connection

    def create(self, user_id: str, run: dict[str, Any]) -> None:
        payload = json.dumps(run, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO ai_runs VALUES (?,?,?,?,?,?)",
                (run["id"], user_id, run["lab"], run["status"], run["created_at"], payload),
            )

    def get(self, user_id: str, run_id: str) -> dict[str, Any]:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT payload_json FROM ai_runs WHERE id=? AND user_id=?", (run_id, user_id)
            ).fetchone()
        if not row:
            raise KeyError(run_id)
        return json.loads(row[0])

    def list(self, user_id: str, lab: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
        values: list[Any] = [user_id]
        clause = "user_id=?"
        if lab:
            clause += " AND lab=?"
            values.append(lab)
        values.append(max(1, min(limit, 50)))
        with self._connect() as connection:
            rows = connection.execute(
                # 在 SQLite 中去除历史列表不需要的大型报告和证据正文。
                "SELECT json_set(payload_json,'$.report','','$.artifacts',json('[]'),"
                "'$.warnings',json('[]')) "
                f"FROM ai_runs WHERE {clause} ORDER BY created_at DESC LIMIT ?",
                values,
            ).fetchall()
        return [json.loads(row[0]) for row in rows]

    def update_running(self, user_id: str, run: dict[str, Any]) -> bool:
        # 终态的条件更新与模型写入共用事务，迟到的回调不能改写取消/超时。
        payload = json.dumps(run, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
        with self._connect() as connection:
            updated = connection.execute(
                "UPDATE ai_runs SET status=?,payload_json=? "
                "WHERE id=? AND user_id=? AND status='running'",
                (run["status"], payload, run["id"], user_id),
            )
            return updated.rowcount == 1


@dataclass(frozen=True)
class LabsTransaction:
    models: ValuationRepository
    runs: LabRunRepository


class LabsUnitOfWork:
    def __init__(self, database: LabsDatabase) -> None:
        self.database = database

    @contextmanager
    def transaction(self) -> Iterator[LabsTransaction]:
        # 原子分配版本、保存模型并完成报告；任何失败（包括取消）均整体回滚。
        with self.database.write_lock, self.database.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            yield LabsTransaction(
                ValuationRepository(
                    self.database.db_path, database=self.database, connection=connection
                ),
                LabRunRepository(self.database, connection=connection),
            )
