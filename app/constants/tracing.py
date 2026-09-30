"""tracing 领域常量的唯一定义。"""

MAX_TRACE_STRING_CHARS = 50_000

MAX_RESPONSE_PREVIEW_CHARS = 1_000

_TRUNCATION_MARKER = "\n\n[Trace payload truncated: {original} chars total]"

_SECRET_KEYS = ("api_key", "authorization", "password", "secret", "token")

_TOOL_CALL_NODE_TYPES = {"tool_call", "subagent_tool_call"}

_TOOL_RESULT_NODE_TYPES = {"tool_result", "subagent_tool_result"}


DEFAULT_TRACE_LIMIT = 20
MAX_TRACE_LIMIT = 100
