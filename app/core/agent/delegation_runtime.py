"""一次 Agent 运行内共享的委派容量与可组合取消信号。"""

import threading
import time

from app.core.tools.call_context import AgentCancelledError as AgentCancelledError
from app.core.tools.call_context import CancellationSignal as CancellationSignal


class DelegationRuntime:
    def __init__(self, max_parallel: int) -> None:
        if max_parallel < 1:
            raise ValueError("max_parallel must be positive")
        # 同一父运行的多个 delegate 工具调用共享容量，防止批次叠加突破上限。
        self.slots = threading.BoundedSemaphore(max_parallel)


class LinkedCancellation:
    """父级停止、局部停止和执行期限中的任意信号均可终止子任务。"""

    def __init__(
        self,
        parent: CancellationSignal | None = None,
        timeout_seconds: float | None = None,
    ) -> None:
        self._parent = parent
        self._stop = threading.Event()
        self._deadline = (
            time.monotonic() + max(0.0, timeout_seconds) if timeout_seconds is not None else None
        )

    @property
    def timed_out(self) -> bool:
        return self._deadline is not None and time.monotonic() >= self._deadline

    def set(self) -> None:
        # 局部超时或停止不反向取消父任务，其他独立子任务仍可完成。
        self._stop.set()

    def is_set(self) -> bool:
        return (
            self._stop.is_set()
            or (self._parent is not None and self._parent.is_set())
            or self.timed_out
        )

    def wait(self, timeout: float | None = None) -> bool:
        wait_deadline = time.monotonic() + max(0.0, timeout) if timeout is not None else None
        while not self.is_set():
            now = time.monotonic()
            if wait_deadline is not None and now >= wait_deadline:
                return False
            deadlines = [value for value in (self._deadline, wait_deadline) if value is not None]
            # 父信号只要求 is_set 协议；短间隔轮询也能及时打断模型重试等待。
            interval = min(0.05, max(0.0, min(deadlines) - now)) if deadlines else 0.05
            self._stop.wait(interval)
        return True
