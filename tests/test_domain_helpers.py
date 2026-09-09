"""Regression coverage for shared extraction, search scope and valuation policies."""

from collections.abc import Iterator
from decimal import Decimal
from pathlib import Path

import pytest

from app.core.dashboard.service import DashboardService
from app.core.knowledge.service import _HTMLTextExtractor as KnowledgeHTML
from app.core.market.errors import LongbridgeUnavailableError
from app.core.market.utils import change_rate, change_value
from app.core.memory.storage import MemoryChunk, MemoryStorage
from app.core.news.service import _HTMLTextExtractor as NewsHTML
from app.core.portfolio.service import PortfolioService
from app.core.portfolio.valuation import money, pnl_ratio, position_ratio, ratio
from app.core.watchlist.service import LongbridgeUnavailableError as LegacyLongbridgeError


def test_html_extraction_preserves_domain_title_and_paragraph_policies() -> None:
    source = (
        "<title> Company &amp; Co </title><aside>Sidebar</aside><main>Body</main>"
        "<script>secret()</script><style>hidden</style>"
        "<p>Hello <b>world</b></p><p>Next</p>"
    )
    knowledge, news = KnowledgeHTML(), NewsHTML()
    knowledge.feed(source)
    news.feed(source)
    assert knowledge.title == "Company & Co"
    assert knowledge.text == "Sidebar\n\nBody\n\nHello world\n\nNext"
    assert news.text == "Company & Co Sidebar Body\nHello world\n\nNext"


@pytest.mark.parametrize("extractor_type", [KnowledgeHTML, NewsHTML])
def test_html_nested_hidden_content_entities_and_empty_blocks(extractor_type: type) -> None:
    extractor = extractor_type()
    extractor.feed("<p></p><svg><svg>hidden</svg>hidden</svg><p>A&nbsp;B</p><p></p>")
    assert extractor.text == "A B"


@pytest.fixture
def memory_storage(tmp_path: Path) -> Iterator[MemoryStorage]:
    storage = MemoryStorage(tmp_path / "memory.db")
    records = [("shared", None), ("user", "alice"), ("user", "bob"), ("session", "alice")]
    storage.save_chunks_batch(
        [
            MemoryChunk(
                id=str(index),
                user_id=user,
                scope=scope,
                source="memory",
                path=f"{index}.md",
                start_line=1,
                end_line=1,
                text="growth 增长",
                embedding=[1.0, 0.0],
                hash=str(index),
            )
            for index, (scope, user) in enumerate(records)
        ]
    )
    try:
        yield storage
    finally:
        storage.close()


@pytest.mark.parametrize("backend", ["vector", "fts", "cjk"])
def test_search_scope_and_user_isolation(memory_storage: MemoryStorage, backend: str) -> None:
    def search(user: str | None, scopes: list[str] | None = None) -> set[str]:
        if backend == "vector":
            results = memory_storage.search_vector([1.0, 0.0], user_id=user, scopes=scopes)
        else:
            memory_storage.fts5_available = backend == "fts"
            results = memory_storage.search_keyword(
                "growth" if backend == "fts" else "增长",
                user_id=user,
                scopes=scopes,
            )
        return {row.path for row in results}

    assert search(None) == {"0.md"}
    assert search("alice") == {"0.md", "1.md"}
    assert search("alice", ["shared", "user", "session"]) == {"0.md", "1.md", "3.md"}
    assert search("alice", []) == set()
    assert search("alice", ["user' OR 1=1 --"]) == set()


def test_keyword_fallback_when_fts_returns_no_english_matches(
    memory_storage: MemoryStorage,
) -> None:
    results = memory_storage.search_keyword("nonexistent 增长", user_id="alice")
    assert {row.path for row in results} == {"0.md", "1.md"}
    assert all(row.score == 0.5 for row in results)


def test_quote_helpers_keep_decimal_precision_and_error_identity() -> None:
    assert LegacyLongbridgeError is LongbridgeUnavailableError
    assert change_value("1.234", "1.000") == "0.234"
    assert change_rate("1.234", "1.000") == "23.40%"
    assert change_rate("1", "0") is None
    assert change_value(None, "1") is None
    assert money(Decimal("0.234")) == "0.23"
    assert ratio(position_ratio(Decimal("10"), Decimal("40"))) == "25.00%"
    assert pnl_ratio(Decimal("0"), Decimal("10")) == Decimal("-100")


def test_portfolio_and_dashboard_keep_distinct_missing_quote_fallbacks(tmp_path: Path) -> None:
    row = {
        "symbol": "AAPL.US",
        "shares": "2",
        "cost_price": "10",
        "current_price": "15",
        "stock_value": "30",
        "pnl_ratio": "50%",
    }
    portfolio = PortfolioService(str(tmp_path))
    items, assets, _ = portfolio._build_enriched_items([row], "0", {}, {})
    assert items[0]["stock_value"] == "20.00"
    assert items[0]["valuation_price_source"] == "cost"
    assert items[0]["pnl_ratio"] is None
    assert assets == "20.00"

    dashboard = object.__new__(DashboardService)
    payload = dashboard._enrich_portfolio_payload({"items": [row], "total_capital": "0"}, {})
    assert payload["items"][0]["stock_value"] == "30.00"
    assert payload["items"][0]["pnl_ratio"] == "50.00%"
    assert payload["total_assets"] == "30.00"
