"""Agent infrastructure contracts, using only local fakes and temporary storage."""

import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import Mock, patch

import httpx
import pytest

from app.core.agent.executor import AgentStreamExecutor
from app.core.agent.models import LLMRequest
from app.core.llm.provider import OpenAICompatibleProvider, OpenAIResponsesProvider
from app.core.session.store import ChatSessionStore
from app.core.tools.mcp.mcp_tool import MCPManager
from app.core.tools.parameters import bounded_positive_int, optional_positive_int
from app.core.tools.read_file import ReadFileTool
from app.core.tools.tool_manager import ToolManager
from app.core.tools.write_file import WriteFileTool
from app.core.tracing.store import TraceRecorder, TraceStore


def make_executor(model=None, **kwargs):
    model = model or SimpleNamespace(
        call=Mock(return_value={"choices": [{"message": {"content": "summary"}}]})
    )
    agent = SimpleNamespace(
        model=model,
        memory_manager=None,
        settings=None,
        max_context_tokens=100_000,
        _get_model_context_window=lambda: 100_000,
        _estimate_message_tokens=lambda message: len(str(message)) // 4,
    )
    return AgentStreamExecutor(agent, model, "system", [], **kwargs)


def test_context_summary_formats_turns_and_builds_messages():
    executor = make_executor()
    turns = [{"messages": [{"role": "user", "content": "question"}]}]
    assert executor._format_turns_text(turns) == "用户: question"
    assert executor._build_summary_messages("summary")[0]["content"][0]["text"].endswith("summary")
    assert executor._summarize_turns_for_context(turns) == "summary"


def test_context_trim_preserves_recent_turns_and_summary():
    executor = make_executor(max_context_turns=2)
    executor.messages = [
        {"role": role, "content": [{"type": "text", "text": f"{role}-{turn}"}]}
        for turn in range(4)
        for role in ("user", "assistant")
    ]
    executor._trim_messages()
    assert len(executor.messages) == 6
    assert "summary" in executor.messages[0]["content"][0]["text"]
    assert executor.messages[-1]["content"][0]["text"] == "assistant-3"


def test_context_summary_failure_flushes_memory_and_keeps_recent_turns():
    executor = make_executor(max_context_turns=1)
    executor.agent.model.call.side_effect = RuntimeError("unavailable")
    executor.agent.memory_manager = SimpleNamespace(flush_memory=Mock())
    executor.messages = [{"role": "user", "content": str(index)} for index in range(4)]
    executor._trim_messages()
    assert [message["content"] for message in executor.messages] == ["2", "3"]
    executor.agent.memory_manager.flush_memory.assert_called_once()


def test_context_overflow_retains_complete_tool_pairs():
    executor = make_executor()
    executor.messages = [
        message
        for index in range(7)
        for message in [
            {"role": "user", "content": f"question {index}"},
            {
                "role": "assistant",
                "content": [{"type": "tool_use", "id": str(index), "name": "lookup", "input": {}}],
            },
            {
                "role": "user",
                "content": [
                    {"type": "tool_result", "tool_use_id": str(index), "content": "x" * 12_000}
                ],
            },
        ]
    ]
    assert executor._aggressive_trim_for_overflow()
    assert len(executor._identify_complete_turns()) == 5
    assert executor.messages[0]["content"] == "question 2"
    executor._validate_and_fix_messages()
    assert len(executor.messages) == 15
    assert "Truncated for context recovery" in executor.messages[-1]["content"][0]["content"]


@pytest.mark.parametrize("tool_class", [ReadFileTool, WriteFileTool])
@pytest.mark.parametrize("escape", ["../workspace-other/secret.txt", "absolute", "symlink"])
def test_file_tools_reject_workspace_escape(tmp_path, tool_class, escape):
    workspace = tmp_path / "workspace"
    outside = tmp_path / "workspace-other"
    workspace.mkdir()
    outside.mkdir()
    secret = outside / "secret.txt"
    secret.write_text("private")
    if escape == "absolute":
        target = str(secret)
    elif escape == "symlink":
        (workspace / "linked").symlink_to(outside, target_is_directory=True)
        target = "linked/secret.txt"
    else:
        target = escape
    result = tool_class(workspace_dir=str(workspace)).execute(
        {"path": target, "content": "changed"}
    )
    assert result.status == "error"
    assert "outside workspace" in result.result
    assert secret.read_text() == "private"


