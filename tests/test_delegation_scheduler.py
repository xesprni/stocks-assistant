"""Multi-batch capacity, dependency flow, cancellation and timeout regressions."""

import json
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor

import pytest
from test_multi_agent import FakeAgent, FakeParentAgent, NamedTool, fake_settings

from app.core.agent import subagent
from app.core.agent.delegation_runtime import AgentCancelledError, DelegationRuntime
from app.core.agent.subagent import SubAgentCancelledError, SubAgentRunner, SubAgentValidationError
from app.core.tools.delegate_agent import DelegateAgentTool


def parent(**overrides):
    result = FakeParentAgent(settings=fake_settings(**overrides))
    result.active_skill_filter = None
    return result


def task(task_id, *, dependencies=None, **extra):
    return {
        "id": task_id,
        "role": "researcher",
        "task": task_id,
        "depends_on": dependencies or [],
        **extra,
    }


@pytest.fixture(autouse=True)
def fake_children(monkeypatch):
    monkeypatch.setattr(subagent, "Agent", FakeAgent)


def test_more_tasks_than_workers_queue_and_preserve_request_order():
    events = []
    result = SubAgentRunner(
        parent(multi_agent_max_parallel_agents=1), lambda event, data: events.append((event, data))
    ).run_batch([task(f"task-{index}") for index in range(7)])
    assert result["counts"]["success"] == 7
    assert [item["task_id"] for item in result["results"]] == [
        f"task-{index}" for index in range(7)
    ]
    assert len([event for event, _ in events if event == "subagent_queued"]) == 7


def test_two_batches_share_one_actual_concurrency_limit(monkeypatch):
    guard = threading.Lock()
    first_pair = threading.Event()
    active = peak = 0

    class Child(FakeAgent):
        def run_stream(self, **kwargs):
            nonlocal active, peak
            with guard:
                active += 1
                peak = max(peak, active)
                if active == 2:
                    first_pair.set()
            try:
                assert first_pair.wait(2)
                time.sleep(0.01)
                return kwargs["user_message"]
            finally:
                with guard:
                    active -= 1

    monkeypatch.setattr(subagent, "Agent", Child)
    shared_parent = parent(multi_agent_max_parallel_agents=2)
    runners = [SubAgentRunner(shared_parent), SubAgentRunner(shared_parent)]
    assert runners[0].runtime is runners[1].runtime
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [
            pool.submit(runner.run_batch, [task(f"task-{i}") for i in range(4)])
            for runner in runners
        ]
        assert all(future.result(timeout=3)["status"] == "success" for future in futures)
    assert peak == 2


@pytest.mark.parametrize(
    "tasks",
    [
        [task("same"), task("same")],
        [task("task_2"), {"role": "researcher", "task": "generated"}],
        [task("a", dependencies=["missing"])],
        [task("a", dependencies=["a"])],
        [task("a", dependencies=["b"]), task("b", dependencies=["a"])],
        [task("a", max_steps=True)],
        [task("a", max_steps=1.2)],
        [task("a", tools=["web_fetch", "web_fetch"])],
        [task("a"), task("b", role="unknown")],
    ],
)
def test_invalid_batches_start_no_children(tasks):
    events = []
    with pytest.raises(SubAgentValidationError):
        SubAgentRunner(parent(), lambda *event: events.append(event)).run_batch(tasks)
    assert not events


def test_dependencies_receive_shared_snapshot_and_bounded_source_artifact_context(monkeypatch):
    messages = {}
    artifact = {
        "artifact_id": "a" * 32,
        "width": 2400,
        "height": 3000,
        "files": {"image": f"artifacts/renderings/{'a' * 32}/image.png"},
    }

    class Child(FakeAgent):
        def run_stream(self, **kwargs):
            message = kwargs["user_message"]
            name = message.splitlines()[0]
            messages[name] = message
            self.last_sources = [
                {"id": "oversized", "url": "https://example.com", "text": "x" * 150000},
                {"id": "source-1", "url": "https://example.com/report"},
            ]
            self.last_rendered_images = [artifact]
            return f"Findings for {name}: snapshot revenue=128"

    monkeypatch.setattr(subagent, "Agent", Child)
    result = SubAgentRunner(parent()).run_batch(
        [task("review", dependencies=["facts"]), task("facts")],
        'Snapshot: {"as_of":"2026-09-09", "revenue":128}',
    )
    assert result["status"] == "success"
    assert "revenue" in messages["facts"]
    assert "Findings for facts" in messages["review"]
    assert "source-1" in messages["review"]
    assert artifact["files"]["image"] in messages["review"]
    assert '"metadata_truncated": true' in messages["review"]
    assert len(messages["review"]) < 48000
    assert list(messages) == ["facts", "review"]
    assert [item["task_id"] for item in result["results"]] == ["review", "facts"]


