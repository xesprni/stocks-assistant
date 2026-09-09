"""调度任务应用服务：执行命令、补充时间上下文并发送通知。"""

import logging
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from app.config import Settings

logger = logging.getLogger("stocks-assistant.scheduler")


class ScheduledTaskExecutor:
    def __init__(
        self,
        run_agent: Callable[..., str],
        settings_factory: Callable[[str | None], Settings],
    ) -> None:
        self.run_agent = run_agent
        self.settings_factory = settings_factory

    def __call__(self, task: dict[str, Any]) -> str:
        from app.core.notifications import TelegramSender
        from app.core.security import user_workspace_dir

        logger.info("Executing scheduled task: %s", task.get("name", task.get("id")))

        action = task.get("action") or {}
        action_type = action.get("type")
        metadata = task.get("metadata") or {}
        prompt = task.get("prompt") or action.get("content") or ""

        if action_type == "send_message":
            result = str(action.get("content") or prompt)
        elif prompt:
            options = {"cancel_event": task["_cancel_event"]} if "_cancel_event" in task else {}
            result = self.run_agent(
                build_scheduled_agent_prompt(prompt, task), user_id=task.get("user_id"), **options
            )
        else:
            result = f"Scheduled task executed: {task.get('name', task.get('id'))}"

        notify_telegram = metadata.get("notify_telegram")
        if notify_telegram is None:
            notify_telegram = action_type in {"send_message", "agent_task"}

        if notify_telegram:
            user_id = task.get("user_id")
            settings = self.settings_factory(user_id)
            # 无归属的旧任务只允许远程图片；有用户归属时按该用户的目录读取附件。
            workspace = user_workspace_dir(settings.workspace_dir, user_id) if user_id else None
            telegram = TelegramSender.from_settings(settings, workspace_dir=workspace)
            message = format_scheduled_telegram_message(task, result)
            telegram.send_message(message, photos=metadata.get("telegram_photos"))

        return result


def build_scheduled_agent_prompt(prompt: str, task: dict[str, Any] | None = None) -> str:
    task = task or {}
    context = task.get("_execution_context") or {}
    started_at = parse_execution_time(context.get("started_at")) or datetime.now().astimezone()
    due_at = parse_execution_time(context.get("due_at"))
    local_now = started_at.astimezone()
    utc_now = local_now.astimezone(UTC)
    timezone_name = local_now.tzname() or "local"
    trigger = str(context.get("trigger") or "schedule")
    task_name = str(task.get("name") or task.get("id") or "scheduled task")

    lines = [
        "<scheduled_task_runtime_context>",
        f"任务名称 / task name: {task_name}",
        f"触发方式 / trigger: {trigger}",
        f"当前本地时间 / current local time: {local_now.isoformat()} ({timezone_name})",
        f"当前本地日期 / current local date: {local_now.date().isoformat()}",
        f"当前 UTC 时间 / current UTC time: {utc_now.isoformat()}",
    ]
    if due_at:
        lines.append(f"计划到期时间 / scheduled due time: {due_at.astimezone().isoformat()}")
    lines.extend(
        [
            "如果任务提示词包含“今天”“当前”“现在”“今日”“开盘”或 today/now/current，必须以本次执行时间为准。",
            "涉及交易日、市场开闭市或开盘简报时，优先使用可用行情/交易日工具验证，不要沿用历史输出中的日期。",
            "</scheduled_task_runtime_context>",
            "",
            prompt,
        ]
    )
    return "\n".join(lines)


def parse_execution_time(value: object) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed.astimezone()


def format_scheduled_telegram_message(task: dict[str, Any], body: str) -> str:
    name = str(task.get("name") or task.get("id") or "Scheduled task")
    return f"# 定时任务：{name}\n\n{body}".strip()


class ScheduledAlertEvaluator:
    def __init__(self, providers: dict[str, Callable[[], Any]]) -> None:
        self.providers = providers

    def __call__(self) -> Any:
        from app.core.research.evaluator import evaluate_due_alerts

        return evaluate_due_alerts(
            self.providers["research"](),
            market_service=self.providers["market"](),
            fundamental_service=self.providers["fundamentals"](),
            news_service=self.providers["news"](),
        )
