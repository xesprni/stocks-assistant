import sqlite3
import tempfile
import unittest
from pathlib import Path

from app.core.orm.repositories.portfolio import PortfolioRepository
from app.core.orm.repositories.watchlist import WatchlistRepository
from app.core.session import ChatSessionStore
from app.core.tracing import TraceStore


class ORMRepositoryMigrationTest(unittest.TestCase):
    def test_session_delete_cascades_trace_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            chat = ChatSessionStore(tmp)
            session = chat.create_session(title="trace")
            trace = TraceStore(tmp)
            run = trace.create_run(session_id=session["id"], user_message="hello")
            trace.add_event(run_id=run["run_id"], node_type="llm", title="LLM", parent_id=run["root_event_id"])
            self.assertEqual(len(trace.get_session_traces(session_id=session["id"])["runs"]), 1)

            chat.delete_session(session["id"])

            self.assertEqual(trace.get_session_traces(session_id=session["id"])["runs"], [])

    def test_watchlist_repository_rebuilds_legacy_symbol_unique_table(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "watchlist.db"
            with sqlite3.connect(db_path) as conn:
                conn.executescript(
                    """
                    CREATE TABLE watchlist_items (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        category TEXT NOT NULL CHECK (category IN ('US', 'A', 'H')),
                        symbol TEXT NOT NULL UNIQUE,
                        name TEXT NOT NULL DEFAULT '',
                        name_cn TEXT NOT NULL DEFAULT '',
                        name_en TEXT NOT NULL DEFAULT '',
                        name_hk TEXT NOT NULL DEFAULT '',
                        exchange TEXT NOT NULL DEFAULT '',
                        currency TEXT NOT NULL DEFAULT '',
                        last_done TEXT,
                        change_value TEXT,
                        change_rate TEXT,
                        note TEXT NOT NULL DEFAULT '',
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    );
                    INSERT INTO watchlist_items (
                        category, symbol, name, created_at, updated_at
                    ) VALUES ('US', 'MSFT.US', 'Microsoft', '2026-01-01T00:00:00', '2026-01-01T00:00:00');
                    """
                )

            repository = WatchlistRepository(db_path)
            legacy = repository.list_items(user_id="")
            self.assertEqual(legacy[0]["user_id"], "")
            self.assertEqual(legacy[0]["sort_order"], 1)

            repository.add_item(
                {
                    "user_id": "user-2",
                    "category": "US",
                    "symbol": "MSFT.US",
                    "name": "Microsoft",
                    "name_cn": "",
                    "name_en": "",
                    "name_hk": "",
                    "exchange": "",
                    "currency": "",
                    "last_done": None,
                    "change_value": None,
                    "change_rate": None,
                    "note": "",
                    "created_at": "2026-01-02T00:00:00",
                    "updated_at": "2026-01-02T00:00:00",
                }
            )
            self.assertEqual(len(repository.list_items()), 2)

    def test_portfolio_repository_rebuilds_legacy_user_scope_tables(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "portfolio.db"
            with sqlite3.connect(db_path) as conn:
                conn.executescript(
                    """
                    CREATE TABLE portfolio_items (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        market TEXT NOT NULL CHECK (market IN ('US', 'A')),
                        symbol TEXT NOT NULL UNIQUE,
                        name TEXT NOT NULL DEFAULT '',
                        shares TEXT,
                        cost_price TEXT,
                        note TEXT NOT NULL DEFAULT '',
                        sort_order INTEGER NOT NULL DEFAULT 0,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    );
                    CREATE TABLE portfolio_settings (
                        market TEXT PRIMARY KEY,
                        total_capital TEXT NOT NULL DEFAULT '0',
                        updated_at TEXT NOT NULL
                    );
                    INSERT INTO portfolio_items (
                        market, symbol, name, shares, cost_price, created_at, updated_at
                    ) VALUES ('US', 'MSFT.US', 'Microsoft', '10', '80', '2026-01-01T00:00:00', '2026-01-01T00:00:00');
                    INSERT INTO portfolio_settings (market, total_capital, updated_at)
                    VALUES ('US', '10000', '2026-01-01T00:00:00');
                    """
                )

            repository = PortfolioRepository(db_path)
            self.assertEqual(repository.list_items("US", user_id="")[0]["user_id"], "")
            self.assertEqual(repository.get_settings("US", user_id="")["total_capital"], "10000")

            repository.add_item(
                {
                    "user_id": "user-2",
                    "market": "US",
                    "symbol": "MSFT.US",
                    "name": "Microsoft",
                    "shares": "1",
                    "cost_price": "2",
                    "note": "",
                    "created_at": "2026-01-02T00:00:00",
                    "updated_at": "2026-01-02T00:00:00",
                }
            )
            self.assertEqual(len(repository.list_items("US")), 1)
            self.assertEqual(len(repository.list_items("US", user_id="user-2")), 1)


if __name__ == "__main__":
    unittest.main()