def test_file_tools_keep_valid_relative_and_absolute_paths(tmp_path):
    writer = WriteFileTool(workspace_dir=str(tmp_path))
    assert writer.execute({"path": "nested/item.txt", "content": "a\nb\nc"}).status == "success"
    reader = ReadFileTool(workspace_dir=str(tmp_path))
    result = reader.execute(
        {"path": str(tmp_path / "nested/item.txt"), "start_line": 2, "num_lines": 1}
    )
    assert result.status == "success"
    assert "2: b" in result.result


@pytest.mark.parametrize("provider_class", [OpenAICompatibleProvider, OpenAIResponsesProvider])
def test_provider_stream_skips_invalid_lines_and_stops_at_done(provider_class):
    event = '{"choices":[{"delta":{"content":"hello"}}]}'
    if provider_class is OpenAIResponsesProvider:
        event = '{"type":"response.output_text.delta","delta":"hello"}'
    payload = f": keepalive\n\ndata: invalid\n\ndata: {event}\n\ndata: [DONE]\n\ndata: {event}\n\n"
    provider = provider_class(api_key="test")
    with httpx.Client(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, text=payload))
    ) as client:
        provider.client = client
        chunks = list(provider.call_stream(LLMRequest(messages=[])))
    assert len(chunks) == 1
    assert chunks[0]["choices"][0]["delta"]["content"] == "hello"


def test_stream_accumulates_interleaved_tool_arguments_in_index_order():
    class Model:
        def call_stream(self, request):
            yield {"choices": [{"delta": {"reasoning_content": "hidden", "content": "checking"}}]}
            yield {
                "choices": [
                    {
                        "delta": {
                            "tool_calls": [
                                {
                                    "index": 1,
                                    "id": "b",
                                    "function": {"name": "second", "arguments": '{"n":'},
                                },
                                {
                                    "index": 0,
                                    "id": "a",
                                    "function": {"name": "first", "arguments": "{}"},
                                },
                            ]
                        }
                    }
                ]
            }
            yield {
                "choices": [
                    {
                        "delta": {"tool_calls": [{"index": 1, "function": {"arguments": "2}"}}]},
                        "finish_reason": "tool_calls",
                    }
                ]
            }

    events = []
    executor = make_executor(Model(), on_event=events.append)
    text, calls = executor._call_llm_stream()
    assert text == "checking"
    assert [(call["id"], call["arguments"]) for call in calls] == [("a", {}), ("b", {"n": 2})]
    assert [event["type"] for event in events] == [
        "llm_call_start",
        "message_start",
        "reasoning_update",
        "message_update",
        "message_end",
        "llm_call_end",
    ]
    assert executor.messages[-1]["content"][0] == {"type": "thinking", "thinking": "hidden"}


def test_malformed_tool_chunk_keeps_preceding_text_event():
    class Model:
        def call_stream(self, request):
            yield {
                "choices": [
                    {
                        "delta": {
                            "content": "partial",
                            "tool_calls": [{"index": 0, "function": 1}],
                        }
                    }
                ]
            }

    events = []
    executor = make_executor(Model(), on_event=events.append)
    with pytest.raises(AttributeError):
        executor._call_llm_stream(max_retries=0)
    assert [event["type"] for event in events] == [
        "llm_call_start",
        "message_start",
        "message_update",
        "llm_call_error",
    ]
    assert events[2]["data"] == {"delta": "partial"}


