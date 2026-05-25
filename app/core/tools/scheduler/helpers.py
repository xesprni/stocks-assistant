"""Shared scheduler parsing and response helpers."""

from __future__ import annotations

from datetime import datetime, timedelta
import re
from typing import Any, Optional

from croniter import croniter


def task_to_response(task: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": task.get("id", ""),
        "name": task.get("name", ""),
        "prompt": task.get("prompt", ""),
        "schedule": schedule_to_response_value(task.get("schedule", {})),
        "enabled": task.get("enabled", True),
        "last_run": task.get("last_run_at"),
        "next_run": task.get("next_run_at"),
        "run_count": task.get("run_count", 0),
        "last_error": task.get("last_error"),
        "metadata": task.get("metadata"),
    }


def run_to_response(run: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": run.get("id", ""),
        "task_id": run.get("task_id", ""),
        "task_name": run.get("task_name", ""),
        "trigger": run.get("trigger", "schedule"),
        "status": run.get("status", ""),
        "started_at": run.get("started_at", ""),
        "ended_at": run.get("ended_at"),
        "duration_ms": int(run.get("duration_ms", 0) or 0),
        "output_preview": run.get("output_preview", ""),
        "error": run.get("error"),
    }


def schedule_to_response_value(schedule: dict[str, Any]) -> str:
    if schedule.get("type") == "cron":
        return str(schedule.get("expression", ""))
    return str(schedule)


def parse_schedule_expression(schedule_str: str) -> dict[str, Any]:
    """Parse API-style schedule text into an internal schedule dict.

    Preserves the existing API behavior of falling back to an immediate one-shot
    schedule when the expression cannot be interpreted.
    """

    text = str(schedule_str or "").strip()
    if not text or text.lower() in {"once", "now"}:
        return {"type": "once", "run_at": datetime.now().isoformat()}

    relative = _parse_relative_once(text)
    if relative:
        return relative

    try:
        croniter(text)
        return {"type": "cron", "expression": text}
    except Exception:
        pass

    interval = _parse_interval(text)
    if interval:
        return interval

    try:
        datetime.fromisoformat(text)
        return {"type": "once", "run_at": text}
    except Exception:
        pass

    return {"type": "once", "run_at": datetime.now().isoformat()}


def parse_schedule_components(schedule_type: str, schedule_value: str) -> Optional[dict[str, Any]]:
    """Parse the legacy tool schedule_type/schedule_value pair."""

    stype = str(schedule_type or "").strip().lower()
    svalue = str(schedule_value or "").strip()
    if stype == "cron":
        try:
            croniter(svalue)
        except Exception:
            return None
        return {"type": "cron", "expression": svalue}
    if stype == "interval":
        try:
            seconds = int(svalue)
        except ValueError:
            return None
        return {"type": "interval", "seconds": seconds} if seconds > 0 else None
    if stype == "once":
        parsed = _parse_relative_once(svalue)
        if parsed:
            return parsed
        try:
            datetime.fromisoformat(svalue)
        except Exception:
            return None
        return {"type": "once", "run_at": svalue}
    return None


def _parse_relative_once(text: str) -> Optional[dict[str, Any]]:
    match = re.fullmatch(r"\+(\d+)([smhd])", text)
    if not match:
        return None
    amount = int(match.group(1))
    unit = match.group(2)
    delta = {
        "s": timedelta(seconds=amount),
        "m": timedelta(minutes=amount),
        "h": timedelta(hours=amount),
        "d": timedelta(days=amount),
    }[unit]
    return {"type": "once", "run_at": (datetime.now() + delta).isoformat()}


def _parse_interval(text: str) -> Optional[dict[str, Any]]:
    if text.isdigit():
        seconds = int(text)
        return {"type": "interval", "seconds": seconds} if seconds > 0 else None

    if not text.startswith("every "):
        return None

    parts = text.split()
    if len(parts) < 2:
        return None
    try:
        value = int(parts[1])
    except ValueError:
        return None

    unit = parts[2].lower() if len(parts) > 2 else "seconds"
    multipliers = {
        "second": 1,
        "seconds": 1,
        "minute": 60,
        "minutes": 60,
        "hour": 3600,
        "hours": 3600,
        "day": 86400,
        "days": 86400,
    }
    multiplier = multipliers.get(unit, 1)
    seconds = value * multiplier
    return {"type": "interval", "seconds": seconds} if seconds > 0 else None
