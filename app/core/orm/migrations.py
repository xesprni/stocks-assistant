"""Idempotent SQLite schema creation and legacy migrations."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from sqlalchemy.engine import Connection, Engine

from app.core.orm.base import AppBase, PortfolioBase, SessionBase, WatchlistBase


def init_app_schema(engine: Engine) -> None:
    from app.core.orm.models import app  # noqa: F401

    AppBase.metadata.create_all(engine)
    with engine.begin() as conn:
        _ensure_users_profile_schema(conn)
        _ensure_login_sessions_device_schema(conn)
        _ensure_refresh_tokens_session_schema(conn)
        _ensure_mcp_oauth_tokens_schema(conn)


def init_session_schema(engine: Engine) -> None:
    from app.core.orm.models import session  # noqa: F401

    SessionBase.metadata.create_all(engine)
    with engine.begin() as conn:
        cols = _table_columns(conn, "sessions")
        if "user_id" not in cols:
            conn.exec_driver_sql("ALTER TABLE sessions ADD COLUMN user_id TEXT")
        conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS idx_sessions_user_updated ON sessions(user_id, updated_at)")
        conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS idx_messages_session_seq ON messages(session_id, seq)")
        conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS idx_trace_runs_session_started ON trace_runs(session_id, started_at)")
        conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS idx_trace_events_run_seq ON trace_events(run_id, seq)")


def init_watchlist_schema(engine: Engine) -> None:
    from app.core.orm.models import watchlist  # noqa: F401

    WatchlistBase.metadata.create_all(engine)
    with engine.begin() as conn:
        _migrate_watchlist_user_scope(conn)
        conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS idx_watchlist_category ON watchlist_items(category)")
        conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS idx_watchlist_user_category ON watchlist_items(user_id, category)")
        cols = _table_columns(conn, "watchlist_items")
        if "sort_order" not in cols:
            conn.exec_driver_sql("ALTER TABLE watchlist_items ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
            # 旧数据没有排序字段时按 id 初始化，保证前端列表顺序稳定。
            conn.exec_driver_sql(
                """
                UPDATE watchlist_items SET sort_order = (
                    SELECT COUNT(*) FROM watchlist_items w2 WHERE w2.id < watchlist_items.id
                )
                """
            )


def init_portfolio_schema(engine: Engine) -> None:
    from app.core.orm.models import portfolio  # noqa: F401

    PortfolioBase.metadata.create_all(engine)
    with engine.begin() as conn:
        _migrate_portfolio_user_scope(conn)
        conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS idx_portfolio_market ON portfolio_items(market)")
        conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS idx_portfolio_user_market ON portfolio_items(user_id, market)")
        conn.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS idx_portfolio_transactions_user_market_created "
            "ON portfolio_transactions(user_id, market, created_at)"
        )
        conn.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS idx_portfolio_transactions_user_symbol_created "
            "ON portfolio_transactions(user_id, symbol, created_at)"
        )


def migrate_sessions_db_user_scope(db_path: Path, admin_user_id: str) -> None:
    if not db_path.exists():
        return
    engine = _one_off_engine(db_path)
    try:
        with engine.begin() as conn:
            cols = _table_columns(conn, "sessions")
            if "user_id" not in cols:
                conn.exec_driver_sql("ALTER TABLE sessions ADD COLUMN user_id TEXT")
            conn.exec_driver_sql(
                "UPDATE sessions SET user_id = ? WHERE user_id IS NULL OR user_id = ''",
                (admin_user_id,),
            )
    finally:
        engine.dispose()


def migrate_watchlist_db_user_scope(db_path: Path, admin_user_id: str) -> None:
    if not db_path.exists():
        return
    engine = _one_off_engine(db_path)
    try:
        with engine.begin() as conn:
            cols = _table_columns(conn, "watchlist_items")
            if "user_id" not in cols:
                conn.exec_driver_sql("ALTER TABLE watchlist_items ADD COLUMN user_id TEXT NOT NULL DEFAULT ''")
            conn.exec_driver_sql("UPDATE watchlist_items SET user_id = ? WHERE user_id = ''", (admin_user_id,))
            conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS idx_watchlist_user_category ON watchlist_items(user_id, category)")
    finally:
        engine.dispose()


def migrate_portfolio_db_user_scope(db_path: Path, admin_user_id: str) -> None:
    if not db_path.exists():
        return
    engine = _one_off_engine(db_path)
    try:
        with engine.begin() as conn:
            item_cols = _table_columns(conn, "portfolio_items")
            if "user_id" not in item_cols:
                conn.exec_driver_sql("ALTER TABLE portfolio_items ADD COLUMN user_id TEXT NOT NULL DEFAULT ''")
            conn.exec_driver_sql("UPDATE portfolio_items SET user_id = ? WHERE user_id = ''", (admin_user_id,))
            settings_cols = _table_columns(conn, "portfolio_settings")
            if "user_id" not in settings_cols:
                conn.exec_driver_sql("ALTER TABLE portfolio_settings ADD COLUMN user_id TEXT NOT NULL DEFAULT ''")
            conn.exec_driver_sql("UPDATE portfolio_settings SET user_id = ? WHERE user_id = ''", (admin_user_id,))
            transaction_cols = _table_columns(conn, "portfolio_transactions")
            if transaction_cols and "user_id" not in transaction_cols:
                conn.exec_driver_sql("ALTER TABLE portfolio_transactions ADD COLUMN user_id TEXT NOT NULL DEFAULT ''")
            if transaction_cols:
                conn.exec_driver_sql("UPDATE portfolio_transactions SET user_id = ? WHERE user_id = ''", (admin_user_id,))
            conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS idx_portfolio_user_market ON portfolio_items(user_id, market)")
    finally:
        engine.dispose()


def _one_off_engine(db_path: Path) -> Engine:
    from app.core.orm.database import create_sqlite_engine

    return create_sqlite_engine(db_path)


def _table_columns(conn: Connection, table: str) -> set[str]:
    try:
        return {row[1] for row in conn.exec_driver_sql(f"PRAGMA table_info({table})").fetchall()}
    except Exception:
        return set()


def _unique_index_columns(conn: Connection, table: str) -> list[list[str]]:
    columns: list[list[str]] = []
    for index in conn.exec_driver_sql(f"PRAGMA index_list({table})").fetchall():
        if not index[2]:
            continue
        name = index[1]
        columns.append([row[2] for row in conn.exec_driver_sql(f"PRAGMA index_info({name})").fetchall()])
    return columns


def _ensure_refresh_tokens_session_schema(conn: Connection) -> None:
    cols = _table_columns(conn, "refresh_tokens")
    if "session_id" not in cols:
        conn.exec_driver_sql("ALTER TABLE refresh_tokens ADD COLUMN session_id TEXT")
    conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS idx_refresh_tokens_session ON refresh_tokens(session_id)")


def _ensure_login_sessions_device_schema(conn: Connection) -> None:
    cols = _table_columns(conn, "login_sessions")
    if "device_id" not in cols:
        conn.exec_driver_sql("ALTER TABLE login_sessions ADD COLUMN device_id TEXT NOT NULL DEFAULT ''")
        # 旧会话缺少客户端设备标识，回填为自身 session id，避免错误合并历史设备。
        conn.exec_driver_sql("UPDATE login_sessions SET device_id = id WHERE device_id = ''")
    conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS idx_login_sessions_user_device ON login_sessions(user_id, device_id)")


def _ensure_users_profile_schema(conn: Connection) -> None:
    cols = _table_columns(conn, "users")
    if "avatar_base64" not in cols:
        # 头像是用户自定义资料，旧库回填空字符串以保持 UserPublic 响应结构稳定。
        conn.exec_driver_sql("ALTER TABLE users ADD COLUMN avatar_base64 TEXT NOT NULL DEFAULT ''")


def _ensure_mcp_oauth_tokens_schema(conn: Connection) -> None:
    cols = conn.exec_driver_sql("PRAGMA table_info(mcp_oauth_tokens)").fetchall()
    columns = {row[1]: row for row in cols}
    pk_cols = [row[1] for row in sorted(columns.values(), key=lambda item: item[5]) if row[5]]
    if "user_id" in columns and pk_cols == ["user_id", "server_name"]:
        return

    conn.exec_driver_sql("ALTER TABLE mcp_oauth_tokens RENAME TO mcp_oauth_tokens_legacy")
    conn.exec_driver_sql(
        """
        CREATE TABLE mcp_oauth_tokens (
            user_id TEXT NOT NULL DEFAULT '',
            server_name TEXT NOT NULL,
            entry_json TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (user_id, server_name)
        )
        """
    )
    old_cols = _table_columns(conn, "mcp_oauth_tokens_legacy")
    user_expr = "user_id" if "user_id" in old_cols else "'' AS user_id"
    conn.exec_driver_sql(
        f"""
        INSERT OR REPLACE INTO mcp_oauth_tokens (user_id, server_name, entry_json, updated_at)
        SELECT {user_expr}, server_name, entry_json, updated_at
        FROM mcp_oauth_tokens_legacy
        """
    )
    conn.exec_driver_sql("DROP TABLE mcp_oauth_tokens_legacy")


def _migrate_watchlist_user_scope(conn: Connection) -> None:
    cols = _table_columns(conn, "watchlist_items")
    needs_rebuild = "user_id" not in cols
    if not needs_rebuild:
        needs_rebuild = any(index_cols == ["symbol"] for index_cols in _unique_index_columns(conn, "watchlist_items"))
    if not needs_rebuild:
        return

    conn.exec_driver_sql("ALTER TABLE watchlist_items RENAME TO watchlist_items_old")
    conn.exec_driver_sql(
        """
        CREATE TABLE watchlist_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL DEFAULT '',
            category TEXT NOT NULL CHECK (category IN ('US', 'A', 'H')),
            symbol TEXT NOT NULL,
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
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(user_id, symbol)
        )
        """
    )
    old_cols = _table_columns(conn, "watchlist_items_old")
    user_expr = "user_id" if "user_id" in old_cols else "'' AS user_id"
    sort_expr = "sort_order" if "sort_order" in old_cols else "id AS sort_order"
    conn.exec_driver_sql(
        f"""
        INSERT OR IGNORE INTO watchlist_items (
            id, user_id, category, symbol, name, name_cn, name_en, name_hk, exchange,
            currency, last_done, change_value, change_rate, note, sort_order, created_at, updated_at
        )
        SELECT
            id, {user_expr}, category, symbol, name, name_cn, name_en, name_hk, exchange,
            currency, last_done, change_value, change_rate, note, {sort_expr}, created_at, updated_at
        FROM watchlist_items_old
        """
    )
    conn.exec_driver_sql("DROP TABLE watchlist_items_old")


def _migrate_portfolio_user_scope(conn: Connection) -> None:
    _migrate_portfolio_items_user_scope(conn)
    _migrate_portfolio_settings_user_scope(conn)
    _migrate_portfolio_transactions_user_scope(conn)


def _migrate_portfolio_items_user_scope(conn: Connection) -> None:
    cols = _table_columns(conn, "portfolio_items")
    needs_rebuild = "user_id" not in cols
    if not needs_rebuild:
        needs_rebuild = any(index_cols == ["symbol"] for index_cols in _unique_index_columns(conn, "portfolio_items"))
    if not needs_rebuild:
        return

    conn.exec_driver_sql("ALTER TABLE portfolio_items RENAME TO portfolio_items_old")
    conn.exec_driver_sql(
        """
        CREATE TABLE portfolio_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL DEFAULT '',
            market TEXT NOT NULL CHECK (market IN ('US', 'A')),
            symbol TEXT NOT NULL,
            name TEXT NOT NULL DEFAULT '',
            shares TEXT,
            cost_price TEXT,
            note TEXT NOT NULL DEFAULT '',
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(user_id, symbol)
        )
        """
    )
    old_cols = _table_columns(conn, "portfolio_items_old")
    user_expr = "user_id" if "user_id" in old_cols else "'' AS user_id"
    conn.exec_driver_sql(
        f"""
        INSERT OR IGNORE INTO portfolio_items (
            id, user_id, market, symbol, name, shares, cost_price, note,
            sort_order, created_at, updated_at
        )
        SELECT
            id, {user_expr}, market, symbol, name, shares, cost_price, note,
            sort_order, created_at, updated_at
        FROM portfolio_items_old
        """
    )
    conn.exec_driver_sql("DROP TABLE portfolio_items_old")


def _migrate_portfolio_settings_user_scope(conn: Connection) -> None:
    cols = _table_columns(conn, "portfolio_settings")
    needs_rebuild = "user_id" not in cols
    if not needs_rebuild:
        needs_rebuild = any(index_cols == ["market"] for index_cols in _unique_index_columns(conn, "portfolio_settings"))
    if not needs_rebuild:
        return

    conn.exec_driver_sql("ALTER TABLE portfolio_settings RENAME TO portfolio_settings_old")
    conn.exec_driver_sql(
        """
        CREATE TABLE portfolio_settings (
            user_id TEXT NOT NULL DEFAULT '',
            market TEXT NOT NULL CHECK (market IN ('US', 'A')),
            total_capital TEXT NOT NULL DEFAULT '0',
            updated_at TEXT NOT NULL,
            PRIMARY KEY(user_id, market)
        )
        """
    )
    old_cols = _table_columns(conn, "portfolio_settings_old")
    user_expr = "user_id" if "user_id" in old_cols else "'' AS user_id"
    conn.exec_driver_sql(
        f"""
        INSERT OR IGNORE INTO portfolio_settings (user_id, market, total_capital, updated_at)
        SELECT {user_expr}, market, total_capital, updated_at
        FROM portfolio_settings_old
        """
    )
    conn.exec_driver_sql("DROP TABLE portfolio_settings_old")


def _migrate_portfolio_transactions_user_scope(conn: Connection) -> None:
    cols = _table_columns(conn, "portfolio_transactions")
    if not cols or "user_id" in cols:
        return
    conn.exec_driver_sql("ALTER TABLE portfolio_transactions ADD COLUMN user_id TEXT NOT NULL DEFAULT ''")