def test_builtin_schemas_are_lazy_and_factories_keep_user_dependencies(tmp_path):
    manager = ToolManager(workspace_dir=str(tmp_path), user_id="user-one")
    memory = object()
    with patch.object(
        manager, "_instantiate_tool", side_effect=AssertionError("schema created runtime service")
    ):
        manager.load_builtin_tools(memory_manager=memory)
        names = [item["function"]["name"] for item in manager.get_tool_schemas_for_llm()]
        assert list(manager.list_tools()) == names
        assert names[-1] == "scheduler"
        assert {"web_search", "portfolio", "watchlist", "memory_search", "knowledge_get"} <= set(
            names
        )
    manager.settings = SimpleNamespace(
        search_api_url="https://example.invalid", search_api_key="test"
    )
    manager.user_id = "user-two"
    assert manager.create_tool("portfolio").settings is manager.settings
    assert manager.create_tool("portfolio").user_id == "user-two"
    assert manager.create_tool("memory_search").memory_manager is memory
    assert manager.create_tool("read_file").workspace_dir == tmp_path.resolve()
    assert manager.create_tool("bash").cwd == str(tmp_path)
    assert manager.create_tool("web_search").config["api_key"] == "test"
    manager.tool_configs["read_file"] = {"marker": "user config"}
    assert manager.create_tool("read_file").config == {"marker": "user config"}


def test_custom_tool_constructor_and_metadata_remain_supported(tmp_path):
    (tmp_path / "custom.py").write_text("""from app.core.tools.base_tool import BaseTool
class GetLongbridgeCustomTool(BaseTool):
    def __init__(self):
        self.name = "custom_quote"
        self.description = "custom description"
""")
    manager = ToolManager()
    manager.load_tools_from_directory(str(tmp_path))
    assert manager.create_tool("custom_quote").description == "custom description"
    assert manager.get_tool_schemas_for_llm()[0]["function"]["name"] == "custom_quote"


@pytest.mark.parametrize("value, expected", [(None, None), ("", None), ("2", 2), (3, 3)])
def test_optional_integer_semantics(value, expected):
    assert optional_positive_int(value, "id") == expected


@pytest.mark.parametrize(
    "value, error",
    [(0, "positive integer"), (-1, "positive integer"), ("bad", "must be an integer")],
)
def test_optional_integer_errors(value, error):
    with pytest.raises(ValueError, match=error):
        optional_positive_int(value, "id")


def test_bounded_integer_defaults_and_caps():
    assert bounded_positive_int(None, 10, 1, 20, "limit") == 10
    assert bounded_positive_int(100, 10, 1, 20, "limit") == 20


@pytest.mark.parametrize("transport", ["streamable_http", "sse", "stdio"])
def test_mcp_transports_share_session_lifecycle(transport):
    calls = []

    @asynccontextmanager
    async def connect(*args, **kwargs):
        calls.append("connect")
        yield ("read", "write", None) if transport == "streamable_http" else ("read", "write")
        calls.append("disconnect")

    class Session:
        async def __aenter__(self):
            calls.append("enter")
            return self

        async def __aexit__(self, *args):
            calls.append("exit")

        async def initialize(self):
            calls.append("initialize")

    async def exercise():
        manager = MCPManager({})
        ready = asyncio.get_running_loop().create_future()
        stopped = asyncio.Event()
        stopped.set()

        async def headers(*args):
            return {}

        async def discover(*args):
            calls.append("discover")

        manager._build_http_headers = headers
        manager._build_oauth_authorization_provider = lambda *args: None
        manager._discover_tools = discover
        with (
            patch("mcp.ClientSession", lambda *args: Session()),
            patch("mcp.client.streamable_http.streamablehttp_client", connect),
            patch("mcp.client.sse.sse_client", connect),
            patch("mcp.client.stdio.stdio_client", connect),
        ):
            await manager._run_server_connection(
                "demo",
                {"transport": transport, "url": "https://example.invalid", "command": "fake"},
                stopped,
                ready,
            )
        assert ready.done() and ready.result() is None
        assert manager._states["demo"] == "connected"

    asyncio.run(exercise())
    assert calls == ["connect", "enter", "initialize", "discover", "exit", "disconnect"]


