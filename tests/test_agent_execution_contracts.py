"""运行边界的行为契约：真实失败输入、顺序屏障与生命周期，不访问外部服务。"""

import asyncio
import copy
import gc
import os
import shlex
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import FrozenInstanceError
from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest

from app.api import tools as tools_api
from app.core.agent import subagent
from app.core.agent.agent import Agent
from app.core.agent.executor import AgentStreamExecutor
from app.core.agent.models import LLMModel, LLMRequest
from app.core.agent.run_resources import RunResources
from app.core.llm.client_pool import LLMClientPool
from app.core.llm.errors import ProviderErrorKind, ProviderHTTPError, classify_provider_error
from app.core.llm.provider import OpenAICompatibleProvider, OpenAIResponsesProvider
from app.core.tools.base_tool import BaseTool, ToolResult
from app.core.tools.bash import BashTool
from app.core.tools.batch_executor import ToolBatchExecutor
from app.core.tools.call_context import AgentCancelledError, ToolCallContext
from app.core.tools.mcp.mcp_tool import MCPManager, MCPToolAdapter
from app.core.tools.portfolio import PortfolioTool
from app.core.tools.result_metadata import ToolResultMetadata
from app.core.tools.scheduler.tool import SchedulerTool
from app.core.tools.watchlist import WatchlistTool
from app.schemas.tools import ToolExecuteRequest


def executor_for(model, history=None, tools=None):
    agent = Agent("system", model=model, enable_skills=False, max_context_tokens=100_000)
    return AgentStreamExecutor(agent, model, "system", tools or [], messages=history)


@pytest.mark.parametrize(
    "message",
    [
        "400 invalid_request: model not found",
        "400 invalid_request: image too large",
        "400 invalid_request: request must have a supported model",
        "400 invalid_request: tool_result without corresponding tool_use",
    ],
)
def test_unrecoverable_provider_failure_preserves_original_history(message):
    history = [{"role": "user", "content": "keep this decision"}]
    original = copy.deepcopy(history)

    class Model:
        def call_stream(self, request):
            # 即使一个旧 Provider 修改入参，也只能污染该次请求副本。
            request.messages[0]["content"] = "changed in provider"
            raise RuntimeError(message)
            yield

    executor = executor_for(Model(), history)
    with pytest.raises(RuntimeError, match=message):
        executor._call_llm_stream()
    assert executor.messages == original
    assert history == original


@pytest.mark.parametrize("succeed", [False, True])
def test_context_recovery_trims_only_request_copy_and_attempts_once(succeed):
    history = [{"role": "user", "content": f"question {index}"} for index in range(7)]
    original = copy.deepcopy(history)
    attempts = []

    class Model:
        def call_stream(self, request):
            attempts.append(copy.deepcopy(request.messages))
            if len(attempts) == 1 or not succeed:
                yield {"error": {"code": "context_length_exceeded", "message": "limit"}}
            else:
                yield {"choices": [{"delta": {"content": "done"}, "finish_reason": "stop"}]}

    executor = executor_for(Model(), history)
    if succeed:
        assert executor._call_llm_stream()[0] == "done"
        assert executor.messages[:-1] == original
    else:
        with pytest.raises(RuntimeError, match="limit"):
            executor._call_llm_stream()
        assert executor.messages == original
    assert len(attempts) == 2
    assert len(attempts[0]) == 7
    assert len(attempts[1]) == 5


@pytest.mark.parametrize(
    "status,code,expected",
    [
        (400, "model_not_found", ProviderErrorKind.CONFIGURATION),
        (400, "context_length_exceeded", ProviderErrorKind.CONTEXT),
        (403, "context_length_exceeded", ProviderErrorKind.AUTH),
        (429, "rate_limit_exceeded", ProviderErrorKind.RATE_LIMIT),
        (503, "server_error", ProviderErrorKind.TRANSIENT),
    ],
)
@pytest.mark.parametrize("provider_class", [OpenAICompatibleProvider, OpenAIResponsesProvider])
def test_providers_keep_structured_error_codes_and_httpx_compatibility(
    status, code, expected, provider_class
):
    provider = provider_class("test")
    with httpx.Client(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(
                status, json={"error": {"code": code, "message": "detail"}}
            )
        )
    ) as client:
        provider.client = client
        with pytest.raises(httpx.HTTPStatusError) as raised:
            list(provider.call_stream(LLMRequest(messages=[])))
    assert isinstance(raised.value, ProviderHTTPError)
    assert classify_provider_error(raised.value) == expected


