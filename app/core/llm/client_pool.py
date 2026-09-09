"""可释放、可借用的 LLM HTTP 连接池，退休不打断正在读取的流。"""

from __future__ import annotations

import threading
from collections.abc import Iterator
from contextlib import contextmanager

import httpx


class LLMClientPool:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._clients: dict[tuple[str, int], httpx.Client] = {}
        self._active: dict[httpx.Client, int] = {}
        self._retired: set[httpx.Client] = set()

    def get(self, api_base: str, timeout: int) -> httpx.Client:
        key = (api_base.rstrip("/"), timeout)
        with self._lock:
            client = self._clients.get(key)
            if client is None or client.is_closed:
                client = httpx.Client(timeout=timeout)
                self._clients[key] = client
            return client

    @contextmanager
    def lease(self, api_base: str, timeout: int) -> Iterator[httpx.Client]:
        # 获取与登记借用共用锁，配置失效不能在两者之间关闭客户端。
        with self._lock:
            client = self.get(api_base, timeout)
            borrower = self.borrow(client)
            borrower.__enter__()
        try:
            yield client
        finally:
            borrower.__exit__(None, None, None)

    @contextmanager
    def borrow(self, client: httpx.Client) -> Iterator[httpx.Client]:
        with self._lock:
            self._active[client] = self._active.get(client, 0) + 1
        try:
            yield client
        finally:
            close = False
            with self._lock:
                remaining = self._active[client] - 1
                if remaining:
                    self._active[client] = remaining
                else:
                    self._active.pop(client)
                    if client in self._retired:
                        self._retired.remove(client)
                        close = True
            if close:
                client.close()

    def close(self) -> None:
        ready: list[httpx.Client] = []
        with self._lock:
            clients = list(self._clients.values())
            self._clients.clear()
            for client in clients:
                if self._active.get(client, 0):
                    self._retired.add(client)
                else:
                    ready.append(client)
        # 网络资源的 close 不在注册表锁内执行，下一次 lifespan 可以立即创建新池条目。
        for client in ready:
            client.close()


default_llm_client_pool = LLMClientPool()


def close_llm_client_pool() -> None:
    default_llm_client_pool.close()
