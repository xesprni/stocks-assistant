"""Labs AI 使用真实 Agent 执行器与本地假 Provider，测试不会访问模型或长桥网络。"""

import asyncio
import copy
import json
import tempfile
import threading
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api import labs as labs_api
from app.config import Settings
from app.core.agent.executor import AgentCancelledError
from app.core.labs.ai_service import LabAIRunStore, LabAIRuntime, LabAIService
from app.core.labs.service import InvestmentLabService
from app.core.research.service import ResearchService
from app.core.security import CurrentUser, get_current_user
from app.schemas.labs import LabAIRequest, LabDataRequest


def fake_user(user_id="user-1", permissions=None):
    return CurrentUser(
        user_id,
        user_id,
        user_id,
        (),
        frozenset(
            permissions
            if permissions is not None
            else {
                "chat:write",
                "portfolio:read",
                "fundamentals:read",
                "market:read",
                "knowledge:write",
            }
        ),
        True,
    )


class LabFakePortfolio:
    def __init__(self):
        self.calls = []

    def list_items(self, market, user_id=None, settings=None):
        self.calls.append((market, user_id, settings))
        symbol, currency, price = {
            "US": ("AAA.US", "USD", 120),
            "H": ("00700.HK", "HKD", 400),
            "A": ("600519.SH", "CNY", 1500),
        }[market]
        return {
            "market": market,
            "total_capital": "1000",
            "items": [
                {
                    "symbol": symbol,
                    "shares": "10",
                    "cost_price": str(price * 0.8),
                    "current_price": str(price),
                    "stock_value": str(price * 10),
                    "currency": currency,
                }
            ],
        }


class LabFakeMarket:
    def get_candlesticks(self, symbol, period, count, settings=None):
        return {
            "bars": [
                {"timestamp": 1_700_000_000 + day * 86400, "close": 100 + day + (day % 3)}
                for day in range(45)
            ]
        }

    def get_security_static_info(self, symbols, settings=None):
        return [
            {
                "symbol": symbol,
                "currency": "HKD"
                if symbol.endswith(".HK")
                else "CNY"
                if symbol.endswith((".SH", ".SZ"))
                else "USD",
                "lot_size": 100,
            }
            for symbol in symbols
        ]

    def get_realtime_quotes(self, symbols, settings=None):
        return {
            "source": "Fake Longbridge quote fixture",
            "symbols": symbols,
            "quotes": [
                {"symbol": symbol, "last_done": "150", "timestamp": "2026-09-09T00:00:00Z"}
                for symbol in symbols
            ],
        }


class LabFakeFundamentals:
    def get_security_insights(self, symbol, settings=None):
        return {
            "symbol": symbol,
            "source": "Fake Longbridge fixture",
            "fetched_at": "2026-09-09T00:00:00Z",
            "company": {"name": symbol, "currency": "USD"},
            "valuation": {"pe_ttm_ratio": 20 if symbol == "AAA.US" else 30, "pb_ratio": 2},
            "filings": [],
        }

    def get_financial_reports(self, symbol, settings=None):
        return {
            "symbol": symbol,
            "source": "Fake financial statement fixture",
            "period": "FY2025",
            "currency": "USD",
            "unit": "ones",
            "revenue": 1_000_000,
            "shares_outstanding": 100_000,
            "cash": 200_000,
            "debt": 100_000,
            "net_income": 150_000,
        }


def make_lab_service(workspace):
    return InvestmentLabService(
        workspace,
        portfolio_service=LabFakePortfolio(),
        market_service=LabFakeMarket(),
        fundamental_service=LabFakeFundamentals(),
        research_service=ResearchService(workspace),
    )


def dcf_args(artifact_id="evidence_2"):
    assumptions = {
        "revenue": 1_000_000,
        "shares_outstanding": 100_000,
        "cash": 200_000,
        "debt": 100_000,
        "fcf_margin": 0.15,
        "revenue_growth": 0.05,
        "wacc": 0.1,
        "terminal_growth": 0.02,
        "years": 5,
    }
    evidence = {}
    for field in assumptions:
        if field in {"revenue", "shares_outstanding", "cash", "debt"}:
            evidence[field] = {
                "kind": "source",
                "artifact_id": artifact_id,
                "path": "/" + field,
                "note": "FY2025 USD amounts in single units; shares in single shares",
            }
        else:
            evidence[field] = {
                "kind": "assumption",
                "note": "Explicit illustrative research assumption, not a forecast",
            }
    return {
        "symbol": "AAA.US",
        "title": "AAA.US 基准情景",
        "currency": "USD",
        "model_type": "dcf",
        "assumptions": assumptions,
        "evidence": evidence,
    }