def test_legacy_tool_config_and_call_context_are_isolated_for_parallel_calls():
    gate = threading.Barrier(2)
    service = object()

    class LegacyTool(BaseTool):
        name = "legacy"
        read_only = True

        def __init__(self):
            self.config = {"calls": []}
            self.service = service

        def execute(self, params):
            self.config["calls"].append(self.current_tool_call["id"])
            gate.wait(timeout=2)
            assert self.service is service
            return ToolResult.success(self.config["calls"])

    tool = LegacyTool()
    executor = executor_for(LLMModel("test"), tools=[tool])
    results = executor._execute_tool_calls_batch(
        [{"id": key, "name": "legacy", "arguments": {}} for key in ("one", "two")]
    )
    assert [result["result"] for result in results] == [["one"], ["two"]]
    assert tool.config == {"calls": []}
    assert not hasattr(tool, "current_tool_call")


def test_explicit_context_does_not_require_agent_or_mutate_tool_instance():
    class ExplicitTool(BaseTool):
        def invoke(self, params, context):
            assert context.user_id == "user-1"
            with pytest.raises(FrozenInstanceError):
                context.user_id = "other"
            return ToolResult.success(context.tool_call_id)

    tool = ExplicitTool()
    assert (
        tool.execute_tool({}, ToolCallContext(user_id="user-1", tool_call_id="call")).result
        == "call"
    )
    assert not hasattr(tool, "context")


def test_agent_and_child_keep_explicit_user_identity(monkeypatch):
    from test_multi_agent import FakeAgent, FakeParentAgent, fake_settings

    class IdentityTool(BaseTool):
        name = "identity"

        def invoke(self, params, context):
            return ToolResult.success(context.user_id)

    executor = executor_for(LLMModel("test"), tools=[IdentityTool()])
    executor.agent.user_id = "user-1"
    result = executor._execute_tool({"id": "one", "name": "identity", "arguments": {}})
    assert result["result"] == "user-1"
    seen = []

    class Child(FakeAgent):
        def __init__(self, *args, **kwargs):
            seen.append(kwargs["user_id"])
            super().__init__(*args, **kwargs)

    monkeypatch.setattr(subagent, "Agent", Child)
    parent = FakeParentAgent(settings=fake_settings())
    parent.user_id = "user-1"
    result = subagent.SubAgentRunner(parent).run_batch(
        [{"role": "researcher", "task": "verify identity"}]
    )
    assert result["status"] == "success"
    assert seen == ["user-1"]


def test_read_segments_run_in_parallel_and_writes_are_ordered_barriers():
    first_reads = threading.Barrier(2)
    value = [0]

    class MixedTool(BaseTool):
        def is_read_only(self, params):
            return params["action"] == "read"

    def execute(call):
        action = call["arguments"]["action"]
        if call["id"] in {"a", "b"}:
            first_reads.wait(timeout=2)
        if action == "write":
            value[0] += 1
        return {"result": value[0]}

    calls = [
        {"id": key, "name": "mixed", "arguments": {"action": action}}
        for key, action in [("a", "read"), ("b", "read"), ("c", "write"), ("d", "read")]
    ]
    results = ToolBatchExecutor({"mixed": MixedTool()}, execute, lambda: None).run(calls)
    assert [result["result"] for result in results] == [0, 0, 1, 1]


def test_unknown_tools_are_serial_and_cancel_does_not_start_later_writes():
    token = threading.Event()
    context = ToolCallContext(cancel_event=token)
    executed = []

    def execute(call):
        executed.append(call["id"])
        token.set()
        return {"status": "success"}

    calls = [{"id": key, "name": "unknown", "arguments": {}} for key in ("one", "two")]
    with pytest.raises(AgentCancelledError):
        ToolBatchExecutor({}, execute, context.raise_if_cancelled).run(calls)
    assert executed == ["one"]


