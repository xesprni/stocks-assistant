"""调度工具

供 Agent 调用的调度管理工具，支持创建、查询、删除、启用/禁用定时任务。
调度格式支持：
- cron: Cron 表达式（如 "0 9 * * 1-5" 工作日 9 点）
- interval: 秒数间隔（如 "3600" 每小时）
- once: 延时表达式（如 "+5m" 5 分钟后）或 ISO 时间戳
"""

import json
from datetime import datetime, timedelta
import re
from typing import Any, Dict, Optional
import uuid

from croniter import croniter

from app.core.tools.base_tool import BaseTool, ToolResult

import logging

logger = logging.getLogger("stocks-assistant.scheduler")


class SchedulerTool(BaseTool):
    name: str = "scheduler"
    description: str = (
        "Create, query and manage scheduled tasks (reminders, periodic tasks). "
        "Actions: create, list, get, delete, enable, disable. "
        "Schedule types: once (+5s,+10m,+1h,+1d or ISO), interval (seconds), cron (expression)."
    )
    params: dict = {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["create", "list", "get", "delete", "enable", "disable"]},
            "task_id": {"type": "string"},
            "name": {"type": "string"},
            "message": {"type": "string"},
            "ai_task": {"type": "string"},
            "schedule_type": {"type": "string", "enum": ["cron", "interval", "once"]},
            "schedule_value": {"type": "string"},
        },
        "required": ["action"],
    }

    def __init__(self, task_store=None):
        super().__init__()
        self.task_store = task_store

    def execute(self, params: dict) -> ToolResult:
        action = params.get("action")
        if not self.task_store:
            return ToolResult.fail("Scheduler not initialized")
        try:
            handlers = {
                "create": self._create, "list": self._list, "get": self._get,
                "delete": self._delete, "enable": self._enable, "disable": self._disable,
            }
            handler = handlers.get(action)
            if not handler:
                return ToolResult.fail(f"Unknown action: {action}")
            return ToolResult.success(handler(params))
        except Exception as e:
            return ToolResult.fail(str(e))

    def _create(self, p: dict) -> str:
        name = p.get("name")
        message, ai_task = p.get("message"), p.get("ai_task")
        stype, svalue = p.get("schedule_type"), p.get("schedule_value")
        if not name:
            return "Error: missing name"
        if not message and not ai_task:
            return "Error: provide message or ai_task"
        if message and ai_task:
            return "Error: provide only one of message/ai_task"
        if not stype or not svalue:
            return "Error: missing schedule_type or schedule_value"
        schedule = self._parse_schedule(stype, svalue)
        if not schedule:
            return f"Error: invalid schedule ({stype}: {svalue})"
        task_id = uuid.uuid4().hex[:8]
        action = {"type": "send_message" if message else "agent_task", "content": message or ai_task}
        task_data = {
            "id": task_id, "name": name, "enabled": True,
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
            "schedule": schedule, "action": action,
        }
        next_run = self._next_run(task_data)
        if next_run:
            task_data["next_run_at"] = next_run.isoformat()
        self.task_store.add_task(task_data)
        return f"Task created: {task_id} ({name})"

    def _list(self, p: dict) -> str:
        tasks = self.task_store.list_tasks()
        if not tasks:
            return "No scheduled tasks"
        return "\n".join(
            f"{'✓' if t.get('enabled') else '✗'} [{t['id']}] {t['name']}"
            for t in tasks
        )

    def _get(self, p: dict) -> str:
        task = self.task_store.get_task(p.get("task_id", ""))
        if not task:
            return "Task not found"
        return f"Task: {task['name']} (id={task['id']}, enabled={task.get('enabled', True)})"

    def _delete(self, p: dict) -> str:
        tid = p.get("task_id", "")
        task = self.task_store.get_task(tid)
        if not task:
            return "Task not found"
        self.task_store.delete_task(tid)
        return f"Deleted: {task['name']}"

    def _enable(self, p: dict) -> str:
        tid = p.get("task_id", "")
        if not self.task_store.get_task(tid):
            return "Task not found"
        self.task_store.enable_task(tid, True)
        return f"Enabled: {tid}"

    def _disable(self, p: dict) -> str:
        tid = p.get("task_id", "")
        if not self.task_store.get_task(tid):
            return "Task not found"
        self.task_store.enable_task(tid, False)
        return f"Disabled: {tid}"

    def _parse_schedule(self, stype: str, svalue: str) -> Optional[dict]:
        try:
            if stype == "cron":
                croniter(svalue)
                return {"type": "cron", "expression": svalue}
            elif stype == "interval":
                seconds = int(svalue)
                return {"type": "interval", "seconds": seconds} if seconds > 0 else None
            elif stype == "once":
                if svalue.startswith("+"):
                    m = re.match(r'\+(\d+)([smhd])', svalue)
                    if m:
                        amount, unit = int(m.group(1)), m.group(2)
                        delta = {"s": timedelta(seconds=amount), "m": timedelta(minutes=amount),
                                 "h": timedelta(hours=amount), "d": timedelta(days=amount)}[unit]
                        return {"type": "once", "run_at": (datetime.now() + delta).isoformat()}
                    return None
                datetime.fromisoformat(svalue)
                return {"type": "once", "run_at": svalue}
        except Exception:
            return None

    def _next_run(self, task: dict) -> Optional[datetime]:
        schedule = task.get("schedule", {})
        now = datetime.now()
        stype = schedule.get("type")
        if stype == "cron":
            try:
                return croniter(schedule["expression"], now).get_next(datetime)
            except Exception:
                return None
        elif stype == "interval":
            return now + timedelta(seconds=schedule.get("seconds", 0))
        elif stype == "once":
            try:
                return datetime.fromisoformat(schedule["run_at"])
            except Exception:
                return None
        return None