def test_failed_prerequisite_skips_only_its_dependents(monkeypatch):
    started = []

    class Child(FakeAgent):
        def run_stream(self, **kwargs):
            name = kwargs["user_message"]
            started.append(name)
            if name == "fail":
                raise RuntimeError("source unavailable")
            return "ok"

    monkeypatch.setattr(subagent, "Agent", Child)
    result = SubAgentRunner(parent()).run_batch(
        [
            task("fail"),
            task("review", dependencies=["fail"]),
            task("summary", dependencies=["review"]),
            task("independent"),
        ]
    )
    assert result["status"] == "partial_error"
    assert [item["status"] for item in result["results"]] == [
        "error",
        "skipped",
        "skipped",
        "success",
    ]
    assert set(started) == {"fail", "independent"}


@pytest.mark.parametrize(
    "parent_scope,requested,expected",
    [
        ({"research"}, None, ["research"]),
        ({"research"}, [], []),
        (set(), None, []),
        (None, ["research"], ["research"]),
    ],
)
def test_child_skill_scope_never_expands(parent_scope, requested, expected, monkeypatch):
    scopes = []

    class Child(FakeAgent):
        def run_stream(self, **kwargs):
            scopes.append(kwargs["skill_filter"])
            return "done"

    monkeypatch.setattr(subagent, "Agent", Child)
    outer = parent()
    outer.active_skill_filter = parent_scope
    arguments = task("facts")
    if requested is not None:
        arguments["skill_filter"] = requested
    assert SubAgentRunner(outer).run_batch([arguments])["status"] == "success"
    assert scopes == [expected]


def test_child_cannot_request_skill_outside_parent_scope():
    outer = parent()
    outer.active_skill_filter = {"research"}
    with pytest.raises(SubAgentValidationError, match="cannot expand"):
        SubAgentRunner(outer).run_batch([task("facts", skill_filter=["admin"])])


def test_parent_cancel_stops_running_and_never_starts_queued_children(monkeypatch):
    running = threading.Event()
    stopped = threading.Event()
    outer = parent(multi_agent_max_parallel_agents=1)
    cancel = threading.Event()
    calls = []

    class Child(FakeAgent):
        def run_stream(self, **kwargs):
            calls.append(kwargs["user_message"])
            running.set()
            try:
                assert kwargs["cancel_event"].wait(2)
                raise AgentCancelledError("cancelled")
            finally:
                stopped.set()

    monkeypatch.setattr(subagent, "Agent", Child)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(
            SubAgentRunner(outer, cancel_event=cancel).run_batch,
            [task("first"), task("queued"), task("dependent", dependencies=["first"])],
        )
        try:
            assert running.wait(1)
            cancel.set()
            with pytest.raises(SubAgentCancelledError) as exc:
                future.result(timeout=1)
            assert exc.value.batch_result["counts"]["cancelled"] == 3
            assert stopped.wait(1)
            assert calls == ["first"]
        finally:
            cancel.set()


def test_timeout_returns_without_waiting_for_blocked_thread_and_suppresses_late_events(monkeypatch):
    release = threading.Event()
    stopped = threading.Event()
    events = []
    outer = parent(multi_agent_max_parallel_agents=2, multi_agent_task_timeout_seconds=0.06)

    class Child(FakeAgent):
        def run_stream(self, **kwargs):
            if kwargs["user_message"] == "blocked":
                try:
                    release.wait(2)
                    kwargs["on_event"]({"type": "message_update", "data": {"delta": "LATE"}})
                finally:
                    stopped.set()
            return "done"

    monkeypatch.setattr(subagent, "Agent", Child)
    runner = SubAgentRunner(outer, lambda event, data: events.append((event, data)))
    started = time.monotonic()
    try:
        result = runner.run_batch(
            [task("blocked"), task("independent"), task("review", dependencies=["blocked"])]
        )
        assert time.monotonic() - started < 0.5
        assert [item["status"] for item in result["results"]] == ["timeout", "success", "skipped"]
        assert runner.runtime.slots.acquire(blocking=False)
        assert not runner.runtime.slots.acquire(blocking=False)
        runner.runtime.slots.release()
        release.set()
        assert stopped.wait(1)
        assert "LATE" not in json.dumps(events)
    finally:
        release.set()
        stopped.wait(2)


def test_queue_wait_does_not_shorten_running_tasks_own_deadline(monkeypatch):
    outer = parent(multi_agent_max_parallel_agents=1, multi_agent_task_timeout_seconds=0.1)
    outer.delegation_runtime = DelegationRuntime(1)
    outer.delegation_runtime.slots.acquire()

    class Child(FakeAgent):
        def run_stream(self, **kwargs):
            assert not kwargs["cancel_event"].wait(0.06)
            return "done"

    monkeypatch.setattr(subagent, "Agent", Child)
    timer = threading.Timer(0.07, outer.delegation_runtime.slots.release)
    timer.start()
    try:
        result = SubAgentRunner(outer).run_batch([task("facts")])
        assert result["status"] == "success"
    finally:
        timer.join()


def test_completed_results_are_not_overwritten_when_cancellation_arrives(monkeypatch):
    cancel = threading.Event()

    class InlinePool:
        def __init__(self, **kwargs):
            pass

        def submit(self, fn, *args):
            future = Future()
            future.set_result(fn(*args))
            cancel.set()
            return future

        def shutdown(self, **kwargs):
            pass

    monkeypatch.setattr(subagent, "ThreadPoolExecutor", InlinePool)
    with pytest.raises(SubAgentCancelledError) as exc:
        SubAgentRunner(parent(), cancel_event=cancel).run_batch([task("done"), task("queued")])
    assert [item["status"] for item in exc.value.batch_result["results"]] == [
        "success",
        "cancelled",
    ]
    assert exc.value.batch_result["results"][0]["final_response"] == "done:done"


