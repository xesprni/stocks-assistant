"""Delegate work to configured sub-agents."""

from typing import Any

from pydantic import ValidationError

from app.core.agent.delegation_results import compact_batch_results
from app.core.agent.delegation_runtime import AgentCancelledError
from app.core.agent.subagent import (
    SubAgentCancelledError,
    SubAgentRunner,
    SubAgentValidationError,
)
from app.core.tools.base_tool import BaseTool, ToolResult
from app.core.tools.call_context import ToolCallContext
from app.schemas.delegation import DelegateAgentRequest


class DelegateAgentTool(BaseTool):
    name: str = "delegate_agent"
    description: str = (
        "Delegate bounded tasks to configured roles. Independent tasks run in parallel up to the "
        "parent run's concurrency limit; excess tasks queue. Give unique task ids and depends_on "
        "ids to run synthesis/review after successful prerequisites; a failed prerequisite skips "
        "its dependents. Supply shared_context with the objective, constraints, sources and SAME "
        "data snapshot; children do not inherit chat history. Tools and skills can only be narrowed "
        "within parent/role permissions. Tasks have configured deadlines and inherit cancellation. "
        "Returns every task's status, a bounded brief, and source/artifact references. Inspect "
        "partial failures and conflicting evidence before synthesizing the final answer yourself. "
        "Do not automatically retry side-effecting work after a timeout."
    )
    params: dict = DelegateAgentRequest.model_json_schema()

    def execute(self, params: dict[str, Any]) -> ToolResult:
        return self.invoke(params, ToolCallContext.from_legacy_tool(self))

    def invoke(self, params: dict[str, Any], context: ToolCallContext) -> ToolResult:
        if context.parent_agent is None:
            return ToolResult.fail("delegate_agent requires an active Agent context")
        runner = SubAgentRunner(
            parent_agent=context.parent_agent,
            event_emitter=context.event_emitter,
            parent_tool_call_id=context.tool_call_id or None,
            cancel_event=context.cancel_event,
            thinking_enabled=context.thinking_enabled,
            runtime=context.delegation_runtime,
        )
        try:
            request = DelegateAgentRequest.model_validate(params)
            result = runner.run_batch(
                [task.model_dump(exclude_none=True) for task in request.tasks],
                request.shared_context,
            )
        except SubAgentCancelledError as exc:
            _, exc.metadata = compact_batch_results(exc.batch_result["results"])
            raise
        except AgentCancelledError:
            raise
        except (SubAgentValidationError, ValidationError) as exc:
            return ToolResult.fail(str(exc))
        except Exception as exc:
            return ToolResult.fail(f"delegate_agent failed: {exc}")
        result["results"], metadata = compact_batch_results(result["results"])
        metadata["preserve_partial"] = True
        result["metadata_truncated"] = metadata["metadata_truncated"]
        result["metadata_counts"] = metadata["counts"]
        if result["status"] == "error":
            return ToolResult.fail(result, ext_data=metadata)
        return ToolResult.success(result, ext_data=metadata)
