"""Agent-facing scheduler management tool."""

import asyncio
from datetime import datetime, timedelta
import threading
from typing import Any, Optional
import uuid

from croniter import croniter

from app.core.tools.base_tool import BaseTool, ToolResult
from app.core.tools.scheduler.helpers import (
    parse_schedule_components,
    parse_schedule_expression,
    run_to_response,
    task_to_response,
)

import logging

logger = logging.getLogger("stocks-assistant.scheduler")


class SchedulerTool(BaseTool):
    name: str = "scheduler"
    description: str = (
        "Create, query, update, delete, toggle, run and inspect scheduled tasks. "
        "Actions: create, list, get, update, delete, toggle, run, list_runs, enable, disable. "
        "Use schedule for API-style expressions: cron, 'every 5 minutes', '+10m', ISO timestamps, or 'now'."
    )
    params: dict = {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": [
                    "create",
                    "list",
                    "get",
                    "update",
                    "delete",
                    "toggle",
                    "run",
                    "run_now",
                    "list_runs",
                    "list_task_runs",
                    "enable",
                    "disable",
                ],
            },
            "task_id": {"type": "string"},
            "name": {"type": "string"},
            "prompt": {"type": "string"},
            "schedule": {"type": "string"},
            "enabled": {"type": "boolean"},
            "notify_telegram": {"type": "boolean"},
            "metadata": {"type": "object"},
            "limit": {"type": "integer", "minimum": 1, "maximum": 200},
            "enabled_only": {"type": "boolean"},
            "message": {"type": "string", "description": "Legacy alias for a send_message scheduled task."},
            "ai_task": {"type": "string", "description": "Legacy alias for prompt."},
            "schedule_type": {"type": "string", "enum": ["cron", "interval", "once"]},
            "schedule_value": {"type": "string"},
        },
        "required": ["action"],
    }

    def __init__(self, scheduler_service=None, task_store=None, run_store=None, user_id: Optional[str] = None):
        super().__init__()
        self.scheduler_service = scheduler_service
        self.user_id = user_id
        self.task_store = self._scope_store(task_store or getattr(scheduler_service, "task_store", None), user_id)
        self.run_store = self._scope_store(run_store or getattr(scheduler_service, "run_store", None), user_id)

    def execute(self, params: dict) -> ToolResult:
        action = params.get("action")
        if not self.task_store:
            return ToolResult.fail("Scheduler not initialized")
        try:
            handlers = {
                "create": self._create,
                "list": self._list,
                "get": self._get,
                "update": self._update,
                "delete": self._delete,
                "toggle": self._toggle,
                "run": self._run,
                "run_now": self._run,
                "list_runs": self._list_runs,
                "list_task_runs": self._list_task_runs,
                "enable": self._enable,
                "disable": self._disable,
            }
            handler = handlers.get(action)
            if not handler:
                return ToolResult.fail(f"Unknown action: {action}")
            return ToolResult.success(handler(params))
        except Exception as e:
            return ToolResult.fail(str(e))

    def _create(self, p: dict) -> dict:
        name = self._optional_str(p.get("name"))
        prompt = self._optional_str(p.get("prompt")) or self._optional_str(p.get("ai_task"))
        message = self._optional_str(p.get("message"))
        if not name:
            raise ValueError("Missing name")
        if not prompt and not message:
            raise ValueError("Provide prompt, ai_task, or message")
        if prompt and message:
            raise ValueError("Provide only one of prompt/ai_task or message")

        schedule = self._schedule_from_params(p, required=True)
        if not schedule:
            raise ValueError("Invalid schedule")

        metadata = self._metadata_from_params(p)
        task_id = uuid.uuid4().hex[:8]
        now = datetime.now().isoformat()
        task_data = {
            "id": task_id,
            "name": name,
            "prompt": prompt or message or "",
            "enabled": bool(p.get("enabled", True)),
            "created_at": now,
            "updated_at": now,
            "schedule": schedule,
            "run_count": 0,
            "metadata": metadata,
        }
        if self.user_id:
            task_data["user_id"] = self.user_id
        if message:
            task_data["action"] = {"type": "send_message", "content": message}

        next_run = self._calculate_next(task_data, datetime.now())
        if next_run:
            task_data["next_run_at"] = next_run.isoformat()
        self.task_store.add_task(task_data)
        return task_to_response(task_data)

    def _list(self, p: dict) -> dict:
        tasks = self.task_store.list_tasks(enabled_only=bool(p.get("enabled_only", False)))
        return {"tasks": [task_to_response(task) for task in tasks], "total": len(tasks)}

    def _get(self, p: dict) -> dict:
        task = self.task_store.get_task(self._task_id(p))
        if not task:
            raise ValueError("Task not found")
        return task_to_response(task)

    def _update(self, p: dict) -> dict:
        task_id = self._task_id(p)
        task = self.task_store.get_task(task_id)
        if not task:
            raise ValueError("Task not found")

        updates: dict[str, Any] = {}
        if "name" in p and p.get("name") is not None:
            updates["name"] = str(p["name"])
        if "prompt" in p and p.get("prompt") is not None:
            updates["prompt"] = str(p["prompt"])
            updates["action"] = None
        elif "ai_task" in p and p.get("ai_task") is not None:
            updates["prompt"] = str(p["ai_task"])
            updates["action"] = None
        elif "message" in p and p.get("message") is not None:
            updates["prompt"] = str(p["message"])
            updates["action"] = {"type": "send_message", "content": str(p["message"])}
        if "enabled" in p and p.get("enabled") is not None:
            updates["enabled"] = bool(p["enabled"])

        schedule = self._schedule_from_params(p, required=False)
        if schedule:
            updates["schedule"] = schedule

        if "metadata" in p or "notify_telegram" in p:
            metadata = dict(task.get("metadata") or {})
            metadata.update(self._metadata_from_params(p, base=metadata))
            updates["metadata"] = metadata

        if "schedule" in updates or "enabled" in updates:
            next_task = {**task, **updates}
            next_run = self._calculate_next(next_task, datetime.now())
            updates["next_run_at"] = next_run.isoformat() if next_run else None

        if not updates:
            return task_to_response(task)

        self.task_store.update_task(task_id, updates)
        updated = self.task_store.get_task(task_id)
        if not updated:
            raise ValueError("Task not found")
        return task_to_response(updated)

    def _delete(self, p: dict) -> dict:
        task_id = self._task_id(p)
        task = self.task_store.get_task(task_id)
        if not task:
            raise ValueError("Task not found")
        self.task_store.delete_task(task_id)
        return {"status": "ok"}

    def _toggle(self, p: dict) -> dict:
        task_id = self._task_id(p)
        task = self.task_store.get_task(task_id)
        if not task:
            raise ValueError("Task not found")
        enabled = not task.get("enabled", True)
        self.task_store.update_task(task_id, {"enabled": enabled})
        return {"status": "ok", "enabled": enabled}

    def _run(self, p: dict) -> dict:
        if not self.scheduler_service:
            raise ValueError("Scheduler service not initialized")
        task_id = self._task_id(p)
        task = self.task_store.get_task(task_id)
        if not task:
            raise ValueError("Task not found")

        if hasattr(self.scheduler_service, "_execute_task"):
            run = self._run_coro_sync(
                self.scheduler_service._execute_task(
                    task,
                    datetime.now(),
                    trigger="manual",
                    update_schedule=False,
                )
            )
        else:
            run = self._run_coro_sync(self.scheduler_service.execute_task_now(task_id))
        return run_to_response(run)

    def _list_runs(self, p: dict) -> dict:
        if not self.run_store:
            return {"runs": [], "total": 0}

        task_id = self._optional_str(p.get("task_id"))
        if task_id and not self.task_store.get_task(task_id):
            raise ValueError("Task not found")
        limit = max(1, min(int(p.get("limit") or 50), 200))
        runs = self.run_store.list_runs(task_id=task_id, limit=limit)
        return {"runs": [run_to_response(run) for run in runs], "total": len(runs)}

    def _list_task_runs(self, p: dict) -> dict:
        self._task_id(p)
        return self._list_runs(p)

    def _enable(self, p: dict) -> dict:
        task_id = self._task_id(p)
        if not self.task_store.get_task(task_id):
            raise ValueError("Task not found")
        self.task_store.enable_task(task_id, True)
        return {"status": "ok", "enabled": True}

    def _disable(self, p: dict) -> dict:
        task_id = self._task_id(p)
        if not self.task_store.get_task(task_id):
            raise ValueError("Task not found")
        self.task_store.enable_task(task_id, False)
        return {"status": "ok", "enabled": False}

    def _calculate_next(self, task: dict, from_time: datetime) -> Optional[datetime]:
        if self.scheduler_service and hasattr(self.scheduler_service, "_calculate_next"):
            return self.scheduler_service._calculate_next(task, from_time)

        schedule = task.get("schedule", {})
        stype = schedule.get("type")
        if stype == "cron":
            try:
                return croniter(schedule["expression"], from_time).get_next(datetime)
            except Exception:
                return None
        if stype == "interval":
            seconds = schedule.get("seconds", 0)
            return from_time + timedelta(seconds=seconds) if seconds > 0 else None
        if stype == "once":
            try:
                run_at = datetime.fromisoformat(schedule["run_at"])
                return run_at if run_at > from_time else None
            except Exception:
                return None
        return None

    def _schedule_from_params(self, p: dict, required: bool) -> Optional[dict[str, Any]]:
        has_schedule = "schedule" in p and p.get("schedule") is not None
        has_legacy_schedule = p.get("schedule_type") is not None or p.get("schedule_value") is not None

        if has_schedule:
            return parse_schedule_expression(str(p["schedule"]))
        if has_legacy_schedule:
            schedule = parse_schedule_components(str(p.get("schedule_type") or ""), str(p.get("schedule_value") or ""))
            if required and not schedule:
                raise ValueError("Invalid schedule_type/schedule_value")
            return schedule
        if required:
            raise ValueError("Missing schedule")
        return None

    def _metadata_from_params(self, p: dict, base: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        metadata = dict(base or {})
        if isinstance(p.get("metadata"), dict):
            metadata.update(p["metadata"])
        if "notify_telegram" in p and p.get("notify_telegram") is not None:
            metadata["notify_telegram"] = bool(p["notify_telegram"])
        return metadata

    def _task_id(self, p: dict) -> str:
        task_id = self._optional_str(p.get("task_id"))
        if not task_id:
            raise ValueError("Missing task_id")
        return task_id

    @staticmethod
    def _optional_str(value: Any) -> Optional[str]:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    @staticmethod
    def _scope_store(store, user_id: Optional[str]):
        if store is not None and user_id and hasattr(store, "for_user"):
            return store.for_user(user_id)
        return store

    @staticmethod
    def _run_coro_sync(coro):
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(coro)

        result: dict[str, Any] = {}

        def runner():
            try:
                result["value"] = asyncio.run(coro)
            except Exception as exc:
                result["error"] = exc

        thread = threading.Thread(target=runner, daemon=True)
        thread.start()
        thread.join()
        if "error" in result:
            raise result["error"]
        return result.get("value")
