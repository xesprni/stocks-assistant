import unittest

import httpx

from app.core.agent.models import LLMRequest
from app.core.llm.provider import OpenAICompatibleProvider, OpenAIResponsesProvider


class OpenAIResponsesProviderTest(unittest.TestCase):
    def test_stream_error_response_body_is_read_before_formatting(self):
        def handler(request):
            return httpx.Response(400, json={"error": {"message": "bad stream request"}}, request=request)

        provider = OpenAICompatibleProvider(api_key="test-key", model="gpt-4o")
        provider.client = httpx.Client(transport=httpx.MockTransport(handler))
        try:
            with self.assertRaisesRegex(httpx.HTTPStatusError, "bad stream request"):
                list(provider.call_stream(LLMRequest(messages=[])))
        finally:
            provider.client.close()

    def test_build_payload_converts_messages_tools_and_tool_results(self):
        provider = OpenAIResponsesProvider(api_key="test-key", model="gpt-5.2-codex")
        request = LLMRequest(
            system="You are helpful.",
            messages=[
                {"role": "user", "content": [{"type": "text", "text": "Check AAPL."}]},
                {
                    "role": "assistant",
                    "content": [
                        {"type": "text", "text": "I will call a tool."},
                        {"type": "tool_use", "id": "call_123", "name": "get_quote", "input": {"symbol": "AAPL"}},
                    ],
                },
                {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "call_123", "content": "{\"price\": 200}"}]},
            ],
            tools=[
                {
                    "name": "get_quote",
                    "description": "Get a quote.",
                    "parameters": {"type": "object", "properties": {"symbol": {"type": "string"}}},
                }
            ],
            max_tokens=500,
            tool_choice="required",
        )

        payload = provider._build_payload(request, stream=True)

        self.assertEqual(payload["model"], "gpt-5.2-codex")
        self.assertEqual(payload["instructions"], "You are helpful.")
        self.assertTrue(payload["stream"])
        self.assertEqual(payload["max_output_tokens"], 500)
        self.assertEqual(payload["tool_choice"], "required")
        self.assertNotIn("temperature", payload)
        self.assertEqual(payload["tools"][0]["type"], "function")
        self.assertEqual(payload["tools"][0]["name"], "get_quote")
        self.assertEqual(payload["input"][0]["type"], "message")
        self.assertEqual(payload["input"][1]["content"][0]["type"], "output_text")
        self.assertEqual(payload["input"][2]["type"], "function_call")
        self.assertEqual(payload["input"][2]["call_id"], "call_123")
        self.assertEqual(payload["input"][3]["type"], "function_call_output")
        self.assertEqual(payload["input"][3]["call_id"], "call_123")

    def test_responses_payload_enables_reasoning_when_requested(self):
        provider = OpenAIResponsesProvider(api_key="test-key", model="gpt-5.2-codex")

        payload = provider._build_payload(
            LLMRequest(messages=[], thinking_enabled=True, reasoning_effort="medium"),
            stream=True,
        )

        self.assertEqual(payload["reasoning"], {"effort": "medium", "summary": "auto"})

    def test_chat_completions_payload_enables_reasoning_when_requested(self):
        provider = OpenAICompatibleProvider(api_key="test-key", model="gpt-5")

        payload = provider._build_payload(
            LLMRequest(messages=[], thinking_enabled=True, reasoning_effort="medium"),
            stream=True,
        )

        self.assertEqual(payload["reasoning_effort"], "medium")

    def test_chat_completions_payload_applies_runtime_parameters(self):
        provider = OpenAICompatibleProvider(api_key="test-key", model="gpt-4o")

        payload = provider._build_payload(
            LLMRequest(
                messages=[],
                temperature=0.3,
                max_tokens=1200,
                tools=[{"name": "read_file", "description": "Read file.", "parameters": {"type": "object"}}],
                tool_choice="none",
            ),
            stream=True,
        )

        self.assertEqual(payload["temperature"], 0.3)
        self.assertEqual(payload["max_tokens"], 1200)
        self.assertEqual(payload["tool_choice"], "none")

    def test_codex_oauth_headers_and_store_flag_are_applied(self):
        provider = OpenAIResponsesProvider(
            api_key="oauth-token",
            model="gpt-5.2-codex",
            extra_headers={"ChatGPT-Account-Id": "workspace-123", "OpenAI-Beta": "responses=experimental"},
            store_response=False,
        )
        payload = provider._build_payload(LLMRequest(messages=[]))
        headers = provider._headers()

        self.assertFalse(payload["store"])
        self.assertEqual(headers["Authorization"], "Bearer oauth-token")
        self.assertEqual(headers["ChatGPT-Account-Id"], "workspace-123")
        self.assertEqual(headers["OpenAI-Beta"], "responses=experimental")

    def test_adapts_responses_output_to_chat_completion_shape(self):
        provider = OpenAIResponsesProvider(api_key="test-key", model="gpt-5.2-codex")
        raw = {
            "id": "resp_123",
            "model": "gpt-5.2-codex",
            "output": [
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": "Looking this up."}],
                },
                {
                    "type": "function_call",
                    "call_id": "call_quote",
                    "name": "get_quote",
                    "arguments": "{\"symbol\":\"AAPL\"}",
                },
            ],
        }

        converted = provider._adapt_response_to_chat(raw)

        choice = converted["choices"][0]
        self.assertEqual(choice["finish_reason"], "tool_calls")
        self.assertEqual(choice["message"]["content"], "Looking this up.")
        self.assertEqual(choice["message"]["tool_calls"][0]["id"], "call_quote")
        self.assertEqual(choice["message"]["tool_calls"][0]["function"]["name"], "get_quote")
        self.assertEqual(choice["message"]["tool_calls"][0]["function"]["arguments"], "{\"symbol\":\"AAPL\"}")

    def test_stream_events_become_chat_chunks(self):
        provider = OpenAIResponsesProvider(api_key="test-key", model="gpt-5.2-codex")
        state = {"saw_function_call": False, "argument_buffers": {}}

        text_chunks = provider._stream_event_to_chat_chunks(
            {"type": "response.output_text.delta", "delta": "Hello"},
            state,
        )
        call_chunks = provider._stream_event_to_chat_chunks(
            {
                "type": "response.output_item.added",
                "output_index": 0,
                "item": {"type": "function_call", "call_id": "call_1", "name": "read_file", "arguments": ""},
            },
            state,
        )
        arg_chunks = provider._stream_event_to_chat_chunks(
            {"type": "response.function_call_arguments.delta", "output_index": 0, "delta": "{\"path\":\"x\"}"},
            state,
        )
        done_chunks = provider._stream_event_to_chat_chunks({"type": "response.completed"}, state)

        self.assertEqual(text_chunks[0]["choices"][0]["delta"]["content"], "Hello")
        self.assertEqual(call_chunks[0]["choices"][0]["delta"]["tool_calls"][0]["id"], "call_1")
        self.assertEqual(call_chunks[0]["choices"][0]["delta"]["tool_calls"][0]["function"]["name"], "read_file")
        self.assertEqual(arg_chunks[0]["choices"][0]["delta"]["tool_calls"][0]["function"]["arguments"], "{\"path\":\"x\"}")
        self.assertEqual(done_chunks[0]["choices"][0]["finish_reason"], "tool_calls")


if __name__ == "__main__":
    unittest.main()
