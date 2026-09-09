import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from email.utils import format_datetime
from unittest.mock import Mock

import httpx
import pytest

from app.core.memory.embedding import EmbeddingUnavailableError, OpenAIEmbeddingProvider


@pytest.fixture
def embedding_clock(monkeypatch):
    clock = {"monotonic": 100.0, "time": 1_800_000_000.0}
    monkeypatch.setattr("app.core.memory.embedding.time.monotonic", lambda: clock["monotonic"])
    monkeypatch.setattr("app.core.memory.embedding.time.time", lambda: clock["time"])
    return clock


def _response(status, *, headers=None, payload=None):
    request = httpx.Request("POST", "https://example.invalid/embeddings?token=private-value")
    return httpx.Response(
        status,
        headers=headers,
        json=payload if payload is not None else {"error": "private-response-body"},
        request=request,
    )


def _provider():
    return OpenAIEmbeddingProvider(api_key="test-placeholder")


@pytest.mark.parametrize("status", [401, 403, 404, 405, 501])
def test_configuration_failure_uses_long_cooldown(monkeypatch, embedding_clock, status):
    post = Mock(
        side_effect=[
            _response(status),
            _response(200, payload={"data": [{"embedding": [1.0, 0.0]}]}),
        ]
    )
    monkeypatch.setattr("app.core.memory.embedding.httpx.post", post)
    provider = _provider()

    with pytest.raises(EmbeddingUnavailableError, match=f"HTTP {status}"):
        provider.embed("first")
    assert provider.in_cooldown
    embedding_clock["monotonic"] += 299
    with pytest.raises(EmbeddingUnavailableError, match=f"HTTP {status}"):
        provider.embed_batch(["second"])
    assert post.call_count == 1

    embedding_clock["monotonic"] += 1
    assert not provider.in_cooldown
    assert provider.embed("after cooldown") == [1.0, 0.0]
    assert post.call_count == 2


@pytest.mark.parametrize(
    ("retry_after", "delay"),
    [(None, 60), ("90", 90), ("invalid", 60), ("-1", 60), ("0", 60), ("nan", 60)],
)
def test_429_honors_retry_after_and_recovers(monkeypatch, embedding_clock, retry_after, delay):
    headers = {"Retry-After": retry_after} if retry_after is not None else {}
    post = Mock(
        side_effect=[
            _response(429, headers=headers),
            _response(200, payload={"data": [{"embedding": [1.0]}]}),
        ]
    )
    monkeypatch.setattr("app.core.memory.embedding.httpx.post", post)
    provider = _provider()
    with pytest.raises(EmbeddingUnavailableError, match="HTTP 429"):
        provider.embed("first")

    embedding_clock["monotonic"] += delay - 1
    with pytest.raises(EmbeddingUnavailableError, match="HTTP 429"):
        provider.embed("during cooldown")
    assert post.call_count == 1
    embedding_clock["monotonic"] += 1
    assert provider.embed("after cooldown") == [1.0]


def test_retry_after_supports_http_date(monkeypatch, embedding_clock):
    retry_after = format_datetime(
        datetime.fromtimestamp(embedding_clock["time"] + 120, tz=UTC), usegmt=True
    )
    post = Mock(
        side_effect=[
            _response(429, headers={"Retry-After": retry_after}),
            _response(200, payload={"data": [{"embedding": [1.0]}]}),
        ]
    )
    monkeypatch.setattr("app.core.memory.embedding.httpx.post", post)
    provider = _provider()
    with pytest.raises(EmbeddingUnavailableError):
        provider.embed("first")

    embedding_clock["monotonic"] += 119
    with pytest.raises(EmbeddingUnavailableError):
        provider.embed("during cooldown")
    assert post.call_count == 1
    embedding_clock["monotonic"] += 1
    assert provider.embed("after cooldown") == [1.0]


