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
        parent_agent = getattr(self, "context", None)
        if not parent_agent:
            return ToolResult.fail("delegate_agent requires an active Agent context")

        current_tool_call = getattr(self, "current_tool_call", {}) or {}
        runner = SubAgentRunner(
            parent_agent=parent_agent,
            event_emitter=getattr(self, "event_emitter", None),
            # 传入父工具调用 ID，追踪视图可以把整批子 Agent 挂到对应 delegate_agent 节点下。
            parent_tool_call_id=current_tool_call.get("id"),
            cancel_event=getattr(self, "cancel_event", None),
            thinking_enabled=getattr(self, "thinking_enabled", None),
            runtime=getattr(self, "delegation_runtime", None),
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
        result["metadata_truncated"] = metadata["metadata_truncated"]
        result["metadata_counts"] = metadata["counts"]
        if result["status"] == "error":
            return ToolResult.fail(result, ext_data=metadata)
        return ToolResult.success(result, ext_data=metadata)
