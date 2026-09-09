"""按调用能力分段执行：连续只读可并行，写入与未知调用构成顺序屏障。"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Protocol


class ExecutionPolicy(Protocol):
    def is_read_only(self, params: dict[str, Any]) -> bool: ...


class ToolBatchExecutor:
    def __init__(
        self,
        tools: Mapping[str, ExecutionPolicy],
        execute: Callable[[dict[str, Any]], dict[str, Any]],
        check_cancelled: Callable[[], None],
        *,
        max_workers: int = 4,
    ) -> None:
        self.tools = tools
        self.execute = execute
        self.check_cancelled = check_cancelled
        self.max_workers = max(1, max_workers)

    def run(self, calls: list[dict[str, Any]]) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        reads: list[dict[str, Any]] = []
        for call in calls:
            tool = self.tools.get(str(call.get("name", "")))
            params = call.get("arguments")
            if (
                tool is not None
                and isinstance(params, dict)
                and "_parse_error" not in call
                and tool.is_read_only(params)
            ):
                reads.append(call)
                continue
            results.extend(self._read_segment(reads))
            reads = []
            # 写入后的查询必须看到已完成的写入，不能只串行写操作本身。
            self.check_cancelled()
            results.append(self.execute(call))
        results.extend(self._read_segment(reads))
        return results

    def _execute(self, call: dict[str, Any]) -> dict[str, Any]:
        self.check_cancelled()
        return self.execute(call)

    def _read_segment(self, calls: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if not calls:
            return []
        if len(calls) == 1:
            return [self._execute(calls[0])]
        pool = ThreadPoolExecutor(
            max_workers=min(len(calls), self.max_workers), thread_name_prefix="agent-tool"
        )
        futures = []
        try:
            for call in calls:
                self.check_cancelled()
                futures.append(pool.submit(self._execute, call))
            # 结果按输入顺序归位；取消/异常时停止尚未开始的工作。
            return [future.result() for future in futures]
        finally:
            pool.shutdown(wait=True, cancel_futures=True)