class LabFakeProvider:
    """可供浏览器预览复用的假 Provider；真实 Agent 将调用受限计算工具。"""

    def __init__(self, *, tool_args=None, final=None, block=None, started=None, failure=False):
        self.requests = []
        self.tool_args = tool_args
        self.final = (
            final
            or "## 研究结果\n\n已使用本次采集的来源完成研究。\n\n### 假设与缺口\n\n数据为本地测试样本；增长率和折现率为明确的分析假设。\n\n来源：本次实验的证据卡片。"
        )
        self.block, self.started, self.failure = block, started, failure

    def call(self, request):
        raise AssertionError("Only streaming is expected")

    def call_stream(self, request):
        self.requests.append(request)
        if self.started:
            self.started.set()
        if self.block:
            self.block.wait(3)
        if self.failure:
            raise RuntimeError("private-provider-error fake-secret")
        yield {"choices": [{"delta": {"reasoning_content": "PRIVATE_MODEL_REASONING"}}]}
        if self.tool_args is not None and len(self.requests) == 1:
            yield {
                "choices": [
                    {
                        "delta": {
                            "content": "正在核对估值假设。",
                            "tool_calls": [
                                {
                                    "index": 0,
                                    "id": "fixture_calc",
                                    "function": {
                                        "name": "calculate_lab_valuation",
                                        "arguments": json.dumps(self.tool_args),
                                    },
                                }
                            ],
                        }
                    }
                ]
            }
        else:
            yield {"choices": [{"delta": {"content": self.final}, "finish_reason": "stop"}]}


