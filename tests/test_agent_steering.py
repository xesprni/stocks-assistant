"""Exercise steering at actual model/tool boundaries without external services."""

import copy
import json
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest

from app.core.agent.agent import Agent
from app.core.agent.delegation_runtime import AgentCancelledError
from app.core.agent.executor import AgentStreamExecutor
from app.core.tools.base_tool import BaseTool, ToolResult


class MemoryInputChannel:
    """Keep the channel's accept/drain/finish operations atomic like the real API."""

    def __init__(self):
        self.lock = threading.Lock()
        self.pending = []
        self.applied = []
        self.closed = False

    def submit(self, message, input_id=None):
        with self.lock:
            if self.closed:
                return False
            self.pending.append({"id": input_id or message, "message": message})
            return True

    def _take_pending(self):
        result, self.pending = self.pending, []
        self.applied.extend(item["id"] for item in result)
        return result

    def drain(self, close=False):
        with self.lock:
            if close:
                self.closed = True
            return self._take_pending()

    def finish(self):
        with self.lock:
            if self.pending:
                return self._take_pending()
            self.closed = True
            return []


def text_chunk(text):
    return {"choices": [{"delta": {"content": text}, "finish_reason": "stop"}]}


def tool_chunk(count=1):
    return {
        "choices": [
            {
                "delta": {
                    "tool_calls": [
                        {
                            "index": index,
                            "id": f"lookup-{index}",
                            "function": {
                                "name": "lookup",
                                "arguments": json.dumps({"index": index}),
                            },
                        }
                        for index in range(count)
                    ]
                },
                "finish_reason": "tool_calls",
            }
        ]
    }


class ScriptedModel:
    def __init__(self, steps):
        self.steps = steps
        self.requests = []

    def call_stream(self, request):
        index = len(self.requests)
        self.requests.append(copy.deepcopy(request.messages))
        if index >= len(self.steps):
            raise AssertionError("The executor made an unexpected extra model call")
        step = self.steps[index]
        yield from step() if callable(step) else step


class RecordingTool(BaseTool):
    name = "lookup"
    description = "Return a local fixture result."
    params = {"type": "object", "properties": {"index": {"type": "integer"}}}

    def __init__(self, callback=None):
        self.calls = []
        self.callback = callback

    def execute(self, params):
        self.calls.append(dict(params))
        if self.callback:
            self.callback(params)
        return ToolResult.success(f"saved-result-{params['index']}")


def make_agent(tmp_path, model, channel=None, tools=None, max_steps=5):
    agent = Agent(
        "Test steering safely.",
        model=model,
        tools=tools,
        workspace_dir=str(tmp_path),
        enable_skills=False,
        max_steps=max_steps,
        max_context_tokens=100_000,
    )
    if channel is not None:
        agent.input_channel = channel
    return agent


def user_texts(messages):
    return [
        block["text"]
        for message in messages
        if message["role"] == "user"
        for block in message["content"]
        if block.get("type") == "text"
    ]


def assert_tool_pairs(messages, count):
    tool_message_index = next(
        index
        for index, message in enumerate(messages)
        if any(block.get("type") == "tool_use" for block in message["content"])
    )
    results = messages[tool_message_index + 1]
    assert results["role"] == "user"
    result_blocks = [block for block in results["content"] if block["type"] == "tool_result"]
    assert [(block["tool_use_id"], block["content"]) for block in result_blocks] == [
        (f"lookup-{index}", f"saved-result-{index}") for index in range(count)
    ]
    assert all(not block.get("is_error") for block in result_blocks)
    return tool_message_index + 1


def test_agent_without_input_channel_remains_compatible(tmp_path):
    model = ScriptedModel([[text_chunk("original answer")]])
    agent = make_agent(tmp_path, model)

    assert agent.input_channel is None
    assert agent.run_stream("original task") == "original answer"
    assert len(model.requests) == 1
    assert user_texts(agent.messages) == ["original task"]


def test_pending_steering_is_seen_by_first_model_call_in_order_once(tmp_path):
    channel = MemoryInputChannel()
    channel.submit("first correction", "first")
    channel.submit("second correction", "second")
    model = ScriptedModel([[text_chunk("updated answer")]])
    agent = make_agent(tmp_path, model, channel)

    assert agent.run_stream("original task") == "updated answer"
    assert user_texts(model.requests[0]) == [
        "original task",
        "first correction",
        "second correction",
    ]
    assert user_texts(agent.messages) == user_texts(model.requests[0])
    assert channel.applied == ["first", "second"]
    assert channel.closed
    assert not channel.submit("too late")


