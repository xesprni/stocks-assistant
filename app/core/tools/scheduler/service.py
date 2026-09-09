"""调度服务

基于 asyncio 的后台任务调度器，定期检查并执行到期任务。
支持三种调度类型：
- cron: Cron 表达式定时执行
- interval: 固定间隔重复执行
- once: 一次性延时执行
"""

import asyncio
import logging
import threading
import time
from collections.abc import Callable
from contextlib import suppress
from datetime import datetime, timedelta

from croniter import croniter

from app.core.tools.scheduler.store import RunStore, TaskStore

logger = logging.getLogger("stocks-assistant.scheduler")


class SchedulerService:
    def __init__(
        self,
        task_store: TaskStore,
        execute_callback: Callable,
        run_store: RunStore | None = None,
        alert_callback: Callable | None = None,
    ):
        self.task_store = task_store
        self.run_store = run_store
        self.execute_callback = execute_callback
        self.alert_callback = alert_callback
        self.running = False
        self._task: asyncio.Task | None = None
        self._executions: dict[asyncio.Task, tuple[threading.Event, threading.Event]] = {}
        self._execution_lock = threading.RLock()
        self._stopping = False

    async def start(self):
        if self.running:
            return
        self.running = True
        self._task = asyncio.create_task(self._run_loop())
        logger.info("Scheduler service started")

    async def stop(self):
        with self._execution_lock:
            self.running = False
            self._stopping = True
            executions = list(self._executions.values())
        try:
            for cancel_event, _finished in executions:
                cancel_event.set()
            task = self._task
            if task is not None and not task.done():

                async def stop_runner():
                    task.cancel()
                    with suppress(asyncio.CancelledError):
                        await task

                if task.get_loop() is asyncio.get_running_loop():
                    await stop_runner()
                else:
                    await asyncio.wrap_future(
                        asyncio.run_coroutine_threadsafe(stop_runner(), task.get_loop())
                    )
            if executions:
                # scheduler 工具可从独立事件循环运行。只等线程安全的完成信号，
                # 不能把其他 loop 的 Task 交给当前 loop 的 asyncio.wait。
                def wait_finished():
                    deadline = time.monotonic() + 5
                    for _cancel, finished in executions:
                        finished.wait(max(0, deadline - time.monotonic()))

                await asyncio.to_thread(wait_finished)
        finally:
            with self._execution_lock:
                self._stopping = False
        logger.info("Scheduler service stopped")

    async def _run_loop(self):
        while self.running:
            try:
                await self._check_and_execute()
            except Exception as e:
                logger.error("Scheduler loop error: %s", e)
            await asyncio.sleep(30)

    async def _check_and_execute(self):
        now = datetime.now()
        for task in self.task_store.list_tasks(enabled_only=True):
            try:
                if self._is_due(task, now):
                    logger.info("Executing task: %s - %s", task["id"], task["name"])
                    await self._execute_due_task(task, now)
            except Exception as e:
                logger.error("Error processing task %s: %s", task.get("id"), e)
        if self.alert_callback:
            try:
                await asyncio.to_thread(self.alert_callback)
            except Exception as exc:
                # 条件提醒与普通定时任务隔离，单次数据源失败不应停止调度主循环。
                logger.error("Alert evaluation error: %s", exc)

    async def _execute_due_task(self, task: dict, now: datetime):
        await self._execute_task(task, now, trigger="schedule", update_schedule=True)

    async def execute_task_now(self, task_id: str) -> dict:
        task = self.task_store.get_task(task_id)
        if not task:
            raise ValueError("Task not found")
        return await self._execute_task(
            task, datetime.now(), trigger="manual", update_schedule=False
        )

    async def _execute_task(
        self, task: dict, now: datetime, trigger: str, update_schedule: bool
    ) -> dict:
        with self._execution_lock:
            if self._stopping:
                raise RuntimeError("Scheduler is stopping; retry after shutdown completes")
            cancel_event, finished = threading.Event(), threading.Event()
            execution = asyncio.create_task(
                self._run_task(task, now, trigger, update_schedule, cancel_event)
            )
            self._executions[execution] = (cancel_event, finished)
            execution.add_done_callback(self._execution_finished)
        return await asyncio.shield(execution)

    def _execution_finished(self, execution: asyncio.Task) -> None:
        with self._execution_lock:
            state = self._executions.pop(execution, None)
        if state is not None:
            state[1].set()
        if not execution.cancelled() and execution.exception() is not None:
            logger.error(
                "Scheduled execution failed during finalization", exc_info=execution.exception()
            )

    async def _run_task(
        self,
        task: dict,
        now: datetime,
        trigger: str,
        update_schedule: bool,
        cancel_event: threading.Event,
    ) -> dict:
        task_id = task["id"]
        # 使用调用方注入的运行时间作为业务时间；另用墙钟差计算耗时，保证补跑和测试可复现。
        started = now
        wall_started = datetime.now()
        result: str | None = None
        error: str | None = None
        task_for_execution = self._with_execution_context(
            task, trigger=trigger, due_at=now, started_at=started
        )
        task_for_execution["_cancel_event"] = cancel_event
        try:
            output = await asyncio.to_thread(self.execute_callback, task_for_execution)
            result = str(output or "")
        except Exception as exc:
            error = str(exc)
            logger.error("Scheduled task failed %s: %s", task_id, exc)
        ended = started + (datetime.now() - wall_started)
        record = self._record_run(task, trigger, started, ended, result, error)
        self._complete_task(task, now, error=error, update_schedule=update_schedule)
        return record

    def _with_execution_context(
        self, task: dict, trigger: str, due_at: datetime, started_at: datetime
    ) -> dict:
        task_copy = dict(task)
        # 执行上下文只传给回调，不写回任务存储，避免后台 Agent 误把“今天”理解成旧会话日期。
        task_copy["_execution_context"] = {
            "trigger": trigger,
            "due_at": due_at.astimezone().isoformat(),
            "started_at": started_at.astimezone().isoformat(),
        }
        return task_copy

    def _complete_task(
        self, task: dict, now: datetime, error: str | None, update_schedule: bool = True
    ):
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
        result: str | None,
        error: str | None,
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
                        self.task_store.update_task(
                            task["id"], {"next_run_at": next_next.isoformat()}
                        )
                    return False
            return now >= next_run
        except Exception:
            return False

    def _calculate_next(self, task: dict, from_time: datetime) -> datetime | None:
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