class LabsAITest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.settings = Settings(
            workspace_dir=self.tmp.name, llm_api_key="fake-secret", llm_model="fake-only"
        )
        self.user = fake_user()
        self.lab = make_lab_service(self.tmp.name)
        self.ai = LabAIService(self.lab, timeout_seconds=3)

    def tearDown(self):
        self.tmp.cleanup()

    def collect(self, request, provider, user=None):
        async def run():
            return [
                event
                async for event in self.ai.stream(
                    user or self.user, request, self.settings, provider
                )
            ]

        return asyncio.run(run())

    def runtime(self, lab="valuation"):
        request = LabAIRequest(
            lab=lab,
            objective="Analyze the available evidence",
            symbols=["AAA.US"] if lab != "portfolio" else [],
        )
        store = LabAIRunStore(self.lab)
        run = store.create(self.user.id, request)
        return LabAIRuntime(
            self.lab, store, self.user, request, self.settings, run, lambda *_: None
        )

    def test_real_agent_collects_current_user_portfolios_with_explicit_native_currency_stress(self):
        provider = LabFakeProvider()
        events = self.collect(
            LabAIRequest(lab="portfolio", objective="检查集中度和压力风险"), provider
        )
        run = events[-1]["data"]["run"]
        self.assertEqual(run["status"], "completed")
        self.assertEqual(run["title"], "组合体检")
        self.assertEqual([call[1] for call in self.lab.portfolio.calls], [self.user.id] * 3)
        self.assertTrue(all(call[2] is self.settings for call in self.lab.portfolio.calls))
        self.assertEqual(
            [item["data"]["base_currency"] for item in run["artifacts"]], ["USD", "CNY", "HKD"]
        )
        self.assertTrue(
            all(item["data"]["scenario"]["estimated_return"] < 0 for item in run["artifacts"])
        )
        self.assertTrue(
            all(item["data"]["scenario_assumptions"]["hypothetical"] for item in run["artifacts"])
        )
        self.assertIn("跨币种", " ".join(run["warnings"]))
        self.assertEqual([tool["name"] for tool in provider.requests[0].tools], ["get_lab_data"])
        self.assertEqual(
            provider.requests[0].tools[0]["parameters"]["properties"]["action"]["enum"],
            ["portfolio"],
        )
        self.assertNotIn("PRIVATE_MODEL_REASONING", json.dumps(events))
        self.assertNotIn("fake-secret", json.dumps(events))
        self.assertNotIn("multi_agent_delegation_policy", provider.requests[0].system)
        self.assertEqual(self.ai.store.get(self.user.id, run["id"])["report"], provider.final)

    def test_real_agent_calculates_and_atomically_saves_evidenced_valuation(self):
        provider = LabFakeProvider(tool_args=dcf_args())
        events = self.collect(
            LabAIRequest(lab="valuation", symbols=["AAA.US"], objective="估值并注明假设"), provider
        )
        run = events[-1]["data"]["run"]
        self.assertEqual(run["status"], "completed")
        self.assertEqual(len(provider.requests), 2)
        artifact = next(item for item in run["artifacts"] if item["kind"] == "valuation")
        self.assertGreater(artifact["data"]["result"]["value_per_share"], 0)
        self.assertIn("saved_model_id", artifact["data"])
        self.assertEqual(len(self.lab.list_valuation_models(self.user.id)), 1)
        self.assertEqual(self.lab.list_valuation_models("another-user"), [])
        self.assertEqual(
            len(
                [
                    event
                    for event in events
                    if event["type"] == "message_delta" and event["data"].get("reset")
                ]
            ),
            2,
        )

    def test_valuation_without_knowledge_write_retains_calculation_but_does_not_save_model(self):
        user = fake_user(permissions={"chat:write", "fundamentals:read"})
        events = self.collect(
            LabAIRequest(lab="valuation", symbols=["AAA.US"], objective="估值"),
            LabFakeProvider(tool_args=dcf_args()),
            user,
        )
        run = events[-1]["data"]["run"]
        self.assertEqual(run["status"], "completed")
        self.assertTrue(any(item["kind"] == "valuation" for item in run["artifacts"]))
        self.assertEqual(self.lab.list_valuation_models(user.id), [])

    def test_calculation_rejects_invented_facts_missing_debt_foreign_sources_and_nonfinite_values(
        self,
    ):
        runtime = self.runtime()
        source = runtime.data_tool({"action": "financial_reports", "symbol": "AAA.US"}).result
        valid = dcf_args(source["id"])
        self.assertEqual(runtime.valuation_tool(valid).status, "success")
        variants = []
        missing = copy.deepcopy(valid)
        del missing["assumptions"]["debt"]
        variants.append(missing)
        guessed = copy.deepcopy(valid)
        guessed["evidence"]["revenue"] = {"kind": "assumption", "note": "guess"}
        variants.append(guessed)
        wrong = copy.deepcopy(valid)
        wrong["assumptions"]["revenue"] = 2_000_000
        variants.append(wrong)
        foreign = copy.deepcopy(valid)
        foreign["symbol"] = "OTHER.US"
        variants.append(foreign)
        extreme = copy.deepcopy(valid)
        extreme["assumptions"]["wacc"] = float("inf")
        variants.append(extreme)
        invalid_fraction = copy.deepcopy(valid)
        invalid_fraction["assumptions"]["fcf_margin"] = 15
        variants.append(invalid_fraction)
        mismatched_currency = copy.deepcopy(valid)
        mismatched_currency["currency"] = "HKD"
        variants.append(mismatched_currency)
        for case in variants:
            with self.subTest(case=case):
                self.assertEqual(runtime.valuation_tool(case).status, "error")
        self.assertEqual(
            len([item for item in runtime.run["artifacts"] if item["kind"] == "valuation"]), 1
        )

    def test_peer_median_cannot_reference_an_individual_row_or_target_company(self):
        runtime = self.runtime()
        peer = runtime.data_tool({"action": "peers", "symbols": ["AAA.US", "BBB.US"]}).result
        source = runtime.data_tool({"action": "financial_reports", "symbol": "CCC.US"}).result
        args = {
            "symbol": "CCC.US",
            "title": "Peers",
            "currency": "USD",
            "model_type": "relative",
            "assumptions": {"metric": "pe_ttm_ratio", "peer_median": 20, "target_metric": 150_000},
            "evidence": {
                "peer_median": {
                    "kind": "source",
                    "artifact_id": peer["id"],
                    "path": "/rows/0/metrics/pe_ttm_ratio",
                    "note": "wrong single row",
                },
                "target_metric": {
                    "kind": "source",
                    "artifact_id": source["id"],
                    "path": "/net_income",
                    "note": "annual total USD net income",
                },
            },
        }
        self.assertEqual(runtime.valuation_tool(args).status, "error")
        args["assumptions"]["peer_median"] = 25
        args["evidence"]["peer_median"]["path"] = "/medians/pe_ttm_ratio"
        self.assertEqual(runtime.valuation_tool(args).status, "success")

    def test_data_actions_cannot_read_other_users_or_bypass_lab_scope(self):
        runtime = self.runtime("portfolio")
        self.assertEqual(
            runtime.data_tool({"action": "portfolio", "user_id": "victim"}).status, "error"
        )
        self.assertEqual(
            runtime.data_tool({"action": "financial_reports", "symbol": "AAA.US"}).status, "error"
        )
        self.assertEqual(runtime.valuation_tool(dcf_args()).status, "error")
        self.assertEqual(self.lab.portfolio.calls, [])

    def test_bootstrap_failure_returns_report_with_explicit_data_gap(self):
        with patch.object(
            self.lab.fundamentals,
            "get_financial_reports",
            side_effect=RuntimeError("SDK fake-secret"),
        ):
            events = self.collect(
                LabAIRequest(lab="valuation", objective="研究AAA.US", symbols=["AAA.US"]),
                LabFakeProvider(),
            )
        self.assertEqual(events[-1]["data"]["run"]["status"], "completed")
        self.assertTrue(events[-1]["data"]["run"]["warnings"])
        self.assertNotIn("fake-secret", json.dumps(events))

    def test_provider_failure_is_sanitized_and_persisted(self):
        events = self.collect(
            LabAIRequest(lab="valuation", objective="研究AAA.US"), LabFakeProvider(failure=True)
        )
        run = events[-1]["data"]["run"]
        self.assertEqual(run["status"], "failed")
        self.assertNotIn("private-provider-error", json.dumps(events))
        self.assertNotIn("fake-secret", json.dumps(events))

    def test_disconnect_marks_canceled_and_late_model_response_cannot_complete(self):
        release, started = threading.Event(), threading.Event()
        provider = LabFakeProvider(block=release, started=started)

        async def run():
            stream = self.ai.stream(
                self.user,
                LabAIRequest(lab="valuation", objective="研究AAA.US"),
                self.settings,
                provider,
            )
            first = await anext(stream)
            await asyncio.to_thread(started.wait, 1)
            await stream.aclose()
            canceled = self.ai.store.get(self.user.id, first["data"]["run"]["id"])
            release.set()
            for _ in range(100):
                if (str(self.lab.db_path), self.user.id) not in LabAIService._active:
                    break
                await asyncio.sleep(0.01)
            return canceled, self.ai.store.get(self.user.id, canceled["id"])

        first, final = asyncio.run(run())
        self.assertEqual(first["status"], "canceled")
        self.assertEqual(final["status"], "canceled")
        self.assertEqual(self.lab.list_valuation_models(self.user.id), [])

    def test_timeout_is_terminal_and_releases_worker_after_blocked_call_finishes(self):
        release = threading.Event()
        self.ai.timeout_seconds = 0.05
        events = self.collect(
            LabAIRequest(lab="valuation", objective="研究AAA.US"), LabFakeProvider(block=release)
        )
        run = events[-1]["data"]["run"]
        self.assertEqual(run["status"], "failed")
        self.assertIn("时间限制", run["error"])
        release.set()

        async def wait():
            for _ in range(100):
                if (str(self.lab.db_path), self.user.id) not in LabAIService._active:
                    return
                await asyncio.sleep(0.01)

        asyncio.run(wait())
        self.assertEqual(self.ai.store.get(self.user.id, run["id"])["status"], "failed")

    def test_atomic_completion_rolls_back_models_when_canceled_before_commit(self):
        runtime = self.runtime()
        source = runtime.data_tool({"action": "financial_reports", "symbol": "AAA.US"}).result
        self.assertEqual(runtime.valuation_tool(dcf_args(source["id"])).status, "success")
        original = self.lab.create_valuation_model

        def cancel_after_insert(*args, **kwargs):
            result = original(*args, **kwargs)
            runtime.cancel.set()
            return result

        with (
            patch.object(self.lab, "create_valuation_model", side_effect=cancel_after_insert),
            self.assertRaises(AgentCancelledError),
        ):
            self.ai.store.complete(runtime, "report")
        self.assertEqual(self.lab.list_valuation_models(self.user.id), [])
        self.assertEqual(self.ai.store.get(self.user.id, runtime.run["id"])["status"], "running")

    def test_cancel_during_database_commit_does_not_block_event_loop_and_rolls_back(self):
        runtime = self.runtime()
        source = runtime.data_tool({"action": "financial_reports", "symbol": "AAA.US"}).result
        self.assertEqual(runtime.valuation_tool(dcf_args(source["id"])).status, "success")
        original = self.lab.create_valuation_model
        inserted, release = threading.Event(), threading.Event()

        def pause_after_insert(*args, **kwargs):
            result = original(*args, **kwargs)
            inserted.set()
            release.wait(3)
            return result

        async def run():
            commit = asyncio.create_task(
                asyncio.to_thread(self.ai.store.complete, runtime, "report")
            )
            self.assertTrue(await asyncio.to_thread(inserted.wait, 1))
            runtime.stop("failed", "fixture timeout")
            finish = asyncio.create_task(
                asyncio.to_thread(runtime.finish, "failed", "fixture timeout")
            )
            try:
                # finish等待写事务期间，事件循环仍能响应其他请求/取消消息。
                for _ in range(3):
                    await asyncio.sleep(0.01)
                self.assertFalse(finish.done())
            finally:
                release.set()
            return await asyncio.wait_for(asyncio.gather(commit, finish, return_exceptions=True), 2)

        with patch.object(self.lab, "create_valuation_model", side_effect=pause_after_insert):
            results = asyncio.run(run())
        self.assertIsInstance(results[0], Exception)
        saved = self.ai.store.get(self.user.id, runtime.run["id"])
        self.assertEqual(saved["status"], "failed")
        self.assertEqual(saved["error"], "fixture timeout")
        self.assertEqual(self.lab.list_valuation_models(self.user.id), [])

    def test_request_and_scenario_validation(self):
        for request in (
            {"lab": "valuation", "objective": "  "},
            {"lab": "portfolio", "objective": "x", "user_id": "victim"},
        ):
            with self.assertRaises(ValidationError):
                LabAIRequest(**request)
        for shocks in ({"default": -0.1}, {"default": float("nan")}, {"default": -2}):
            with self.assertRaises(ValidationError):
                LabDataRequest(action="portfolio", scenario_shocks=shocks)

    def test_api_enforces_permissions_user_history_and_preserves_legacy_routes(self):
        app = FastAPI()
        app.include_router(labs_api.router, prefix="/api/v1/labs")
        selected = [self.user]
        app.dependency_overrides[get_current_user] = lambda: selected[0]
        with (
            patch.object(labs_api, "get_investment_lab_service", return_value=self.lab),
            patch.object(labs_api, "get_effective_settings", return_value=self.settings),
            patch(
                "app.deps.create_llm_provider", return_value=LabFakeProvider()
            ) as provider_factory,
            TestClient(app) as client,
        ):
            selected[0] = fake_user(permissions={"chat:write"})
            response = client.post(
                "/api/v1/labs/ai/stream", json={"lab": "portfolio", "objective": "review"}
            )
            self.assertEqual(response.status_code, 403)
            provider_factory.assert_not_called()
            selected[0] = self.user
            response = client.post(
                "/api/v1/labs/ai/stream",
                json={"lab": "greater_china", "objective": "研究700.HK", "symbols": ["700.HK"]},
            )
            self.assertEqual(response.status_code, 200)
            events = [
                json.loads(line[6:])
                for line in response.text.splitlines()
                if line.startswith("data: ")
            ]
            run = events[-1]["data"]["run"]
            self.assertEqual(run["status"], "completed")
            summary = client.get("/api/v1/labs/ai/runs?lab=greater_china").json()[0]
            self.assertEqual(summary["id"], run["id"])
            self.assertEqual(summary["artifacts"], [])
            self.assertEqual(summary["report"], "")
            self.assertTrue(client.get("/api/v1/labs/ai/runs/" + run["id"]).json()["artifacts"])
            selected[0] = fake_user("other-user")
            self.assertEqual(client.get("/api/v1/labs/ai/runs").json(), [])
            self.assertEqual(client.get("/api/v1/labs/ai/runs/" + run["id"]).status_code, 404)
            selected[0] = self.user
            self.assertEqual(
                client.post("/api/v1/labs/portfolio/analyze", json={"markets": ["US"]}).status_code,
                200,
            )


if __name__ == "__main__":
    unittest.main()