def test_steering_arriving_during_final_reply_continues_same_history(tmp_path):
    channel = MemoryInputChannel()

    def original_reply():
        yield text_chunk("provisional answer")
        assert channel.submit("include the new constraint", "correction")

    model = ScriptedModel([original_reply, [text_chunk("revised answer")]])
    agent = make_agent(tmp_path, model, channel)

    assert agent.run_stream("original task") == "revised answer"
    assert len(model.requests) == 2
    assert user_texts(model.requests[0]) == ["original task"]
    assert user_texts(model.requests[1]) == ["original task", "include the new constraint"]
    assert model.requests[1][-2] == {
        "role": "assistant",
        "content": [{"type": "text", "text": "provisional answer"}],
    }
    assert channel.applied == ["correction"]
    assert channel.closed
    assert not channel.submit("too late")


@pytest.mark.parametrize("tool_count", [1, 2])
def test_steering_waits_for_all_running_tools_and_preserves_results(tmp_path, tool_count):
    channel = MemoryInputChannel()
    entered = [threading.Event() for _ in range(tool_count)]
    release = threading.Event()

    def pause_tool(params):
        entered[params["index"]].set()
        assert release.wait(5), "test did not release the running tool"

    tool = RecordingTool(pause_tool)
    model = ScriptedModel([[tool_chunk(tool_count)], [text_chunk("updated from saved results")]])
    agent = make_agent(tmp_path, model, channel, tools=[tool])

    with ThreadPoolExecutor(max_workers=1) as pool:
        running = pool.submit(agent.run_stream, "original task")
        try:
            for event in entered:
                assert event.wait(5), "tool did not start"
            assert channel.submit("first correction", "first")
            assert channel.submit("second correction", "second")
            assert channel.applied == []
            assert len(model.requests) == 1
            assert not running.done()
        finally:
            release.set()
        assert running.result(timeout=5) == "updated from saved results"

    assert len(model.requests) == 2
    assert sorted(tool.calls, key=lambda params: params["index"]) == [
        {"index": index} for index in range(tool_count)
    ]
    result_index = assert_tool_pairs(model.requests[1], tool_count)
    assert user_texts(model.requests[1][result_index + 1 :]) == [
        "first correction",
        "second correction",
    ]
    assert_tool_pairs(agent.messages, tool_count)
    assert channel.applied == ["first", "second"]
    assert channel.closed


def test_last_tool_steering_reaches_summary_before_channel_closes(tmp_path):
    channel = MemoryInputChannel()

    def final_tool(_params):
        assert channel.submit("summarize the existing evidence", "last")

    def summary():
        assert channel.closed
        assert not channel.submit("cannot extend this exhausted run")
        yield text_chunk("summary with correction")

    tool = RecordingTool(final_tool)
    model = ScriptedModel([[tool_chunk()], summary])
    agent = make_agent(tmp_path, model, channel, tools=[tool], max_steps=1)

    assert agent.run_stream("original task") == "summary with correction"
    assert len(model.requests) == 2
    assert tool.calls == [{"index": 0}]
    assert "summarize the existing evidence" in user_texts(model.requests[-1])
    assert_tool_pairs(model.requests[-1], 1)
    assert channel.applied == ["last"]
    assert channel.closed


def test_continuous_steering_cannot_extend_the_step_budget(tmp_path):
    channel = MemoryInputChannel()

    def reply_one():
        assert channel.submit("correction one", "one")
        yield text_chunk("first provisional answer")

    def reply_two():
        assert channel.submit("correction two", "two")
        yield text_chunk("second provisional answer")

    def summary():
        assert channel.closed
        assert not channel.submit("correction three", "three")
        yield text_chunk("bounded summary")

    model = ScriptedModel([reply_one, reply_two, summary])
    agent = make_agent(tmp_path, model, channel, max_steps=2)

    assert agent.run_stream("original task") == "bounded summary"
    assert len(model.requests) == 3
    assert user_texts(agent.messages) == ["original task", "correction one", "correction two"]
    assert channel.applied == ["one", "two"]