def test_parallel_failure_history_follows_request_order():
    second_finished = threading.Event()

    class ReadTool(BaseTool):
        name = "read"
        read_only = True

        def execute(self, params):
            if params["index"] == 0:
                assert second_finished.wait(2)
                return ToolResult.fail("first request failed last")
            second_finished.set()
            return ToolResult.success("second request completed first")

    executor = executor_for(LLMModel("test"), tools=[ReadTool()])
    calls = [{"id": str(index), "name": "read", "arguments": {"index": index}} for index in (0, 1)]
    executor._execute_tool_calls_batch(calls)
    assert [entry[2] for entry in executor.tool_failure_history] == [False, True]


@pytest.mark.parametrize("tool", [PortfolioTool(), WatchlistTool(), SchedulerTool()])
def test_mixed_tools_classify_the_call_action(tool):
    assert tool.is_read_only({"action": "list"})
    assert tool.is_read_only({"action": "get"})
    assert not tool.is_read_only({"action": "update"})
    assert not tool.is_read_only({"action": "new_future_action"})


@pytest.mark.skipif(os.name != "posix", reason="POSIX process group contract")
def test_bash_cancellation_terminates_shell_children(tmp_path):
    started = tmp_path / "started"
    late_write = tmp_path / "late"
    script = (
        "import pathlib, signal, time; "
        "signal.signal(signal.SIGTERM, signal.SIG_IGN); "
        f"pathlib.Path({str(started)!r}).write_text('started'); "
        "time.sleep(0.9); "
        f"pathlib.Path({str(late_write)!r}).write_text('should not happen')"
    )
    command = f"{shlex.quote(sys.executable)} -c {shlex.quote(script)}"
    token = threading.Event()
    with ThreadPoolExecutor(max_workers=1) as workers:
        future = workers.submit(
            BashTool(config={"cwd": str(tmp_path)}).execute_tool,
            {"command": command, "timeout": 10},
            ToolCallContext(cancel_event=token),
        )
        deadline = time.monotonic() + 3
        while not started.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        assert started.exists()
        token.set()
        with pytest.raises(AgentCancelledError):
            future.result(timeout=2)
    time.sleep(0.9)
    assert not late_write.exists()


def test_mcp_context_cancellation_propagates_and_cancels_local_await():
    started = threading.Event()
    stopped = threading.Event()
    cancel = threading.Event()

    class Session:
        async def call_tool(self, name, params):
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                stopped.set()

    manager = MCPManager({}, tool_timeout_seconds=10)
    manager._sessions["demo"] = Session()
    tool = MCPToolAdapter("demo", "unknown", "unknown operation", {}, manager)
    try:
        with ThreadPoolExecutor(max_workers=1) as workers:
            future = workers.submit(tool.execute_tool, {}, ToolCallContext(cancel_event=cancel))
            assert started.wait(2)
            cancel.set()
            with pytest.raises(AgentCancelledError, match="external effects may have completed"):
                future.result(timeout=2)
            assert stopped.wait(2)
    finally:
        manager.close_sync()


def test_tool_metadata_protocol_is_independent_of_tool_name_and_keeps_partial_results():
    class ExportTool(BaseTool):
        name = "custom_export"

        def execute(self, params):
            return ToolResult.fail(
                "partially failed",
                ext_data={
                    "preserve_partial": True,
                    "rendered_images": [
                        {"artifact_id": "one", "width": 10, "image_data": "secret"}
                    ],
                },
            )

    executor = executor_for(LLMModel("test"), tools=[ExportTool()])
    result = executor._execute_tool({"id": "call", "name": "custom_export", "arguments": {}})
    assert result["rendered_images"] == [{"artifact_id": "one", "width": 10}]
    assert executor.rendered_images == result["rendered_images"]
    merged = ToolResultMetadata.merge(result, result).as_dict()
    assert merged["rendered_images"] == result["rendered_images"]


def test_llm_pool_retirement_preserves_active_lease_and_reopens_cleanly():
    pool = LLMClientPool()
    with pool.lease("https://example.test/v1", 12) as first:
        assert pool.get("https://example.test/v1/", 12) is first
        pool.close()
        assert not first.is_closed
        with pool.lease("https://example.test/v1", 12) as second:
            assert second is not first
            assert not second.is_closed
        assert not second.is_closed
    assert first.is_closed
    pool.close()
    pool.close()
    assert second.is_closed


