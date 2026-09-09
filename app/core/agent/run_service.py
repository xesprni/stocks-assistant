"""与 HTTP 连接独立的聊天运行及可重放的公开事件日志（单进程）。"""

from __future__ import annotations

import asyncio
import json
import logging
import tempfile
import threading
import time
import uuid
from array import array
from collections.abc import AsyncIterator, Callable
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from app.core.agent.input_service import ChatInputChannel

logger = logging.getLogger("stocks-assistant.agent.runs")
_TERMINAL = {"agent_end": "done", "agent_stopped": "cancelled", "error": "error"}


class ChatRunConflict(ValueError):
    """同一幂等键参数冲突，或会话已有任务。"""


class ChatRunCapacityError(RuntimeError):
    """后台运行或重放缓存达到容量上限。"""


class ChatRun:
    def __init__(
        self, user_id: str, request_id: str, fingerprint: str, session_id: str, user_message: str
    ):
        self.id = str(uuid.uuid4())
        self.user_id = user_id
        self.request_id = request_id
        self.fingerprint = fingerprint
        self.session_id = session_id
        self.user_message = user_message
        self.status = "running"
        self.completed_at: float | None = None
        self.cancel_event = threading.Event()
        self._condition = threading.Condition()
        # 正文落入匿名临时文件，断线/慢消费者不会导致 token 队列无限占用内存。
        # 文件生命周期跨越多次订阅，由运行缓存过期/应用关闭统一释放。
        self._journal = tempfile.TemporaryFile(mode="w+b")  # noqa: SIM115
        self._offsets = array("Q", [0])
        self._closed = False
        self.input_channel: ChatInputChannel | None = None
        self.result_data: dict[str, Any] = {}

    def summary(self) -> dict[str, Any]:
        with self._condition:
            return {
                "run_id": self.id,
                "request_id": self.request_id,
                "session_id": self.session_id,
                "user_message": self.user_message,
                "status": self.status,
            }

    def publish(self, event: dict[str, Any]) -> None:
        with self._condition:
            if self.completed_at is not None or self._closed:
                return
            event = {**event, "run_id": self.id, "event_id": len(self._offsets)}
            payload = (json.dumps(event, ensure_ascii=False) + "\n").encode()
            self._journal.seek(self._offsets[-1])
            self._journal.write(payload)
            self._offsets.append(self._journal.tell())
            terminal = _TERMINAL.get(event.get("type", ""))
            if terminal:
                self.result_data = event.get("data") or {}
                self.status = terminal
                self.completed_at = time.monotonic()
            self._condition.notify_all()

    def wait_result(self) -> dict[str, Any]:
        with self._condition:
            self._condition.wait_for(lambda: self.completed_at is not None or self._closed)
            return self.result_data

    def cancel(self) -> dict[str, Any]:
        with self._condition:
            if self.completed_at is None:
                self.status = "stopping"
                self.cancel_event.set()
            return self.summary()

    def validate_cursor(self, cursor: int) -> None:
        with self._condition:
            if cursor < 0 or cursor >= len(self._offsets):
                raise ValueError("Invalid event cursor")

    def _read(self, cursor: int) -> tuple[list[dict[str, Any]], bool]:
        with self._condition:
            self._condition.wait_for(
                lambda: (
                    len(self._offsets) - 1 > cursor or self.completed_at is not None or self._closed
                ),
                timeout=10,
            )
            if self._closed:
                return [], True
            end = min(len(self._offsets) - 1, cursor + 128)
            self._journal.seek(self._offsets[cursor])
            payload = self._journal.read(self._offsets[end] - self._offsets[cursor])
            return [json.loads(line) for line in payload.splitlines()], (
                self.completed_at is not None and end == len(self._offsets) - 1
            )

    async def events(self, after_event_id: int = 0) -> AsyncIterator[str]:
        cursor = after_event_id
        # 订阅被取消只释放连接；只有独立 cancel API 才设置 Agent 的取消标记。
        while True:
            events, finished = await asyncio.to_thread(self._read, cursor)
            for event in events:
                cursor = event["event_id"]
                yield f"id: {cursor}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
            if finished:
                return
            if not events:
                yield ": heartbeat\n\n"

    def close(self) -> None:
        with self._condition:
            self._closed = True
            try:
                self._journal.close()
            finally:
                self._condition.notify_all()

    def abort(self, error: str) -> None:
        """日志无法写入时仍终止内存状态，避免订阅和同步请求永久等待。"""
        with self._condition:
            if self.completed_at is None:
                self.status = "error"
                self.result_data = {"error": error, "session_id": self.session_id}
                self.completed_at = time.monotonic()
            self.close()