def test_cancelled_run_does_not_apply_waiting_steering(tmp_path):
    channel = MemoryInputChannel()
    cancelled = threading.Event()

    def cancel_during_tool(_params):
        assert channel.submit("do not run after stop", "pending")
        cancelled.set()

    tool = RecordingTool(cancel_during_tool)
    model = ScriptedModel([[tool_chunk()]])
    agent = make_agent(tmp_path, model, channel, tools=[tool])
    events = []

    with pytest.raises(AgentCancelledError):
        agent.run_stream("original task", on_event=events.append, cancel_event=cancelled)

    assert len(model.requests) == 1
    assert tool.calls == [{"index": 0}]
    assert channel.applied == []
    assert user_texts(agent.stream_executor.messages) == ["original task"]
    assert not any(event["type"] == "agent_end" for event in events)


def test_cancellation_before_first_call_does_not_consume_steering(tmp_path):
    channel = MemoryInputChannel()
    channel.submit("do not apply this", "pending")
    cancelled = threading.Event()
    cancelled.set()
    model = ScriptedModel([])
    agent = make_agent(tmp_path, model, channel)

    with pytest.raises(AgentCancelledError):
        agent.run_stream("original task", cancel_event=cancelled)

    assert model.requests == []
    assert channel.applied == []


def test_empty_reply_retry_receives_steering_before_next_model_call(tmp_path):
    channel = MemoryInputChannel()

    def empty_reply():
        assert channel.submit("new constraint while response was empty", "correction")
        yield text_chunk("")

    model = ScriptedModel([empty_reply, [text_chunk("answer from corrected request")]])
    agent = make_agent(tmp_path, model, channel)

    assert agent.run_stream("original task") == "answer from corrected request"
    assert len(model.requests) == 2
    assert user_texts(model.requests[1]) == [
        "original task",
        "new constraint while response was empty",
    ]
    assert channel.applied == ["correction"]


def test_post_tool_empty_reply_fallback_receives_steering_and_keeps_results(tmp_path):
    channel = MemoryInputChannel()

    def second_empty_reply():
        assert channel.submit("apply before fallback", "correction")
        yield text_chunk("")

    tool = RecordingTool()
    model = ScriptedModel(
        [[tool_chunk()], [text_chunk("")], second_empty_reply, [text_chunk("fallback answer")]]
    )
    agent = make_agent(tmp_path, model, channel, tools=[tool])

    assert agent.run_stream("original task") == "fallback answer"
    assert len(model.requests) == 4
    assert "apply before fallback" in user_texts(model.requests[-1])
    assert user_texts(agent.messages) == ["original task", "apply before fallback"]
    assert_tool_pairs(model.requests[-1], 1)
    assert tool.calls == [{"index": 0}]
    assert channel.applied == ["correction"]


def test_fallback_reminder_removal_keeps_steering_after_context_trim(tmp_path, monkeypatch):
    channel = MemoryInputChannel()
    reminder_text = "Please respond to the user based on the tool results."
    original_trim = AgentStreamExecutor._trim_messages
    trim_locations = []

    def trim_old_user_message(executor):
        if reminder_text in user_texts(executor.messages):
            assert user_texts(executor.messages) == [
                "original task",
                reminder_text,
                "keep this correction",
            ]
            # Removing old context shifts the pending input into the reminder's old index.
            executor.messages = executor.messages[1:]
            trim_locations.append(user_texts(executor.messages))
        else:
            original_trim(executor)

    def second_empty_reply():
        assert channel.submit("keep this correction", "correction")
        yield text_chunk("")

    monkeypatch.setattr(AgentStreamExecutor, "_trim_messages", trim_old_user_message)
    tool = RecordingTool()
    model = ScriptedModel(
        [[tool_chunk()], [text_chunk("")], second_empty_reply, [text_chunk("fallback answer")]]
    )
    agent = make_agent(tmp_path, model, channel, tools=[tool])

    assert agent.run_stream("original task") == "fallback answer"
    assert trim_locations == [[reminder_text, "keep this correction"]]
    assert user_texts(model.requests[-1]) == [reminder_text, "keep this correction"]
    assert user_texts(agent.messages) == ["keep this correction"]
    assert_tool_pairs(agent.messages, 1)
    assert channel.applied == ["correction"]