def test_retry_closes_unfinished_model_stream_before_next_attempt(monkeypatch):
    lifecycle = []

    class Model:
        def call_stream(self, request):
            index = len(lifecycle)
            lifecycle.append("start")
            try:
                if index == 0:
                    yield {"error": {"message": "connection timeout"}}
                    pytest.fail("failed stream must not be resumed")
                yield {"choices": [{"delta": {"content": "done"}, "finish_reason": "stop"}]}
            finally:
                lifecycle.append("close")

    monkeypatch.setattr("app.core.agent.executor.time.sleep", lambda duration: None)
    assert executor_for(Model())._call_llm_stream()[0] == "done"
    assert lifecycle == ["start", "close", "start", "close"]


def test_retry_steering_is_applied_even_when_history_trim_reduces_message_count(monkeypatch):
    from test_agent_steering import MemoryInputChannel

    channel = MemoryInputChannel()
    requests = []

    class Model:
        def call_stream(self, request):
            requests.append(copy.deepcopy(request.messages))
            if len(requests) == 1:
                channel.submit("latest correction", "correction")
                raise httpx.ReadTimeout("")
            yield {"choices": [{"delta": {"content": "done"}, "finish_reason": "stop"}]}

    executor = executor_for(Model(), [{"role": "user", "content": str(i)} for i in range(5)])
    executor.agent.input_channel = channel
    monkeypatch.setattr(
        executor, "_trim_messages", lambda: setattr(executor, "messages", executor.messages[-1:])
    )
    monkeypatch.setattr("app.core.agent.executor.time.sleep", lambda duration: None)
    assert executor._call_llm_stream()[0] == "done"
    assert requests[1][-1]["content"] == [{"type": "text", "text": "latest correction"}]
    assert channel.applied == ["correction"]


def test_run_resources_release_only_after_child_finishes():
    resources = Mock()
    parent = Agent("system", runtime_resources=resources)
    child_lease = parent.borrow_runtime_resources()
    parent.close()
    parent.close()
    resources.close.assert_not_called()
    child = Agent("system", runtime_resources=child_lease)
    with pytest.raises(ValueError, match="No model"):
        child.run_stream("run")
    resources.close.assert_called_once()


def test_unstarted_agent_finalizer_and_resource_owner_are_idempotent():
    resources = Mock()
    agent = Agent("system", runtime_resources=resources)
    del agent
    gc.collect()
    resources.close.assert_called_once()
    owner = RunResources(Mock())
    lease = owner.retain()
    owner.close()
    owner.close()
    lease.close()
    lease.close()


def test_direct_tools_api_supplies_explicit_context_and_holds_resource_lease(monkeypatch):
    from app import deps

    events = []
    memory = object()
    settings = SimpleNamespace(memory_enabled=True, mcp_servers={}, workspace_dir="/tmp/tools")

    @contextmanager
    def lease(user_id, *, settings=None):
        events.append("acquire")
        try:
            yield memory
        finally:
            events.append("release")

    class DirectTool(BaseTool):
        def invoke(self, params, context):
            assert events == ["acquire"]
            assert context.parent_agent is None
            assert context.memory_manager is memory
            assert context.settings is settings
            assert context.user_id == "user-1"
            return ToolResult.success("done", ext_data={"sources": [{"id": "source"}]})

    monkeypatch.setattr(tools_api, "get_effective_settings", lambda user_id: settings)
    monkeypatch.setattr(deps, "lease_memory_manager_for_user", lease)
    monkeypatch.setattr(deps, "get_skill_manager", lambda: None)
    monkeypatch.setattr(
        tools_api,
        "_tool_manager_for_user",
        lambda *args, **kwargs: SimpleNamespace(get_tool=lambda name: DirectTool()),
    )
    result = tools_api.execute_tool(
        "direct", ToolExecuteRequest(arguments={}), SimpleNamespace(id="user-1")
    )
    assert result.result == "done"
    assert result.sources == [{"id": "source"}]
    assert events == ["acquire", "release"]