@pytest.mark.parametrize("failure_at", ["initialize", "discover"])
def test_mcp_failed_session_closes_without_publishing_ready(failure_at):
    calls = []

    class Session:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            calls.append("closed")

        async def initialize(self):
            if failure_at == "initialize":
                raise RuntimeError("failed")

    async def exercise():
        manager = MCPManager({})
        ready = asyncio.get_running_loop().create_future()

        async def discover(*args):
            raise RuntimeError("failed")

        manager._discover_tools = discover
        with (
            patch("mcp.ClientSession", lambda *args: Session()),
            pytest.raises(RuntimeError, match="failed"),
        ):
            await manager._serve_session("demo", None, None, asyncio.Event(), ready)
        assert "demo" not in manager._sessions
        assert manager._states.get("demo") != "connected"
        assert not ready.done()

    asyncio.run(exercise())
    assert calls == ["closed"]


def test_trace_finish_drains_messages_and_keeps_request_result_separate(tmp_path):
    session = ChatSessionStore(str(tmp_path)).create_session(title="trace")
    store = TraceStore(str(tmp_path))
    recorder = TraceRecorder.start(store, session["id"], "hello")
    events = [
        ("turn_start", {"turn": 1}),
        (
            "llm_call_start",
            {
                "llm_call_id": "llm",
                "request": {
                    "api_key": "secret",
                    "messages": [{"type": "thinking", "thinking": "private"}],
                },
            },
        ),
        ("message_update", {"delta": "hello "}),
        ("message_update", {"delta": "world"}),
        ("message_end", {}),
        ("llm_call_end", {"llm_call_id": "llm", "response": {"content": "hello world"}}),
        (
            "tool_execution_start",
            {"tool_call_id": "tool", "tool_name": "lookup", "arguments": {"symbol": "AAPL"}},
        ),
        (
            "tool_execution_end",
            {
                "tool_call_id": "tool",
                "tool_name": "lookup",
                "status": "success",
                "result": {"price": 1},
            },
        ),
        ("turn_end", {"turn": 1}),
    ]
    for index, (event_type, data) in enumerate(events):
        recorder.handle_event({"type": event_type, "data": data, "timestamp": 1000 + index})
    recorder.finish("done", final_response="hello world")
    recorder.finish("error")
    recorder.handle_event({"type": "error", "data": {"error": "late"}})
    run = store.get_session_traces(session["id"])["runs"][0]
    nodes = run["events"]
    assert [node["node_type"] for node in nodes] == [
        "agent_run",
        "turn",
        "llm_call",
        "message_delta",
        "tool_call",
        "tool_result",
        "agent_end",
    ]
    by_type = {node["node_type"]: node for node in nodes}
    assert by_type["message_delta"]["parent_id"] == by_type["llm_call"]["id"]
    assert by_type["message_delta"]["payload"]["content"] == "hello world"
    assert by_type["message_delta"]["payload"]["delta_count"] == 2
    assert by_type["tool_result"]["parent_id"] == by_type["tool_call"]["id"]
    assert "result" not in by_type["tool_call"]["payload"]
    assert "arguments" not in by_type["tool_result"]["payload"]
    request = by_type["llm_call"]["payload"]["request"]
    assert request["api_key"] == "[redacted]"
    assert request["messages"] == [{"type": "thinking", "omitted": True}]