class ChatRunManager:
    def __init__(
        self, *, retention_seconds: float = 3600, max_active: int = 16, max_runs: int = 256
    ):
        # 同一把锁保护幂等启动及会话清空/删除，避免后台任务向已清空历史回写。
        self.lock = threading.RLock()
        self._runs: dict[str, ChatRun] = {}
        self._requests: dict[tuple[str, str], str] = {}
        self._retention_seconds = retention_seconds
        self._max_active = max_active
        self._max_runs = max_runs
        self._shutdown = threading.Event()
        self._reaper: threading.Thread | None = None
        self._workers: set[threading.Thread] = set()
        self.recovered_input_stores: set[str] = set()

    def _prune(self) -> None:
        now = time.monotonic()
        for run_id, run in list(self._runs.items()):
            if run.completed_at is not None and now - run.completed_at >= self._retention_seconds:
                self._runs.pop(run_id)
                self._requests.pop((run.user_id, run.request_id), None)
                run.close()

    def _reap(self) -> None:
        while not self._shutdown.wait(60):
            with self.lock:
                self._prune()

    def active_for_session(self, session_id: str) -> ChatRun | None:
        with self.lock:
            return next(
                (
                    run
                    for run in self._runs.values()
                    if run.session_id == session_id and run.completed_at is None
                ),
                None,
            )

    def has_active(self, user_id: str) -> bool:
        with self.lock:
            return any(
                run.user_id == user_id and run.completed_at is None for run in self._runs.values()
            )

    def get(self, run_id: str, user_id: str) -> ChatRun:
        with self.lock:
            self._prune()
            run = self._runs.get(run_id)
            # 运行记录不沿用管理员跨用户读取，避免暴露个人工具输出。
            if run is None or run.user_id != user_id:
                raise KeyError(run_id)
            return run

    def start(
        self,
        *,
        user_id: str,
        request_id: str,
        fingerprint: str,
        session_id: str | None,
        user_message: str,
        prepare: Callable[[], tuple[str, Callable[[ChatRun], None]]],
        after_event_id: int = 0,
        initialize: Callable[[ChatRun], None] | None = None,
    ) -> ChatRun:
        with self.lock:
            self._prune()
            existing_id = self._requests.get((user_id, request_id))
            if existing_id:
                run = self._runs[existing_id]
                if run.fingerprint != fingerprint:
                    raise ChatRunConflict("request_id already used with different parameters")
                run.validate_cursor(after_event_id)
                return run
            if after_event_id:
                # 已有游标却没有原运行，不能把重连误当作新任务执行工具。
                raise KeyError(request_id)
            if session_id and self.active_for_session(session_id):
                raise ChatRunConflict("This session already has an active run")
            if (
                self._shutdown.is_set()
                or len(self._runs) >= self._max_runs
                or sum(run.completed_at is None for run in self._runs.values()) >= self._max_active
            ):
                raise ChatRunCapacityError("Chat capacity reached; try again later")
            actual_session_id, worker = prepare()
            run = ChatRun(user_id, request_id, fingerprint, actual_session_id, user_message)
            try:
                if initialize:
                    initialize(run)
                run.publish(
                    {"type": "run_started", "timestamp": time.time(), "data": run.summary()}
                )
            except Exception:
                run.close()
                raise
            self._runs[run.id] = run
            self._requests[(user_id, request_id)] = run.id

            def execute() -> None:
                try:
                    try:
                        worker(run)
                    except Exception as exc:
                        logger.exception("Chat run %s failed", run.id)
                        run.publish(
                            {
                                "type": "error",
                                "timestamp": time.time(),
                                "data": {"error": str(exc), "session_id": run.session_id},
                            }
                        )
                    finally:
                        if run.completed_at is None:
                            run.publish(
                                {
                                    "type": "error",
                                    "timestamp": time.time(),
                                    "data": {"error": "Chat run ended without a result"},
                                }
                            )
                        if self._shutdown.is_set():
                            run.close()
                except Exception as exc:
                    logger.exception("Chat run %s could not finalize its event journal", run.id)
                    try:
                        run.abort(str(exc))
                    except Exception:
                        logger.exception("Chat run %s could not close its event journal", run.id)
                finally:
                    # 即使事件日志写入/关闭失败，也必须释放工作线程登记。
                    with self.lock:
                        self._workers.discard(threading.current_thread())

            thread = threading.Thread(target=execute, daemon=True, name=f"chat-{run.id[:8]}")
            self._workers.add(thread)
            try:
                thread.start()
            except Exception:
                self._workers.discard(thread)
                self._runs.pop(run.id, None)
                self._requests.pop((user_id, request_id), None)
                run.close()
                raise
            if self._reaper is None:
                self._reaper = threading.Thread(target=self._reap, daemon=True, name="chat-cleanup")
                try:
                    self._reaper.start()
                except Exception:
                    # 任务已经启动，清理线程失败不能让客户端重试并重复提交业务操作。
                    self._reaper = None
                    logger.exception("Could not start chat cleanup thread")
            return run

    def open(self) -> None:
        """允许同一进程重新进入应用生命周期，不复用上一轮关闭的日志。"""
        with self.lock:
            if not self._shutdown.is_set():
                return
            if self._workers:
                raise RuntimeError("Previous chat workers are still stopping")
            for run in self._runs.values():
                run.close()
            self._runs.clear()
            self._requests.clear()
            self.recovered_input_stores.clear()
            self._reaper = None
            self._shutdown.clear()

    def close(self, timeout: float = 5.0) -> None:
        with self.lock:
            self._shutdown.set()
            for run in self._runs.values():
                if run.completed_at is None:
                    run.cancel()
                else:
                    run.close()
            workers = list(self._workers)
            reaper = self._reaper
        # worker 收尾也需要 manager 锁，等待必须放在锁外，且总等待时间有上限。
        deadline = time.monotonic() + timeout
        for thread in [*([reaper] if reaper is not None else []), *workers]:
            if thread is not threading.current_thread():
                thread.join(timeout=max(0.0, deadline - time.monotonic()))


chat_runs = ChatRunManager()
