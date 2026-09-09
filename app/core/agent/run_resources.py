"""父任务返回后，尚在收尾的子任务仍持有运行资源租约。"""

from __future__ import annotations

import threading
from typing import Protocol


class Closeable(Protocol):
    def close(self) -> None: ...


class RunResources:
    def __init__(self, resources: Closeable) -> None:
        self._resources = resources
        self._lock = threading.Lock()
        self._references = 1
        self._closed = False

    def retain(self) -> ResourceLease:
        with self._lock:
            if self._references == 0:
                raise RuntimeError("Agent runtime resources have been released")
            self._references += 1
        return ResourceLease(self)

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
        self._release()

    def _release(self) -> None:
        with self._lock:
            if self._references == 0:
                return
            self._references -= 1
            release = self._references == 0
        if release:
            self._resources.close()


class ResourceLease:
    def __init__(self, owner: RunResources) -> None:
        self._owner = owner
        self._lock = threading.Lock()
        self._closed = False

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
        self._owner._release()
