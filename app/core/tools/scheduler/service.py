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

from app.core.tools.scheduler.store import TaskStore

import logging

logger = logging.getLogger("stocks-assistant.scheduler")


class SchedulerService:
    def __init__(self, task_store: TaskStore, execute_callback: Callable):
        self.task_store = task_store
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
                    await asyncio.to_thread(self.execute_callback, task)
                    next_run = self._calculate_next(task, now)
                    if next_run:
                        self.task_store.update_task(task["id"], {
                            "next_run_at": next_run.isoformat(),
                            "last_run_at": now.isoformat(),
                        })
                    else:
                        self.task_store.delete_task(task["id"])
            except Exception as e:
                logger.error(f"Error processing task {task.get('id')}: {e}")

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
