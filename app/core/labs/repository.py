"""SQLite persistence for valuation model versions."""

from __future__ import annotations

import sqlite3
import threading
import uuid
from pathlib import Path
from typing import Any

from app.core.research.utils import _json, _loads, _now
from app.schemas.labs import ValuationModelCreate


class ValuationRepository:
    """Keep atomic version allocation independent from valuation calculations."""

    def __init__(self, db_path: str | Path) -> None:
        self.db_path = Path(db_path).expanduser()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.write_lock = threading.RLock()
        self._init_schema()

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout=15000")
        return connection

    def _init_schema(self) -> None:
        with self.connect() as connection:
            # journal_mode 是数据库级持久设置，只在初始化时协商，避免每次查询
            # 都触发额外锁竞争。
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA synchronous=NORMAL")
            connection.execute(
                """CREATE TABLE IF NOT EXISTS valuation_models (
                    id TEXT PRIMARY KEY, model_key TEXT NOT NULL, user_id TEXT NOT NULL, symbol TEXT NOT NULL,
                    version INTEGER NOT NULL, model_type TEXT NOT NULL, title TEXT NOT NULL,
                    assumptions_json TEXT NOT NULL, peer_symbols_json TEXT NOT NULL, result_json TEXT NOT NULL,
                    source_ids_json TEXT NOT NULL, thesis_snapshot_id TEXT, reason TEXT NOT NULL, created_at TEXT NOT NULL,
                    UNIQUE(user_id, model_key, version)
                )"""
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_valuation_user_symbol ON valuation_models(user_id,symbol,created_at DESC)"
            )

    def save_model(
        self,
        user_id: str,
        symbol: str,
        model_key: str,
        request: ValuationModelCreate,
        result: dict[str, Any],
        peer_symbols: list[str],
        *,
        connection: sqlite3.Connection | None = None,
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
        if connection is not None:
            return insert(connection)
        # 版本读取及写入处于同一写事务，保留独立仓储实例间的并发约束。
        with self.write_lock, self.connect() as owned_connection:
            owned_connection.execute("BEGIN IMMEDIATE")
            insert(owned_connection)
        return self.get_model(user_id, model_id)

    def list_models(self, user_id: str, symbol: str | None = None) -> list[dict[str, Any]]:
        clauses, values = ["user_id=?"], [user_id]
        if symbol:
            clauses.append("symbol=?")
            values.append(symbol)
        with self.connect() as connection:
            rows = connection.execute(
                f"SELECT * FROM valuation_models WHERE {' AND '.join(clauses)} ORDER BY created_at DESC",
                values,
            ).fetchall()
        return [self._valuation_row(row) for row in rows]

    def get_model(self, user_id: str, model_id: str) -> dict[str, Any]:
        with self.connect() as connection:
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
