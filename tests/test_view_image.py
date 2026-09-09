"""本地图片的路径边界、原生视觉协议与私有附件生命周期。"""

import base64
import copy
import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app.core.agent.context import omit_image_data
from app.core.agent.executor import AgentCancelledError, AgentStreamExecutor
from app.core.agent.models import LLMRequest
from app.core.llm.provider import OpenAICompatibleProvider, OpenAIResponsesProvider
from app.core.tools import view_image
from app.core.tools.base_tool import BaseTool, ToolResult
from app.core.tools.view_image import ViewImageTool


def save_image(path, image_format="PNG", size=(32, 24)):
    Image = pytest.importorskip("PIL.Image")

    Image.new("RGB", size, "white").save(path, format=image_format)


@pytest.mark.parametrize("image_format,mime", [("PNG", "image/png"), ("JPEG", "image/jpeg")])
def test_view_image_returns_original_bytes_only_in_private_channel(tmp_path, image_format, mime):
    target = tmp_path / "chart.image"
    save_image(target, image_format)
    result = ViewImageTool(str(tmp_path)).execute({"path": "chart.image"})
    assert result.status == "success"
    assert result.result["path"] == "chart.image"
    assert (result.result["width"], result.result["height"]) == (32, 24)
    assert result.result["mime_type"] == mime
    block = result.ext_data["image_blocks"][0]
    assert block["source"]["media_type"] == mime
    assert base64.b64decode(block["source"]["data"]) == target.read_bytes()
    assert block["source"]["data"] not in json.dumps(result.result)


@pytest.mark.parametrize("escape", ["parent", "absolute", "symlink"])
def test_view_image_rejects_workspace_escape(tmp_path, escape):
    root = tmp_path / "workspace"
    root.mkdir()
    image = tmp_path / "private.png"
    save_image(image)
    if escape == "parent":
        path = "../private.png"
    elif escape == "absolute":
        path = str(image)
    else:
        (root / "linked.png").symlink_to(image)
        path = "linked.png"
    result = ViewImageTool(str(root)).execute({"path": path})
    assert result.status == "error"
    assert "outside workspace" in result.result
    assert result.ext_data is None


@pytest.mark.parametrize("invalid", ["missing", "directory", "corrupt", "unsupported"])
def test_view_image_rejects_invalid_images(tmp_path, invalid):
    target = tmp_path / "input.png"
    if invalid == "directory":
        target.mkdir()
    elif invalid == "corrupt":
        target.write_bytes(b"not a PNG")
    elif invalid == "unsupported":
        save_image(target, "GIF")
    result = ViewImageTool(str(tmp_path)).execute({"path": "input.png"})
    assert result.status == "error"
    assert result.ext_data is None


@pytest.mark.parametrize("limit", ["MAX_IMAGE_BYTES", "MAX_IMAGE_PIXELS"])
def test_view_image_enforces_resource_limits(tmp_path, monkeypatch, limit):
    save_image(tmp_path / "chart.png")
    monkeypatch.setattr(view_image, limit, 10)
    result = ViewImageTool(str(tmp_path)).execute({"path": "chart.png"})
    assert result.status == "error"
    assert "exceeds" in result.result


@pytest.mark.parametrize("value", [None, "", "   ", 123, []])
def test_view_image_requires_string_path(tmp_path, value):
    assert ViewImageTool(str(tmp_path)).execute({"path": value}).status == "error"


def image_block():
    return {
        "type": "image",
        "source_path": "artifacts/chart.png",
        "source": {"type": "base64", "media_type": "image/png", "data": "PRIVATE_IMAGE_BYTES"},
    }


@pytest.mark.parametrize("provider_class", [OpenAICompatibleProvider, OpenAIResponsesProvider])
@pytest.mark.parametrize("stream", [False, True])
def test_providers_send_native_images_after_tool_output(provider_class, stream):
    provider = provider_class(api_key="test")
    request = LLMRequest(
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "tool_result", "tool_use_id": "call_view", "content": '{"width":32}'},
                    image_block(),
                ],
            }
        ]
    )
    payload = provider._build_payload(request, stream=stream)
    if provider_class is OpenAICompatibleProvider:
        messages = payload["messages"]
        assert messages[0] == {
            "role": "tool",
            "tool_call_id": "call_view",
            "content": '{"width":32}',
        }
        assert messages[1]["content"][0] == {
            "type": "image_url",
            "image_url": {"url": "data:image/png;base64,PRIVATE_IMAGE_BYTES", "detail": "high"},
        }
    else:
        assert payload["input"][0]["type"] == "function_call_output"
        assert payload["input"][1]["content"][0] == {
            "type": "input_image",
            "image_url": "data:image/png;base64,PRIVATE_IMAGE_BYTES",
            "detail": "high",
        }


