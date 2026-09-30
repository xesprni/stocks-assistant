"""应用级资产快照轮询，不依赖用户的 Agent 定时任务开关或浏览器。"""

import asyncio
import logging
from collections.abc import Callable
from contextlib import suppress
from threading import Event

from app.constants.portfolio import SNAPSHOT_POLL_SECONDS, SNAPSHOT_SHUTDOWN_SECONDS

logger = logging.getLogger("stocks-assistant.portfolio.snapshot_scheduler")


class PortfolioSnapshotScheduler:
    def __init__(self, capture: Callable[[Event], None]):
        self.capture = capture
        self._task: asyncio.Task[None] | None = None
        self._stop = Event()
        self._wake = asyncio.Event()

    async def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._stop = Event()
        self._wake = asyncio.Event()
        self._task = asyncio.create_task(self._run(self._stop, self._wake))

    async def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        if self._task is None:
            return
        done, _ = await asyncio.wait({self._task}, timeout=SNAPSHOT_SHUTDOWN_SECONDS)
        if not done:
            self._task.cancel()
        with suppress(asyncio.CancelledError):
            await self._task
        self._task = None

    async def _run(self, stop: Event, wake: asyncio.Event) -> None:
        while not stop.is_set():
            try:
                await asyncio.to_thread(self.capture, stop)
            except Exception:
                logger.exception("Asset snapshot poll failed")
            if stop.is_set():
                break
            with suppress(TimeoutError):
                await asyncio.wait_for(wake.wait(), timeout=SNAPSHOT_POLL_SECONDS)
