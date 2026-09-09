"""持有运行时资源的租约，区分停止发布与最终释放。"""

from collections.abc import Callable
from threading import Lock


class ResourceLease[T]:
    def __init__(self, owner: "ManagedResource[T]") -> None:
        self._owner = owner
        self._lock = Lock()
        self._closed = False

    @property
    def value(self) -> T:
        return self._owner.value

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
        self._owner.release()


class ManagedResource[T]:
    """缓存退休后，最后一个在途使用者负责触发关闭。"""

    def __init__(self, value: T, close: Callable[[], None]) -> None:
        self.value = value
        self._close = close
        self._lock = Lock()
        self._users = 0
        self._retired = False
        self._closed = False

    def acquire(self) -> ResourceLease[T]:
        with self._lock:
            if self._retired:
                raise RuntimeError("Runtime resource has been retired")
            self._users += 1
        return ResourceLease(self)

    def retire(self) -> None:
        with self._lock:
            self._retired = True
            close = self._claim_close()
        if close:
            self._close()

    def release(self) -> None:
        with self._lock:
            self._users -= 1
            close = self._claim_close()
        if close:
            self._close()

    def _claim_close(self) -> bool:
        # 先在锁内认领关闭，再在锁外做 I/O，保证幂等且不阻塞其他租约。
        if self._retired and not self._users and not self._closed:
            self._closed = True
            return True
        return False