@pytest.mark.parametrize("cancelled", [False, True])
def test_images_reach_model_but_not_events_or_completed_history(cancelled):
    requests = []
    events = []

    class ImageTool(BaseTool):
        name = "view_image"

        def execute(self, params):
            return ToolResult.success(
                {"path": "artifacts/chart.png"}, ext_data={"image_blocks": [image_block()]}
            )

    class Model:
        def call_stream(self, request):
            requests.append(copy.deepcopy(request.messages))
            if len(requests) == 1:
                yield {
                    "choices": [
                        {
                            "delta": {
                                "tool_calls": [
                                    {
                                        "index": 0,
                                        "id": "call_view",
                                        "function": {"name": "view_image", "arguments": "{}"},
                                    }
                                ]
                            },
                            "finish_reason": "tool_calls",
                        }
                    ]
                }
            else:
                if cancelled:
                    raise AgentCancelledError("cancelled")
                yield {"choices": [{"delta": {"content": "checked"}, "finish_reason": "stop"}]}

    model = Model()
    agent = SimpleNamespace(
        model=model,
        memory_manager=None,
        settings=None,
        max_context_tokens=100_000,
        _get_model_context_window=lambda: 100_000,
        _estimate_message_tokens=lambda message: 100,
    )
    executor = AgentStreamExecutor(agent, model, "system", [ImageTool()], on_event=events.append)
    if cancelled:
        with pytest.raises(AgentCancelledError):
            executor.run_stream("inspect")
    else:
        assert executor.run_stream("inspect") == "checked"
    assert requests[1][-1]["content"][1] == image_block()
    assert "PRIVATE_IMAGE_BYTES" not in json.dumps(events)
    assert "PRIVATE_IMAGE_BYTES" not in json.dumps(executor.messages)
    assert "artifacts/chart.png" in json.dumps(executor.messages)


def test_omitting_images_does_not_mutate_active_llm_input():
    messages = [{"role": "user", "content": [image_block()]}]
    redacted = omit_image_data(messages)
    assert "PRIVATE_IMAGE_BYTES" in json.dumps(messages)
    assert "PRIVATE_IMAGE_BYTES" not in json.dumps(redacted)
    assert "view_image again" in json.dumps(redacted)


def test_render_artifact_references_are_persisted_and_reloaded(tmp_path, monkeypatch):
    from app.api import agent as api
    from app.core.session.store import ChatSessionStore
    from app.schemas import ChatRequest

    store = ChatSessionStore(str(tmp_path))
    session = store.create_session(user_id="alice")
    artifacts = [
        {
            "artifact_id": "one",
            "width": 2400,
            "height": 3600,
            "files": {"image": "artifacts/renderings/one/image.png"},
        }
    ]
    monkeypatch.setattr(api, "get_session_store", lambda: store)
    api._persist_exchange(session["id"], "draw", "done", True, rendered_images=artifacts)
    history = store.get_messages(session["id"])
    assert history[-1]["metadata"]["rendered_images"] == artifacts
    monkeypatch.setattr(api, "_build_agent", lambda user_id: SimpleNamespace(messages=[]))
    agent = api._init_agent(ChatRequest(message="inspect again", user_id="alice"), history)
    assert "artifacts/renderings/one/image.png" in json.dumps(agent.messages)


def test_sync_chat_response_keeps_artifact_references(tmp_path, monkeypatch):
    from app.api import agent as api
    from app.core.session.store import ChatSessionStore
    from app.schemas import ChatRequest

    store = ChatSessionStore(str(tmp_path))
    session = store.create_session(user_id="alice")
    artifacts = [
        {
            "artifact_id": "one",
            "width": 2400,
            "height": 3600,
            "files": {"image": "artifacts/renderings/one/image.png"},
        }
    ]
    agent = SimpleNamespace(
        run_stream=Mock(return_value="done"), last_sources=[], last_rendered_images=artifacts
    )
    monkeypatch.setattr(api, "get_session_store", lambda: store)
    monkeypatch.setattr(api, "_prepare_session", lambda *args: (session["id"], []))
    monkeypatch.setattr(api, "_start_trace", lambda *args: None)
    monkeypatch.setattr(api, "_init_agent", lambda *args: agent)
    monkeypatch.setattr(api, "_schedule_memory_curate", lambda **kwargs: None)
    response = api.chat(ChatRequest(message="draw"), SimpleNamespace(id="alice"))
    assert response.rendered_images == artifacts
    assert store.get_messages(session["id"])[-1]["metadata"]["rendered_images"] == artifacts


def test_stream_completion_keeps_artifact_references(tmp_path, monkeypatch):
    from app.api import agent as api
    from app.core.agent.run_service import ChatRun
    from app.core.session.store import ChatSessionStore
    from app.schemas import ChatRequest

    store = ChatSessionStore(str(tmp_path))
    session = store.create_session(user_id="alice")
    artifacts = [
        {
            "artifact_id": "one",
            "width": 2400,
            "height": 3600,
            "files": {"image": "artifacts/renderings/one/image.png"},
        }
    ]
    agent = SimpleNamespace(
        run_stream=Mock(return_value="done"), last_sources=[], last_rendered_images=artifacts
    )
    monkeypatch.setattr(api, "get_session_store", lambda: store)
    monkeypatch.setattr(api, "_start_trace", lambda *args: None)
    monkeypatch.setattr(api, "_init_agent", lambda *args: agent)
    monkeypatch.setattr(api, "_schedule_memory_curate", lambda **kwargs: None)
    run = ChatRun("alice", "request", "fingerprint", session["id"], "draw")
    try:
        api._run_stream_chat(ChatRequest(message="draw", user_id="alice"), run, [])
        events, done = run._read(0)
        assert done
        assert events[-1]["type"] == "agent_end"
        assert events[-1]["data"]["rendered_images"] == artifacts
        assert store.get_messages(session["id"])[-1]["metadata"]["rendered_images"] == artifacts
    finally:
        run.close()
