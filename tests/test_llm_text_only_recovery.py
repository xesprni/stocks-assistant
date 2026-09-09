"""仅文本网关拒绝图片时保留工具协议、历史及产物，并有界恢复。"""

import copy
import json
from types import SimpleNamespace

import httpx
import pytest

from app.core.agent.executor import AgentStreamExecutor
from app.core.agent.models import LLMRequest
from app.core.llm.errors import ProviderErrorKind, ProviderHTTPError
from app.core.llm.provider import OpenAICompatibleProvider
from app.core.tools.base_tool import BaseTool, ToolResult

TEXT_ONLY_ERROR = "messages.content.type is invalid, allowed values: ['text']"


def image_block():
    return {
        "type": "image",
        "source_path": "artifacts/chart.png",
        "source": {"type": "base64", "media_type": "image/png", "data": "PRIVATE_IMAGE_BYTES"},
    }


def image_request():
    return LLMRequest(
        system="Use the available evidence.",
        model="configured-model",
        temperature=0.2,
        max_tokens=512,
        tool_choice="auto",
        tools=[{"name": "view_image", "parameters": {"type": "object"}}],
        messages=[
            {"role": "user", "content": "Keep this research context."},
            {
                "role": "assistant",
                "content": [
                    {"type": "tool_use", "id": "view-1", "name": "view_image", "input": {}}
                ],
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": "view-1",
                        "content": '{"path":"artifacts/chart.png","width":32}',
                    },
                    {"type": "text", "text": "Explain what can be verified."},
                    image_block(),
                ],
            },
        ],
    )


def success_response(stream, content="Text-based answer."):
    if stream:
        chunk = {"choices": [{"delta": {"content": content}, "finish_reason": "stop"}]}
        return httpx.Response(200, text=f"data: {json.dumps(chunk)}\n\ndata: [DONE]\n\n")
    return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})


def invoke(provider, request, stream):
    return list(provider.call_stream(request)) if stream else provider.call(request)


@pytest.mark.parametrize("stream", [False, True])
def test_text_only_recovery_keeps_history_tool_pairs_and_runtime_parameters(stream):
    request = image_request()
    original = copy.deepcopy(vars(request))
    attempts, failures = [], []

    def handler(http_request):
        attempts.append(json.loads(http_request.content))
        if len(attempts) == 1:
            response = httpx.Response(400, json={"error": {"message": TEXT_ONLY_ERROR}})
            failures.append(response)
            return response
        assert failures[0].is_closed
        return success_response(stream)

    provider = OpenAICompatibleProvider("test-key")
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        provider.client = client
        invoke(provider, request, stream)
    assert len(attempts) == 2
    assert vars(request) == original
    first, retry = attempts
    assert {k: v for k, v in first.items() if k != "messages"} == {
        k: v for k, v in retry.items() if k != "messages"
    }
    assert retry["messages"][:-1] == first["messages"][:-1]
    assert retry["messages"][-2]["tool_call_id"] == "view-1"
    assert "artifacts/chart.png" in retry["messages"][-2]["content"]
    notice = retry["messages"][-1]["content"]
    assert notice.startswith("Explain what can be verified.")
    assert "could not be inspected" in notice
    assert "do not infer image contents" in notice
    assert "PRIVATE_IMAGE_BYTES" not in json.dumps(retry)
    assert "PRIVATE_IMAGE_BYTES" in json.dumps(first)


