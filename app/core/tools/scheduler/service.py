"""调度服务

基于 asyncio 的后台任务调度器，定期检查并执行到期任务。
支持三种调度类型：
- cron: Cron 表达式定时执行
- interval: 固定间隔重复执行
- once: 一次性延时执行
"""
import asyncio
import time
from datetime import datetime, timedelta
from typing import Callable, Optional

from croniter import croniter

from app.core.tools.scheduler.store import RunStore, TaskStore

import logging

logger = logging.getLogger("stocks-assistant.scheduler")


class SchedulerService:
    def __init__(self, task_store: TaskStore, execute_callback: Callable, run_store: Optional[RunStore] = None):
        self.task_store = task_store
        self.run_store = run_store
        self.execute_callback = execute_callback
        self.running = False
        self._task: Optional[asyncio.Task] = None

    async def start(self):
        if self.running:
            return
        self.running = True
        self._task = asyncio.create_task(self._run_loop())
        logger.info("Scheduler service started")

    async def stop(self):
        self.running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Scheduler service stopped")

    async def _run_loop(self):
        while self.running:
            try:
                await self._check_and_execute()
            except Exception as e:
                logger.error(f"Scheduler loop error: {e}")
            await asyncio.sleep(30)

    async def _check_and_execute(self):
        now = datetime.now()
        for task in self.task_store.list_tasks(enabled_only=True):
            try:
                if self._is_due(task, now):
                    logger.info(f"Executing task: {task['id']} - {task['name']}")
                    await self._execute_due_task(task, now)
            except Exception as e:
                logger.error(f"Error processing task {task.get('id')}: {e}")

    async def _execute_due_task(self, task: dict, now: datetime):
        await self._execute_task(task, now, trigger="schedule", update_schedule=True)

    async def execute_task_now(self, task_id: str) -> dict:
        task = self.task_store.get_task(task_id)
        if not task:
            raise ValueError("Task not found")
        return await self._execute_task(task, datetime.now(), trigger="manual", update_schedule=False)

    async def _execute_task(self, task: dict, now: datetime, trigger: str, update_schedule: bool) -> dict:
        task_id = task["id"]
        started = datetime.now()
        result: Optional[str] = None
        error: Optional[str] = None
        try:
            output = await asyncio.to_thread(self.execute_callback, task)
            result = str(output or "")
        except Exception as exc:
            error = str(exc)
            logger.error(f"Scheduled task failed {task_id}: {exc}")
        ended = datetime.now()
        record = self._record_run(task, trigger, started, ended, result, error)
        self._complete_task(task, now, error=error, update_schedule=update_schedule)
        return record

    def _complete_task(self, task: dict, now: datetime, error: Optional[str], update_schedule: bool = True):
        updates = {
            "last_run_at": now.isoformat(),
            "run_count": int(task.get("run_count", 0) or 0) + 1,
            "last_error": error,
        }
        if not update_schedule:
            self.task_store.update_task(task["id"], updates)
            return

        next_run = self._calculate_next(task, now)
        if next_run:
            updates["next_run_at"] = next_run.isoformat()
            self.task_store.update_task(task["id"], updates)
        elif (task.get("schedule") or {}).get("type") == "once" and not error:
            self.task_store.delete_task(task["id"])
        else:
            updates["enabled"] = False
            self.task_store.update_task(task["id"], updates)

    def _record_run(
        self,
        task: dict,
        trigger: str,
        started: datetime,
        ended: datetime,
        result: Optional[str],
        error: Optional[str],
    ) -> dict:
        output = (result or "").strip()
        record = {
            "task_id": task.get("id", ""),
            "task_name": task.get("name", ""),
            "trigger": trigger,
            "status": "error" if error else "success",
            "started_at": started.isoformat(),
            "ended_at": ended.isoformat(),
            "duration_ms": int((ended - started).total_seconds() * 1000),
            "output_preview": output[:2000],
            "error": error,
        }
        if self.run_store:
            return self.run_store.add_run(record)
        return {"id": "", **record}

    def _is_due(self, task: dict, now: datetime) -> bool:
        next_str = task.get("next_run_at")
        if not next_str:
            next_run = self._calculate_next(task, now)
            if next_run:
                self.task_store.update_task(task["id"], {"next_run_at": next_run.isoformat()})
            return False
        try:
            next_run = datetime.fromisoformat(next_str)
            if next_run < now:
                diff = (now - next_run).total_seconds()
                if diff > 300:
                    schedule = task.get("schedule", {})
                    if schedule.get("type") == "once":
                        self.task_store.delete_task(task["id"])
                        return False
                    next_next = self._calculate_next(task, now)
                    if next_next:
                        self.task_store.update_task(task["id"], {"next_run_at": next_next.isoformat()})
                    return False
            return now >= next_run
        except Exception:
            return False

    def _calculate_next(self, task: dict, from_time: datetime) -> Optional[datetime]:
        schedule = task.get("schedule", {})
        stype = schedule.get("type")
        if stype == "cron":
            try:
                return croniter(schedule["expression"], from_time).get_next(datetime)
            except Exception:
                return None
        elif stype == "interval":
            seconds = schedule.get("seconds", 0)
            return from_time + timedelta(seconds=seconds) if seconds > 0 else None
        elif stype == "once":
            try:
                run_at = datetime.fromisoformat(schedule["run_at"])
                return run_at if run_at > from_time else None
            except Exception:
                return None
        return None