@pytest.mark.parametrize("failure", ["http", "transport", "invalid_url", "invalid_json"])
def test_failures_are_safe_and_cool_down(monkeypatch, embedding_clock, failure):
    post = Mock()
    delay = 15
    if failure == "http":
        post.return_value = _response(503)
    elif failure == "transport":
        post.side_effect = httpx.ConnectError("private-value private-response-body")
    elif failure == "invalid_url":
        post.side_effect = httpx.InvalidURL("private-value private-response-body")
        delay = 300
    else:
        post.return_value = httpx.Response(
            200,
            text="private-response-body",
            request=httpx.Request("POST", "https://example.invalid"),
        )
    monkeypatch.setattr("app.core.memory.embedding.httpx.post", post)
    provider = _provider()
    with pytest.raises(EmbeddingUnavailableError) as caught:
        provider.embed("first")
    error = str(caught.value)
    assert "check embedding configuration" in error
    assert "private-value" not in error
    assert "private-response-body" not in error
    assert "example.invalid" not in error
    assert "test-placeholder" not in error

    embedding_clock["monotonic"] += delay - 1
    with pytest.raises(EmbeddingUnavailableError):
        provider.embed("during cooldown")
    assert post.call_count == 1
    post.side_effect = None
    post.return_value = _response(200, payload={"data": [{"embedding": [1.0]}]})
    embedding_clock["monotonic"] += 1
    assert provider.embed("after cooldown") == [1.0]


def test_concurrent_search_and_index_send_only_one_rate_limited_request(
    monkeypatch, embedding_clock
):
    start = threading.Barrier(8)
    post = Mock(return_value=_response(429))
    monkeypatch.setattr("app.core.memory.embedding.httpx.post", post)
    provider = _provider()

    def call(index):
        start.wait(timeout=5)
        with pytest.raises(EmbeddingUnavailableError, match="HTTP 429"):
            if index % 2:
                provider.embed("query")
            else:
                provider.embed_batch(["index content"])

    with ThreadPoolExecutor(max_workers=8) as executor:
        list(executor.map(call, range(8)))
    assert post.call_count == 1


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"data": []},
        {"data": [None, None]},
        {"data": [{"embedding": [1.0]}]},
        {"data": [{"embedding": []}, {"embedding": [1.0]}]},
        {"data": [{"embedding": ["private-response-body"]}, {"embedding": [1.0]}]},
        {"data": [{"embedding": [float("inf")]}, {"embedding": [1.0]}]},
        {"data": [{"embedding": [True]}, {"embedding": [1.0]}]},
        {"data": [{"embedding": [1.0, 2.0]}, {"embedding": [1.0]}]},
        {"data": [{"index": 0, "embedding": [1.0]}, {"index": 0, "embedding": [2.0]}]},
        {"data": [{"index": 0, "embedding": [1.0]}, {"embedding": [2.0]}]},
        {"data": [{"index": -1, "embedding": [1.0]}, {"index": 1, "embedding": [2.0]}]},
    ],
)
def test_invalid_embedding_payload_cools_down_without_returning_partial_batch(
    monkeypatch, embedding_clock, payload
):
    # Mock JSON 结果也覆盖真实 JSON 无法编码的非有限值。
    response = Mock()
    response.json.return_value = payload
    post = Mock(return_value=response)
    monkeypatch.setattr("app.core.memory.embedding.httpx.post", post)
    provider = _provider()

    with pytest.raises(EmbeddingUnavailableError, match="invalid response") as caught:
        provider.embed_batch(["first chunk", "second chunk"])
    assert "private-response-body" not in str(caught.value)
    with pytest.raises(EmbeddingUnavailableError):
        provider.embed("during cooldown")
    assert post.call_count == 1
    embedding_clock["monotonic"] += 15
    post.return_value = _response(200, payload={"data": [{"embedding": [1.0]}]})
    assert provider.embed("after cooldown") == [1.0]


def test_batch_embeddings_follow_response_indexes(monkeypatch, embedding_clock):
    post = Mock(
        return_value=_response(
            200,
            payload={
                "data": [
                    {"index": 1, "embedding": [2.0]},
                    {"index": 0, "embedding": [1.0]},
                ]
            },
        )
    )
    monkeypatch.setattr("app.core.memory.embedding.httpx.post", post)
    assert _provider().embed_batch(["first", "second"]) == [[1.0], [2.0]]


def test_cooldown_check_does_not_wait_for_in_flight_request(monkeypatch, embedding_clock):
    entered = threading.Event()
    release = threading.Event()

    def post(*args, **kwargs):
        entered.set()
        assert release.wait(timeout=5)
        return _response(200, payload={"data": [{"embedding": [1.0]}]})

    monkeypatch.setattr("app.core.memory.embedding.httpx.post", post)
    provider = _provider()
    with ThreadPoolExecutor(max_workers=2) as executor:
        request = executor.submit(provider.embed, "first")
        try:
            assert entered.wait(timeout=5)
            cooldown = executor.submit(lambda: provider.in_cooldown)
            assert cooldown.result(timeout=1) is False
        finally:
            release.set()
        assert request.result(timeout=5) == [1.0]
