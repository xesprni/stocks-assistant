"""持久输入的单进程协调；与运行启动、取消、完成共用管理器锁。"""

from __future__ import annotations

import time
import uuid
from collections.abc import Callable
from datetime import datetime
from typing import Any

from app.core.agent.run_service import (
    ChatRun,
    ChatRunCapacityError,
    ChatRunConflict,
    ChatRunManager,
)
from app.core.session.store import ChatSessionStore
from app.schemas.chat_inputs import ChatInput, ChatInputRequest


def _now() -> str:
    return datetime.now().isoformat(timespec="microseconds")


def public_input(item: dict[str, Any]) -> dict[str, Any]:
    return ChatInput.model_validate(item).model_dump()


class ChatInputChannel:
    def __init__(self, service: ChatInputService, run: ChatRun):
        self.service = service
        self.run = run
        self.accepting = True
        self.applied: list[dict[str, Any]] = []
        self.on_event: Callable[[dict[str, Any]], None] = run.publish

    def emit(self, item: dict[str, Any]) -> None:
        self.on_event(
            {
                "type": "input_updated",
                "timestamp": time.time(),
                "data": {"input": public_input(item)},
            }
        )

    def drain(self, close: bool = False) -> list[dict[str, Any]]:
        with self.service.manager.lock:
            if close:
                self.accepting = False
            if self.run.cancel_event.is_set():
                return []
            applied = self.service.repository.apply_steer_inputs(
                self.run.session_id, self.run.id, _now()
            )
            self.applied.extend(applied)
            for item in applied:
                self.emit(item)
            return applied

    def finish(self) -> list[dict[str, Any]]:
        # 最终回复与输入接收同锁裁决：要么补充已入队且继续本轮，要么明确拒绝迟到输入。
        with self.service.manager.lock:
            items = self.drain()
            if not items:
                self.accepting = False
            return items


class ChatInputService:
    def __init__(self, store: ChatSessionStore, manager: ChatRunManager):
        self.store = store
        self.repository = store.repository
        self.manager = manager

    def recover(self) -> None:
        with self.manager.lock:
            key = str(self.repository.db_path.resolve())
            if key not in self.manager.recovered_input_stores:
                self.repository.recover_inputs(_now())
                self.manager.recovered_input_stores.add(key)

    def install(self, run: ChatRun, input_id: str | None = None) -> None:
        with self.manager.lock:
            self.recover()
            run.input_channel = ChatInputChannel(self, run)
            if input_id:
                self.repository.update_input(
                    input_id, status="running", run_id=run.id, updated_at=_now()
                )

    def submit(
        self,
        session_id: str,
        request: ChatInputRequest,
        start: Callable[[dict[str, Any]], ChatRun],
    ) -> dict[str, Any]:
        with self.manager.lock:
            self.recover()
            fingerprint = request.model_dump_json(exclude={"request_id"})
            existing = self.repository.find_input(session_id, request_id=request.request_id)
            if existing:
                if existing["fingerprint"] != fingerprint:
                    raise ChatRunConflict("request_id already used with different parameters")
                return existing
            run = self.manager.active_for_session(session_id)
            if request.mode == "steer" and (
                not run
                or run.id != request.target_run_id
                or run.cancel_event.is_set()
                or not run.input_channel
                or not run.input_channel.accepting
            ):
                raise ChatRunConflict("Target run no longer accepts steer input; queue it instead")
            if len(self.repository.list_inputs(session_id, status="pending")) >= 20:
                raise ChatRunCapacityError(
                    "Session input queue is full (maximum 20 pending inputs)"
                )
            now = _now()
            item = self.repository.create_input(
                {
                    "id": str(uuid.uuid4()),
                    "session_id": session_id,
                    "request_id": request.request_id,
                    "message": request.message,
                    "mode": request.mode,
                    "status": "pending",
                    "target_run_id": request.target_run_id,
                    "run_id": None,
                    "thinking_enabled": int(request.thinking_enabled),
                    "fingerprint": fingerprint,
                    "created_at": now,
                    "updated_at": now,
                    "error": None,
                }
            )
            if run and run.input_channel:
                run.input_channel.emit(item)
            elif request.mode == "queue":
                try:
                    self.start_next(session_id, start)
                except ChatRunCapacityError:
                    # 接收已落库仍返回成功；容量恢复后用户可显式继续，避免含糊重试。
                    self.repository.pause_inputs(session_id, True)
            result = self.repository.find_input(session_id, input_id=item["id"])
            assert result is not None
            return result

    def start_next(
        self,
        session_id: str,
        start: Callable[[dict[str, Any]], ChatRun],
        *,
        resume: bool = False,
    ) -> ChatRun | None:
        with self.manager.lock:
            self.recover()
            run = self.manager.active_for_session(session_id)
            if run:
                return run
            session = self.repository.get_session(session_id)
            if session is None:
                return None
            if resume:
                self.repository.pause_inputs(session_id, False)
            elif session["input_queue_paused"]:
                return None
            pending = self.repository.list_inputs(session_id, status="pending", mode="queue")
            if not pending:
                return None
            try:
                return start(pending[0])
            except Exception:
                self.repository.pause_inputs(session_id, True)
                raise

    def cancel(self, session_id: str, input_id: str) -> dict[str, Any]:
        with self.manager.lock:
            self.recover()
            item = self.repository.find_input(session_id, input_id=input_id)
            if item is None:
                raise KeyError(input_id)
            if item["status"] == "cancelled":
                return item
            if item["status"] not in {"pending", "failed"}:
                raise ChatRunConflict(
                    "Input is already executing or applied and cannot be cancelled"
                )
            result = self.repository.update_input(input_id, status="cancelled", updated_at=_now())
            run = self.manager.active_for_session(session_id)
            if run and run.input_channel:
                run.input_channel.emit(result)
            return result

    def finish_run(self, run: ChatRun, *, success: bool, error: str | None = None) -> None:
        with self.manager.lock:
            channel = run.input_channel
            if channel:
                channel.accepting = False
            for item in self.repository.unfinished_run_inputs(run.session_id, run.id):
                belongs = item["run_id"] == run.id or item["target_run_id"] == run.id
                if belongs and item["status"] in {"running", "pending", "applied"}:
                    # 未消费 steer 即使主任务成功也不能谎报成功；兼容不支持 channel 的替身。
                    completed = success and item["status"] in {"running", "applied"}
                    result = self.repository.update_input(
                        item["id"],
                        status="completed" if completed else "failed",
                        updated_at=_now(),
                        error=None
                        if completed
                        else (error or "Run ended before this input was applied"),
                    )
                    if channel:
                        channel.emit(result)
            if not success:
                self.repository.pause_inputs(run.session_id, True)
