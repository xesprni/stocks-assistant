"""SQLite resource and schema owner shared by the Labs repositories."""

from __future__ import annotations

import sqlite3
import threading
from collections.abc import Iterator
from contextlib import closing, contextmanager
from pathlib import Path


class LabsDatabase:
    def __init__(self, db_path: str | Path) -> None:
        self.db_path = Path(db_path).expanduser()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.write_lock = threading.RLock()
        self._init_schema()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        # sqlite3 的事务上下文不会关闭连接；数据库资源由这一入口显式释放。
        with closing(sqlite3.connect(self.db_path, timeout=30)) as connection:
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA busy_timeout=15000")
            with connection:
                yield connection

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
            connection.execute("""CREATE TABLE IF NOT EXISTS ai_runs (
                id TEXT PRIMARY KEY, user_id TEXT NOT NULL, lab TEXT NOT NULL,
                status TEXT NOT NULL, created_at TEXT NOT NULL, payload_json TEXT NOT NULL
            )""")
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_labs_ai_user ON ai_runs(user_id,lab,created_at DESC)"
            )
