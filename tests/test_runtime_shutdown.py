"""应用关闭时取消执行并等待收尾，下一轮生命周期可以重新启动。"""

import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from unittest.mock import MagicMock

import pytest

from app.core.agent.run_service import ChatRunManager
from app.core.tools.scheduler.service import SchedulerService


def test_chat_shutdown_waits_for_worker_and_can_reopen():
    manager = ChatRunManager()
    started, finished = threading.Event(), threading.Event()

    def worker(run):
        started.set()
        assert run.cancel_event.wait(2)
        run.publish({"type": "agent_stopped", "data": {"session_id": "session"}})
        finished.set()

    manager.start(
        user_id="alice",
        request_id="first",
        fingerprint="first",
        session_id=None,
        user_message="hello",
        prepare=lambda: ("session", worker),
    )
    assert started.wait(2)
    manager.close(timeout=2)
    assert finished.is_set()
    assert not manager._workers
    manager.open()
    new = manager.start(
        user_id="alice",
        request_id="second",
        fingerprint="second",
        session_id=None,
        user_message="again",
        prepare=lambda: (
            "session",
            lambda run: run.publish({"type": "agent_end", "data": {"ok": True}}),
        ),
    )
    assert new.wait_result() == {"ok": True}
    manager.close()


def test_scheduler_shutdown_signals_thread_and_records_completion():
    started = threading.Event()

    def execute(task):
        started.set()
        assert task["_cancel_event"].wait(2)
        return "stopped cooperatively"

    store = MagicMock()
    service = SchedulerService(task_store=store, execute_callback=execute)

    async def run():
        pending = asyncio.create_task(
            service._execute_task({"id": "task", "name": "Task"}, datetime.now(), "manual", False)
        )
        assert await asyncio.to_thread(started.wait, 2)
        await service.stop()
        result = await pending
        assert result["output_preview"] == "stopped cooperatively"
        assert not service._executions

    asyncio.run(run())
    store.update_task.assert_called_once()


def test_scheduler_shutdown_waits_for_execution_owned_by_another_loop():
    started = threading.Event()

    def execute(task):
        started.set()
        assert task["_cancel_event"].wait(3)
        return "foreign loop stopped"

    store = MagicMock()
    service = SchedulerService(task_store=store, execute_callback=execute)

    async def run_in_worker():
        return await service._execute_task(
            {"id": "foreign", "name": "Foreign"}, datetime.now(), "manual", False
        )

    async def stop_from_main_loop():
        assert await asyncio.to_thread(started.wait, 2)
        await service.stop()

    # debug 模式会明确拒绝从别的线程给 Task 注册/通知非线程安全回调。
    with ThreadPoolExecutor(max_workers=1) as executor:
        pending = executor.submit(lambda: asyncio.run(run_in_worker(), debug=True))
        asyncio.run(stop_from_main_loop(), debug=True)
        assert pending.result(timeout=2)["output_preview"] == "foreign loop stopped"
    assert not service._executions
    store.update_task.assert_called_once()


def test_chat_thread_start_failure_rolls_back_registration(monkeypatch):
    manager = ChatRunManager()
    original_start = threading.Thread.start

    def fail_chat_start(thread):
        if thread.name.startswith("chat-"):
            raise RuntimeError("Cannot start thread")
        return original_start(thread)

    monkeypatch.setattr(threading.Thread, "start", fail_chat_start)
    with pytest.raises(RuntimeError, match="Cannot start thread"):
        manager.start(
            user_id="alice",
            request_id="first",
            fingerprint="first",
            session_id=None,
            user_message="hello",
            prepare=lambda: ("session", lambda run: None),
        )
    assert not manager._workers
    assert not manager._runs
    assert not manager._requests
    manager.close()
    manager.open()


def test_chat_journal_failure_releases_worker_and_waiters(monkeypatch):
    manager = ChatRunManager()

    def worker(run):
        def fail_publish(event):
            raise OSError("disk full")

        monkeypatch.setattr(run, "publish", fail_publish)

    run = manager.start(
        user_id="alice",
        request_id="first",
        fingerprint="first",
        session_id=None,
        user_message="hello",
        prepare=lambda: ("session", worker),
    )
    with ThreadPoolExecutor(max_workers=1) as executor:
        assert executor.submit(run.wait_result).result(timeout=2)["error"] == "disk full"
    manager.close()
    assert not manager._workers
    manager.open()
