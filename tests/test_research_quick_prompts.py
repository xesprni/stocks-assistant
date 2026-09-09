import json
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from unittest.mock import Mock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import research as research_api
from app.config import Settings
from app.core.research.quick_prompts import QuickPromptsUnavailableError, ResearchQuickPromptsService
from app.core.security import CurrentUser, get_current_user


PROMPTS = ["如何评估盈利质量？", "哪些风险需要持续跟踪？", "如何比较同业估值？"]


def response_content(content):
    return {"choices": [{"message": {"content": content}}]}


class FakeProvider:
    def __init__(self):
        self.calls = []
        self.content = json.dumps({"prompts": PROMPTS}, ensure_ascii=False)
        self.failure = None

    def call(self, request):
        self.calls.append(request)
        if self.failure:
            raise self.failure
        return response_content(self.content)


class FakeStreamProvider(FakeProvider):
    def __init__(self):
        super().__init__()
        self.stream_calls = []
        self.closed_streams = 0
        self.chunks = []

    def call_stream(self, request):
        self.stream_calls.append(request)
        try:
            for chunk in self.chunks:
                if isinstance(chunk, Exception):
                    raise chunk
                yield chunk
        finally:
            self.closed_streams += 1


class ResearchQuickPromptsServiceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.now = 1_789_000_000.0
        self.provider = FakeProvider()
        self.factory = Mock(return_value=self.provider)
        self.settings = Settings(workspace_dir=self.tmp.name, llm_api_key="test-key")
        self.service = self.make_service()

    def make_service(self, **kwargs):
        return ResearchQuickPromptsService(
            self.tmp.name,
            llm_provider_factory=self.factory,
            now=lambda: self.now,
            **kwargs,
        )

    def get(self, user_id="user-1", **kwargs):
        kwargs.setdefault("language", "zh")
        kwargs.setdefault("settings", self.settings)
        return self.service.get_prompts(user_id, **kwargs)

    def test_default_cache_lasts_one_hour_and_refreshes_at_expiry(self):
        first = self.get()
        generated = datetime.fromisoformat(first["generated_at"])
        expires = datetime.fromisoformat(first["expires_at"])
        self.assertIsNotNone(generated.tzinfo)
        self.assertEqual(3600, first["refresh_interval_seconds"])
        self.assertEqual(3600, (expires - generated).total_seconds())
        self.assertEqual(PROMPTS, first["prompts"])
        self.assertFalse(first["stale"])

        self.now += 3599
        self.assertEqual(first, self.get())
        self.assertEqual(1, len(self.provider.calls))

        self.now += 1
        refreshed = self.get()
        self.assertEqual(2, len(self.provider.calls))
        self.assertNotEqual(first["generated_at"], refreshed["generated_at"])

    def test_cached_prompts_survive_service_recreation(self):
        first = self.get()
        self.service = self.make_service()
        self.now += 100

        self.assertEqual(first, self.get())
        self.assertEqual(1, len(self.provider.calls))
        self.assertTrue((Path(self.tmp.name) / "research" / "quick_prompts.db").is_file())

    def test_cache_age_starts_when_generation_finishes(self):
        started_at = self.now
        original_call = self.provider.call

        def delayed_call(request):
            self.now += 30
            return original_call(request)

        self.provider.call = delayed_call
        result = self.get()

        self.assertEqual(started_at + 30, datetime.fromisoformat(result["generated_at"]).timestamp())
        self.assertEqual(started_at + 30 + 3600, datetime.fromisoformat(result["expires_at"]).timestamp())

    def test_shorter_configured_interval_applies_to_existing_cache(self):
        first = self.get()
        shorter = self.settings.model_copy(update={"research_quick_prompts_refresh_seconds": 600})
        self.now += 599
        cached = self.get(settings=shorter)
        self.assertEqual(first["generated_at"], cached["generated_at"])
        self.assertEqual(600, cached["refresh_interval_seconds"])
        self.assertEqual(
            600,
            (datetime.fromisoformat(cached["expires_at"]) - datetime.fromisoformat(cached["generated_at"])).total_seconds(),
        )

        self.now += 1
        self.get(settings=shorter)
        self.assertEqual(2, len(self.provider.calls))

    def test_longer_configured_interval_extends_existing_cache(self):
        first = self.get()
        self.now += 3601
        longer = self.settings.model_copy(update={"research_quick_prompts_refresh_seconds": 7200})
        cached = self.get(settings=longer)

        self.assertEqual(1, len(self.provider.calls))
        self.assertEqual(first["generated_at"], cached["generated_at"])
        self.assertEqual(7200, cached["refresh_interval_seconds"])
        self.assertFalse(cached["stale"])

    def test_force_refresh_replaces_unexpired_cache(self):
        first = self.get()
        replacement = ["如何核验现金流？", "如何识别需求变化？", "如何建立观察清单？"]
        self.provider.content = json.dumps({"prompts": replacement})
        self.now += 1
        refreshed = self.get(force_refresh=True)

        self.assertEqual(replacement, refreshed["prompts"])
        self.assertNotEqual(first["generated_at"], refreshed["generated_at"])
        self.assertEqual(2, len(self.provider.calls))

    def test_cache_isolated_by_user_language_and_context_permissions(self):
        cases = [
            ("user-1", "zh", False, False),
            ("user-2", "zh", False, False),
            ("user-1", "en", False, False),
            ("user-1", "zh", True, False),
            ("user-1", "zh", False, True),
            ("user-1", "zh", True, True),
        ]
        for _ in range(2):
            for user_id, language, watchlist, portfolio in cases:
                self.get(
                    user_id, language=language,
                    can_read_watchlist=watchlist, can_read_portfolio=portfolio,
                )

        self.assertEqual(len(cases), len(self.provider.calls))

    def test_context_services_only_read_authorized_user(self):
        watchlist = Mock()
        watchlist.list_items.return_value = [{"symbol": "AAPL.US", "name": "Apple", "note": "private-note"}]
        portfolio = Mock()
        portfolio.repository.list_items.return_value = [{
            "symbol": "MSFT.US", "name": "Microsoft", "shares": "123456", "cost_price": "987654",
        }]
        self.service = self.make_service(watchlist_service=watchlist, portfolio_service=portfolio)

        self.get()
        watchlist.list_items.assert_not_called()
        portfolio.repository.list_items.assert_not_called()

        self.get(can_read_watchlist=True, can_read_portfolio=True)
        self.assertEqual("user-1", watchlist.list_items.call_args.kwargs["user_id"])
        self.assertTrue(all(
            call.kwargs["user_id"] == "user-1" for call in portfolio.repository.list_items.call_args_list
        ))
        request = self.provider.calls[-1]
        request_text = json.dumps(request.messages, ensure_ascii=False)
        self.assertIn("AAPL.US", request_text)
        self.assertIn("MSFT.US", request_text)
        self.assertNotIn("private-note", request_text)
        self.assertNotIn("123456", request_text)
        self.assertNotIn("987654", request_text)

    def test_fenced_json_and_text_blocks_are_accepted_and_whitespace_normalized(self):
        self.provider.content = [
            {"type": "text", "text": '```json\n{"prompts": ["  First  question?  ", "Second\\nquestion?", "Third question?"]}\n```'},
        ]
        result = self.get()
        self.assertEqual(["First question?", "Second question?", "Third question?"], result["prompts"])

    def test_invalid_ai_output_is_rejected_without_caching(self):
        invalid_contents = [
            "not json",
            json.dumps({"prompts": ["Only one"]}),
            json.dumps({"prompts": ["One", "Two", "Three", "Four"]}),
            json.dumps({"prompts": ["", "Second", "Third"]}),
            json.dumps({"prompts": ["Same question", " Same  question ", "Third"]}),
            json.dumps({"prompts": ["Same question", "SAME QUESTION", "Third"]}),
            json.dumps({"prompts": ["x" * 301, "Second", "Third"]}),
            json.dumps({"prompts": [123, "Second", "Third"]}),
        ]
        for content in invalid_contents:
            with self.subTest(content=content[:100]):
                self.provider.content = content
                with self.assertRaises(QuickPromptsUnavailableError):
                    self.get(force_refresh=True)

        self.provider.content = json.dumps({"prompts": PROMPTS})
        self.assertEqual(PROMPTS, self.get(force_refresh=True)["prompts"])

    def test_failed_refresh_preserves_old_data_and_retries_after_cooldown(self):
        first = self.get()
        self.provider.failure = RuntimeError("provider leaked sk-private-key")
        self.now += 3600
        stale = self.get()

        self.assertEqual(first["prompts"], stale["prompts"])
        self.assertEqual(first["generated_at"], stale["generated_at"])
        self.assertEqual(first["expires_at"], stale["expires_at"])
        self.assertTrue(stale["stale"])
        self.assertTrue(stale["error"])
        self.assertNotIn("sk-private-key", stale["error"])

        self.now += 59
        self.assertTrue(self.get()["stale"])
        self.assertEqual(2, len(self.provider.calls))
        self.provider.failure = None
        self.now += 1
        refreshed = self.get()
        self.assertFalse(refreshed["stale"])
        self.assertFalse(refreshed["error"])
        self.assertEqual(3, len(self.provider.calls))

    def test_failure_without_cache_is_safe_and_force_bypasses_retry_cooldown(self):
        self.provider.failure = RuntimeError("provider leaked sk-private-key")
        with self.assertRaises(QuickPromptsUnavailableError) as caught:
            self.get()
        self.assertNotIn("sk-private-key", str(caught.exception))

        with self.assertRaises(QuickPromptsUnavailableError):
            self.get()
        self.assertEqual(1, len(self.provider.calls))

        self.provider.failure = None
        self.assertEqual(PROMPTS, self.get(force_refresh=True)["prompts"])
        self.assertEqual(2, len(self.provider.calls))

    def test_provider_factory_configuration_error_is_safe(self):
        self.factory.side_effect = ValueError("invalid credential sk-private-key")
        with self.assertRaises(QuickPromptsUnavailableError) as caught:
            self.get()
        self.assertNotIn("sk-private-key", str(caught.exception))

    def test_concurrent_cold_cache_requests_share_one_generation(self):
        barrier = threading.Barrier(6)
        generation_started = threading.Event()
        release_generation = threading.Event()
        original_call = self.provider.call

        def blocked_call(request):
            generation_started.set()
            if not release_generation.wait(timeout=5):
                raise RuntimeError("test did not release generation")
            return original_call(request)

        def get_at_once():
            barrier.wait(timeout=5)
            return self.get()

        self.provider.call = blocked_call
        with ThreadPoolExecutor(max_workers=6) as executor:
            futures = [executor.submit(get_at_once) for _ in range(6)]
            try:
                self.assertTrue(generation_started.wait(timeout=5))
            finally:
                release_generation.set()
            results = [future.result(timeout=5) for future in futures]

        self.assertEqual(1, len(self.provider.calls))
        self.assertTrue(all(result == results[0] for result in results))

    def test_two_service_instances_share_in_progress_generation(self):
        other_service = self.make_service()
        first_generation = threading.Event()
        concurrent_generation = threading.Event()
        second_request_started = threading.Event()
        release_generation = threading.Event()
        call_lock = threading.Lock()
        original_call = self.provider.call

        def blocked_call(request):
            with call_lock:
                if first_generation.is_set():
                    concurrent_generation.set()
                first_generation.set()
            if not release_generation.wait(timeout=5):
                raise RuntimeError("test did not release generation")
            return original_call(request)

        def second_request():
            second_request_started.set()
            return other_service.get_prompts("user-1", language="zh", settings=self.settings)

        self.provider.call = blocked_call
        with ThreadPoolExecutor(max_workers=2) as executor:
            first = executor.submit(self.get)
            try:
                self.assertTrue(first_generation.wait(timeout=5))
                second = executor.submit(second_request)
                self.assertTrue(second_request_started.wait(timeout=5))
                self.assertFalse(concurrent_generation.wait(timeout=0.2))
            finally:
                release_generation.set()
            self.assertEqual(first.result(timeout=5), second.result(timeout=5))

        self.assertEqual(1, len(self.provider.calls))

    def use_stream_provider(self):
        self.provider = FakeStreamProvider()
        self.factory.return_value = self.provider
        self.settings = self.settings.model_copy(update={
            "llm_provider": "openai_responses", "llm_auth_mode": "codex",
        })
        return self.provider

    def test_codex_stream_assembles_public_json_and_ignores_reasoning(self):
        provider = self.use_stream_provider()
        content = json.dumps({"prompts": PROMPTS}, ensure_ascii=False)
        provider.chunks = [
            {"choices": [{"delta": {"reasoning_content": "private reasoning is not JSON"}}]},
            {"choices": [{"delta": {"content": content[:17]}}]},
            {"choices": [{"delta": {"content": content[17:], "reasoning_content": "private conclusion"}}]},
            {"choices": [{"delta": {}, "finish_reason": "stop"}]},
        ]
        result = self.get()

        self.assertEqual(PROMPTS, result["prompts"])
        self.assertFalse(result["stale"])
        self.assertEqual([], provider.calls)
        self.assertEqual(1, len(provider.stream_calls))
        request = provider.stream_calls[0]
        self.assertIsNone(request.max_tokens)
        self.assertTrue(request.thinking_enabled)
        self.assertEqual("low", request.reasoning_effort)
        self.assertEqual(1, provider.closed_streams)
        self.assertEqual(result, self.get())
        self.assertEqual(1, len(provider.stream_calls))

    def test_codex_stream_failure_without_cache_is_safe_and_never_cached(self):
        provider = self.use_stream_provider()
        content = json.dumps({"prompts": PROMPTS})
        provider.chunks = [
            {"choices": [{"delta": {"content": content}}]},
            {"error": {"message": "provider leaked sk-private-key"}},
        ]
        with self.assertRaises(QuickPromptsUnavailableError) as caught:
            self.get()
        self.assertNotIn("sk-private-key", str(caught.exception))
        self.assertEqual(1, provider.closed_streams)
        with self.assertRaises(QuickPromptsUnavailableError):
            self.get()
        self.assertEqual(1, len(provider.stream_calls))

        provider.chunks = [
            {"choices": [{"delta": {"content": content}}]},
            {"choices": [{"delta": {}, "finish_reason": "stop"}]},
        ]
        self.assertEqual(PROMPTS, self.get(force_refresh=True)["prompts"])
        self.assertEqual(2, provider.closed_streams)

    def test_failed_or_truncated_codex_stream_preserves_successful_cache(self):
        first = self.get()
        provider = self.use_stream_provider()
        replacement = ["New first question?", "New second question?", "New third question?"]
        complete_json = {"choices": [{"delta": {"content": json.dumps({"prompts": replacement})}}]}
        stop = {"choices": [{"delta": {}, "finish_reason": "stop"}]}
        failure_cases = {
            "provider error": [complete_json, {"error": {"message": "sk-private-key"}}],
            "transport error": [complete_json, RuntimeError("sk-private-key")],
            "missing completion": [complete_json],
            "truncated JSON": [{"choices": [{"delta": {"content": '{"prompts": ['}}]}, stop],
            "token limit": [complete_json, {"choices": [{"delta": {}, "finish_reason": "length"}]}],
            "oversized output": [{"choices": [{"delta": {"content": "x" * 16385}}]}, stop],
        }
        self.now += 3600
        for name, chunks in failure_cases.items():
            with self.subTest(name=name):
                provider.chunks = chunks
                stale = self.get(force_refresh=True)
                self.assertEqual(first["prompts"], stale["prompts"])
                self.assertEqual(first["generated_at"], stale["generated_at"])
                self.assertEqual(first["expires_at"], stale["expires_at"])
                self.assertTrue(stale["stale"])
                self.assertNotIn("sk-private-key", stale["error"])

        self.assertEqual(len(failure_cases), provider.closed_streams)
        self.service = self.make_service()
        self.assertEqual(first["prompts"], self.get()["prompts"])
        self.assertEqual(len(failure_cases), len(provider.stream_calls))