def test_tool_reports_all_failed_batch_as_error_and_preserves_source_metadata(monkeypatch):
    class Child(FakeAgent):
        def run_stream(self, **kwargs):
            self.last_sources = [{"id": "source-1", "url": "https://example.com"}]
            raise RuntimeError("analysis failed after fetching data")

    monkeypatch.setattr(subagent, "Agent", Child)
    tool = DelegateAgentTool()
    tool.context = parent()
    result = tool.execute({"tasks": [task("facts")]})
    assert result.status == "error"
    assert result.result["counts"]["error"] == 1
    assert result.ext_data["sources"][0]["id"] == "source-1"
    assert result.result["results"][0]["source_ids"] == ["source-1"]


def test_cloning_does_not_run_constructor_and_clears_new_runtime_fields():
    class Tool(NamedTool):
        constructed = 0

        def __init__(self):
            super().__init__("web_fetch")
            self.__class__.constructed += 1
            self.config = {"headers": {"test": "value"}}

    original = Tool()
    original.cancel_event = threading.Event()
    original.delegation_runtime = DelegationRuntime(1)
    cloned = SubAgentRunner._clone_tool(original)
    assert Tool.constructed == 1
    assert cloned.cancel_event is None
    assert cloned.delegation_runtime is None
    cloned.config["headers"]["test"] = "changed"
    assert original.config["headers"]["test"] == "value"


@pytest.mark.parametrize("child_outcome", ["success", "error", "timeout"])
def test_real_parent_receives_source_and_image_paths_even_if_child_later_stops(
    monkeypatch, child_outcome
):
    from app.core.agent.agent import Agent

    artifact = {
        "artifact_id": "b" * 32,
        "width": 2400,
        "height": 3000,
        "files": {"image": f"artifacts/renderings/{'b' * 32}/image.png"},
    }
    observed = []
    release = threading.Event()
    exited = threading.Event()

    class Child(FakeAgent):
        def run_stream(self, **kwargs):
            self.last_sources = [{"id": "source", "url": "https://example.com/report"}]
            self.last_rendered_images = [artifact]
            if child_outcome == "timeout":
                kwargs["on_event"](
                    {
                        "type": "tool_execution_end",
                        "data": {
                            "tool_name": "render_image",
                            "status": "success",
                            "result": artifact,
                            "sources": self.last_sources,
                        },
                    }
                )
                try:
                    assert release.wait(2)
                finally:
                    exited.set()
            if child_outcome == "error":
                raise RuntimeError("Analysis failed after rendering")
            return "Findings with a chart"

    class Model:
        def call_stream(self, request):
            if not observed:
                observed.append(None)
                yield {
                    "choices": [
                        {
                            "delta": {
                                "tool_calls": [
                                    {
                                        "index": 0,
                                        "id": "delegate",
                                        "function": {
                                            "name": "delegate_agent",
                                            "arguments": json.dumps({"tasks": [task("facts")]}),
                                        },
                                    }
                                ]
                            },
                            "finish_reason": "tool_calls",
                        }
                    ]
                }
            else:
                block = request.messages[-1]["content"][0]
                observed.append(json.loads(block["content"]))
                assert block.get("is_error", False) is (child_outcome != "success")
                yield {"choices": [{"delta": {"content": "Synthesis"}, "finish_reason": "stop"}]}

    monkeypatch.setattr(subagent, "Agent", Child)
    settings = fake_settings(multi_agent_task_timeout_seconds=0.08)
    settings.multi_agent_roles["researcher"]["tool_allowlist"].append("render_image")
    agent = Agent(
        system_prompt="Coordinate research",
        model=Model(),
        max_steps=3,
        tools=[DelegateAgentTool(), NamedTool("web_fetch"), NamedTool("render_image")],
        settings=settings,
    )
    try:
        assert agent.run_stream("Research and draw") == "Synthesis"
    finally:
        release.set()
        if child_outcome == "timeout":
            assert exited.wait(1)
    assert agent.last_sources[0]["id"] == "source"
    assert agent.last_rendered_images == [artifact]
    assert observed[-1]["rendered_images"] == [artifact]
    assert observed[-1]["sources"][0]["url"] == "https://example.com/report"


def test_delegation_prompt_only_advertises_available_role_tools():
    from app.core.agent.agent import Agent

    agent = Agent(system_prompt="", settings=fake_settings())
    assert agent.get_multi_agent_prompt() == ""
    agent.add_tool(NamedTool("delegate_agent"))
    agent.add_tool(NamedTool("web_fetch"))
    prompt = agent.get_multi_agent_prompt()
    assert "researcher: Research Tools: web_fetch" in prompt
    assert "danger: Danger Tools: (none)" in prompt
    assert "depends_on" in prompt
    assert "shared_context" in prompt