@pytest.mark.parametrize("stream", [False, True])
def test_image_only_message_keeps_a_notice_and_failed_retry_is_bounded(stream):
    request = LLMRequest(messages=[{"role": "user", "content": [image_block()]}])
    original = copy.deepcopy(request.messages)
    attempts = []

    def handler(http_request):
        attempts.append(json.loads(http_request.content))
        return httpx.Response(400, json={"error": {"message": TEXT_ONLY_ERROR}})

    provider = OpenAICompatibleProvider("test-key")
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        provider.client = client
        with pytest.raises(ProviderHTTPError) as raised:
            invoke(provider, request, stream)
    assert raised.value.kind == ProviderErrorKind.UNSUPPORTED_CONTENT
    assert len(attempts) == 2
    assert "could not be inspected" in attempts[1]["messages"][0]["content"]
    assert request.messages == original


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize(
    "status,message,include_image",
    [
        (400, "image too large", True),
        (400, "invalid image format", True),
        (400, "model not found", True),
        (400, "tool_result without corresponding tool_use", True),
        (401, TEXT_ONLY_ERROR, True),
        (400, TEXT_ONLY_ERROR, False),
        (400, "messages.content.type is invalid, allowed values: ['text', 'image_url']", True),
    ],
)
def test_other_rejections_are_not_retried_or_silently_changed(
    stream, status, message, include_image
):
    request = (
        image_request()
        if include_image
        else LLMRequest(messages=[{"role": "user", "content": "hello"}])
    )
    attempts = []

    def handler(http_request):
        attempts.append(json.loads(http_request.content))
        return httpx.Response(status, json={"error": {"message": message}})

    provider = OpenAICompatibleProvider("test-key")
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        provider.client = client
        with pytest.raises(ProviderHTTPError):
            invoke(provider, request, stream)
    assert len(attempts) == 1
    assert attempts[0] == provider._build_payload(request, stream=stream)


@pytest.mark.parametrize("stream", [False, True])
def test_image_capable_endpoint_receives_images_without_fallback(stream):
    attempts = []

    def handler(http_request):
        attempts.append(json.loads(http_request.content))
        return success_response(stream)

    provider = OpenAICompatibleProvider("test-key")
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        provider.client = client
        invoke(provider, image_request(), stream)
    assert len(attempts) == 1
    assert "PRIVATE_IMAGE_BYTES" in json.dumps(attempts)
    assert "Image input unavailable" not in json.dumps(attempts)


def test_agent_continues_after_view_image_rejection_without_repeating_the_tool():
    attempts, tool_calls, events = [], [], []
    answer = "The image was saved, but this endpoint cannot inspect it."

    class ImageTool(BaseTool):
        name = "view_image"

        def execute(self, params):
            tool_calls.append(params)
            return ToolResult.success(
                {"path": "artifacts/chart.png"}, ext_data={"image_blocks": [image_block()]}
            )

    def handler(http_request):
        attempts.append(json.loads(http_request.content))
        if len(attempts) == 1:
            chunk = {
                "choices": [
                    {
                        "delta": {
                            "tool_calls": [
                                {
                                    "index": 0,
                                    "id": "view-1",
                                    "type": "function",
                                    "function": {"name": "view_image", "arguments": "{}"},
                                }
                            ]
                        },
                        "finish_reason": "tool_calls",
                    }
                ]
            }
            return httpx.Response(200, text=f"data: {json.dumps(chunk)}\n\ndata: [DONE]\n\n")
        if len(attempts) == 2:
            return httpx.Response(400, json={"error": {"message": TEXT_ONLY_ERROR}})
        return success_response(True, answer)

    provider = OpenAICompatibleProvider("test-key")
    agent = SimpleNamespace(
        model=provider,
        memory_manager=None,
        settings=None,
        max_context_tokens=100_000,
        _get_model_context_window=lambda: 100_000,
        _estimate_message_tokens=lambda _: 100,
    )
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        provider.client = client
        executor = AgentStreamExecutor(
            agent, provider, "system", [ImageTool()], on_event=events.append
        )
        assert executor.run_stream("inspect") == answer
    assert tool_calls == [{}]
    assert len(attempts) == 3
    assert "could not be inspected" in attempts[-1]["messages"][-1]["content"]
    assert "PRIVATE_IMAGE_BYTES" not in json.dumps(events)
    assert "PRIVATE_IMAGE_BYTES" not in json.dumps(executor.messages)
    assert "artifacts/chart.png" in json.dumps(executor.messages)
