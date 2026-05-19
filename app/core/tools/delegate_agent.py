"""Delegate work to configured sub-agents."""

from typing import Any, Dict

from app.core.agent.subagent import SubAgentRunner, SubAgentValidationError
from app.core.tools.base_tool import BaseTool, ToolResult


class DelegateAgentTool(BaseTool):
    name: str = "delegate_agent"
    description: str = (
        "Delegate complex, separable work to configured sub-agents. Use for parallel research, "
        "independent analysis, or critique. The final answer remains the parent agent's responsibility."
    )
    params: dict = {
        "type": "object",
        "properties": {
            "tasks": {
                "type": "array",
                "description": "Sub-agent tasks to run as one bounded batch.",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string", "description": "Optional stable task id"},
                        "role": {"type": "string", "description": "Configured sub-agent role name"},
                        "task": {"type": "string", "description": "Specific child task"},
                        "tools": {
                            "type": "array",
                            "description": "Requested tool names, narrowed by the role allowlist.",
                            "items": {"type": "string"},
                        },
                        "max_steps": {"type": "integer", "description": "Optional max turns for this child agent"},
                        "skill_filter": {
                            "type": "array",
                            "description": "Optional skill names visible to this child agent",
                            "items": {"type": "string"},
                        },
                    },
                    "required": ["role", "task"],
                },
            },
        },
        "required": ["tasks"],
    }

    def execute(self, params: Dict[str, Any]) -> ToolResult:
        parent_agent = getattr(self, "context", None)
        if not parent_agent:
            return ToolResult.fail("delegate_agent requires an active Agent context")

        current_tool_call = getattr(self, "current_tool_call", {}) or {}
        runner = SubAgentRunner(
            parent_agent=parent_agent,
            event_emitter=getattr(self, "event_emitter", None),
            parent_tool_call_id=current_tool_call.get("id"),
        )
        try:
            result = runner.run_batch(params.get("tasks"))
        except SubAgentValidationError as exc:
            return ToolResult.fail(str(exc))
        except Exception as exc:
            return ToolResult.fail(f"delegate_agent failed: {exc}")
        return ToolResult.success(result)