def test_trace_parallel_children_with_reused_ids_keep_distinct_parents(tmp_path):
    session = ChatSessionStore(str(tmp_path)).create_session(title="parallel trace")
    store = TraceStore(str(tmp_path))
    recorder = TraceRecorder.start(store, session["id"], "research")
    recorder.handle_event(
        {"type": "subagent_batch_start", "data": {"batch_id": "batch", "task_count": 2}}
    )
    for task in ("one", "two"):
        recorder.handle_event(
            {"type": "subagent_start", "data": {"batch_id": "batch", "task_id": task, "role": task}}
        )
    for event_type, event_data in [
        ("turn_start", {"turn": 1}),
        ("llm_call_start", {"llm_call_id": "same"}),
        ("message_update", {"delta": "chunk"}),
        ("llm_call_end", {"llm_call_id": "same", "response": {"content": "done"}}),
        (
            "tool_execution_start",
            {"tool_call_id": "same", "tool_name": "lookup", "arguments": {"id": 1}},
        ),
        (
            "tool_execution_end",
            {"tool_call_id": "same", "tool_name": "lookup", "status": "success", "result": "done"},
        ),
        ("turn_end", {"turn": 1}),
    ]:
        for task in ("one", "two"):
            recorder.handle_event(
                {
                    "type": "subagent_event",
                    "data": {
                        "batch_id": "batch",
                        "task_id": task,
                        "role": task,
                        "child_event_type": event_type,
                        "child_data": event_data,
                    },
                }
            )
    recorder.finish("done")
    nodes = store.get_session_traces(session["id"])["runs"][0]["events"]
    by_id = {node["id"]: node for node in nodes}
    assert len([node for node in nodes if node["node_type"] == "subagent"]) == 2
    assert len([node for node in nodes if node["node_type"] == "subagent_turn"]) == 2
    for node_type in (
        "subagent_llm_call",
        "subagent_message_delta",
        "subagent_tool_call",
        "subagent_tool_result",
    ):
        selected = [node for node in nodes if node["node_type"] == node_type]
        assert len(selected) == 2
        assert selected[0]["parent_id"] != selected[1]["parent_id"]
        for node in selected:
            parent = by_id[node["parent_id"]]
            assert node["payload"]["task_id"] == parent["payload"]["task_id"]


def test_trace_error_and_missing_start_fallbacks(tmp_path):
    session = ChatSessionStore(str(tmp_path)).create_session(title="trace errors")
    store = TraceStore(str(tmp_path))
    recorder = TraceRecorder.start(store, session["id"], "hello")
    events = [
        ("turn_start", {}),
        ("llm_call_start", {"llm_call_id": "main", "request": {"model": "test"}}),
        ("message_update", {"delta": "partial"}),
        ("llm_call_error", {"llm_call_id": "main", "error": "timeout"}),
        ("llm_call_end", {"llm_call_id": "missing", "response": {"content": "recovered"}}),
        ("llm_call_error", {"llm_call_id": "missing", "error": "missing start"}),
        ("tool_execution_end", {"tool_call_id": "missing", "status": "error", "result": "failed"}),
        ("error", {"error": "main failure"}),
        ("turn_end", {"error": "failed"}),
    ]
    for index, (name, data) in enumerate(events):
        recorder.handle_event({"type": name, "data": data, "timestamp": 1000 + index})
    for name, data in [
        ("turn_start", {"turn": 1}),
        ("llm_call_start", {"llm_call_id": "child"}),
        ("message_update", {"delta": "child partial"}),
        ("llm_call_error", {"llm_call_id": "child", "error": "child timeout"}),
        ("llm_call_end", {"llm_call_id": "missing"}),
        (
            "tool_execution_end",
            {"tool_call_id": "missing", "status": "error", "result": "child failure"},
        ),
        ("error", {"error": "child error"}),
        ("turn_end", {"turn": 1, "error": "failed"}),
        ("unknown", {}),
    ]:
        recorder.handle_event(
            {
                "type": "subagent_event",
                "data": {
                    "batch_id": "batch",
                    "task_id": "child",
                    "role": "researcher",
                    "child_event_type": name,
                    "child_data": data,
                },
            }
        )
    recorder.handle_event({"type": "unknown"})
    recorder.finish("error", error="failed")
    nodes = store.get_session_traces(session["id"])["runs"][0]["events"]
    assert len(nodes) == 14
    llm_calls = [node for node in nodes if node["node_type"] == "llm_call"]
    assert [node["status"] for node in llm_calls] == ["error", "done"]
    assert llm_calls[0]["payload"]["request"] == {"model": "test"}
    assert llm_calls[0]["duration_ms"] == 2000
    assert {node["node_type"] for node in nodes if node["status"] == "error"} >= {
        "turn",
        "llm_call",
        "tool_result",
        "error",
        "subagent_turn",
        "subagent_llm_call",
        "subagent_tool_result",
        "subagent_error",
    }
    assert (
        next(node for node in nodes if node["node_type"] == "message_delta")["payload"]["content"]
        == "partial"
    )