class ResearchQuickPromptsApiTest(unittest.TestCase):
    def setUp(self):
        self.user = CurrentUser(
            id="user-1", username="researcher", display_name="Researcher", roles=(),
            permissions=frozenset({"chat:write", "watchlist:read"}), is_active=True,
        )
        self.service = Mock()
        self.service.get_prompts.return_value = {
            "prompts": PROMPTS,
            "generated_at": "2026-09-09T00:00:00+00:00",
            "expires_at": "2026-09-09T01:00:00+00:00",
            "refresh_interval_seconds": 3600,
            "stale": False,
            "error": None,
        }
        self.settings = Settings(llm_api_key="test-key")
        app = FastAPI()
        app.include_router(research_api.router, prefix="/api/v1/research")
        app.dependency_overrides[get_current_user] = lambda: self.user
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        service_patcher = patch.object(research_api, "get_research_quick_prompts_service", return_value=self.service)
        settings_patcher = patch.object(research_api, "get_effective_settings", return_value=self.settings)
        self.get_service = service_patcher.start()
        self.addCleanup(service_patcher.stop)
        self.get_settings = settings_patcher.start()
        self.addCleanup(settings_patcher.stop)

    def test_endpoint_passes_effective_settings_user_and_context_permissions(self):
        response = self.client.get("/api/v1/research/quick-prompts?language=en&force_refresh=true")

        self.assertEqual(200, response.status_code, response.text)
        self.assertEqual(PROMPTS, response.json()["prompts"])
        self.get_settings.assert_called_once_with("user-1")
        self.service.get_prompts.assert_called_once_with(
            "user-1", language="en", settings=self.settings, force_refresh=True,
            can_read_watchlist=True, can_read_portfolio=False,
        )

    def test_chat_permission_is_required_before_generating(self):
        self.user = CurrentUser(
            id="user-2", username="reader", display_name="Reader", roles=(),
            permissions=frozenset({"knowledge:read"}), is_active=True,
        )
        response = self.client.get("/api/v1/research/quick-prompts")

        self.assertEqual(403, response.status_code)
        self.service.get_prompts.assert_not_called()

    def test_invalid_language_is_rejected(self):
        response = self.client.get("/api/v1/research/quick-prompts?language=invalid")

        self.assertEqual(422, response.status_code)
        self.service.get_prompts.assert_not_called()

    def test_generation_unavailable_returns_service_unavailable(self):
        self.service.get_prompts.side_effect = QuickPromptsUnavailableError("Quick prompts unavailable")
        response = self.client.get("/api/v1/research/quick-prompts")

        self.assertEqual(503, response.status_code)
        self.assertTrue(response.json()["detail"])


if __name__ == "__main__":
    unittest.main()
