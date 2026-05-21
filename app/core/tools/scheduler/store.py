"""调度任务持久化存储

基于 JSON 文件的任务存储，支持：
- 增删改查任务
- 启用/禁用任务
- 按启用状态过滤
- 线程安全（通过 threading.Lock）
"""

from datetime import datetime
import json
import logging
import os
import threading
import uuid
from typing import Dict, List, Optional

logger = logging.getLogger("stocks-assistant.scheduler")


class TaskStore:
    def __init__(self, store_path: Optional[str] = None):
        if store_path is None:
            home = os.path.expanduser("~")
            store_path = os.path.join(home, "stocks-assistant", "scheduler", "tasks.json")
        self.store_path = store_path
        self.lock = threading.Lock()
        os.makedirs(os.path.dirname(self.store_path), exist_ok=True)

    def load_tasks(self) -> Dict[str, dict]:
        with self.lock:
            if not os.path.exists(self.store_path):
                return {}
            try:
                with open(self.store_path, "r", encoding="utf-8") as f:
                    return json.load(f).get("tasks", {})
            except Exception:
                return {}

    def save_tasks(self, tasks: Dict[str, dict]):
        with self.lock:
            try:
                data = {"version": 1, "updated_at": datetime.now().isoformat(), "tasks": tasks}
                with open(self.store_path, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
            except Exception as e:
                logger.error(f"Failed to save tasks: {e}")
                raise

    def add_task(self, task: dict) -> bool:
        tasks = self.load_tasks()
        task_id = task.get("id")
        if task_id in tasks:
            raise ValueError(f"Task '{task_id}' already exists")
        tasks[task_id] = task
        self.save_tasks(tasks)
        return True

    def update_task(self, task_id: str, updates: dict) -> bool:
        tasks = self.load_tasks()
        if task_id not in tasks:
            raise ValueError(f"Task '{task_id}' not found")
        tasks[task_id].update(updates)
        tasks[task_id]["updated_at"] = datetime.now().isoformat()
        self.save_tasks(tasks)
        return True

    def delete_task(self, task_id: str) -> bool:
        tasks = self.load_tasks()
        if task_id not in tasks:
            raise ValueError(f"Task '{task_id}' not found")
        del tasks[task_id]
        self.save_tasks(tasks)
        return True

    def get_task(self, task_id: str) -> Optional[dict]:
        return self.load_tasks().get(task_id)

    def list_tasks(self, enabled_only: bool = False) -> List[dict]:
        tasks = list(self.load_tasks().values())
        if enabled_only:
            tasks = [t for t in tasks if t.get("enabled", True)]
        tasks.sort(key=lambda t: t.get("next_run_at") or "z")
        return tasks

    def enable_task(self, task_id: str, enabled: bool = True) -> bool:
        return self.update_task(task_id, {"enabled": enabled})


class RunStore:
    """调度任务执行记录持久化存储。"""

    def __init__(self, store_path: Optional[str] = None, max_records: int = 500):
        if store_path is None:
            home = os.path.expanduser("~")
            store_path = os.path.join(home, "stocks-assistant", "scheduler", "runs.json")
        self.store_path = store_path
        self.max_records = max_records
        self.lock = threading.Lock()
        os.makedirs(os.path.dirname(self.store_path), exist_ok=True)

    def load_runs(self) -> List[dict]:
        with self.lock:
            if not os.path.exists(self.store_path):
                return []
            try:
                with open(self.store_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                runs = data.get("runs", [])
                return runs if isinstance(runs, list) else []
            except Exception:
                return []

    def save_runs(self, runs: List[dict]) -> None:
        with self.lock:
            try:
                data = {"version": 1, "updated_at": datetime.now().isoformat(), "runs": runs}
                with open(self.store_path, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
            except Exception as e:
                logger.error(f"Failed to save scheduler runs: {e}")
                raise

    def add_run(self, run: dict) -> dict:
        runs = self.load_runs()
        record = {"id": uuid.uuid4().hex[:12], **run}
        runs.append(record)
        runs.sort(key=lambda item: item.get("started_at") or "", reverse=True)
        if self.max_records > 0:
            runs = runs[: self.max_records]
        self.save_runs(runs)
        return record

    def list_runs(self, task_id: Optional[str] = None, limit: int = 50) -> List[dict]:
        limit = max(1, min(int(limit or 50), 200))
        runs = self.load_runs()
        if task_id:
            runs = [run for run in runs if run.get("task_id") == task_id]
        runs.sort(key=lambda item: item.get("started_at") or "", reverse=True)
        return runs[:limit]


class SQLiteTaskStore:
    """SQLite-backed scheduler task store with optional user scoping."""

    def __init__(self, user_id: Optional[str] = None):
        self.user_id = user_id

    def for_user(self, user_id: str) -> "SQLiteTaskStore":
        return SQLiteTaskStore(user_id=user_id)

    def load_tasks(self) -> Dict[str, dict]:
        from app.core.app_store import get_app_store

        tasks = get_app_store().list_scheduler_tasks(user_id=self.user_id)
        return {task["id"]: task for task in tasks}

    def save_tasks(self, tasks: Dict[str, dict]):
        from app.core.app_store import get_app_store

        for task in tasks.values():
            if self.user_id:
                task["user_id"] = self.user_id
            if not task.get("user_id"):
                raise ValueError("Scheduler task requires user_id")
            get_app_store().upsert_scheduler_task(task)

    def add_task(self, task: dict) -> bool:
        from app.core.app_store import get_app_store

        task_id = task.get("id")
        if not task_id:
            raise ValueError("Task id is required")
        if self.get_task(task_id):
            raise ValueError(f"Task '{task_id}' already exists")
        if self.user_id:
            task["user_id"] = self.user_id
        if not task.get("user_id"):
            raise ValueError("Scheduler task requires user_id")
        get_app_store().upsert_scheduler_task(task)
        return True

    def update_task(self, task_id: str, updates: dict) -> bool:
        from app.core.app_store import get_app_store

        task = self.get_task(task_id)
        if not task:
            raise ValueError(f"Task '{task_id}' not found")
        task.update(updates)
        task["updated_at"] = datetime.now().isoformat()
        if self.user_id:
            task["user_id"] = self.user_id
        get_app_store().upsert_scheduler_task(task)
        return True

    def delete_task(self, task_id: str) -> bool:
        from app.core.app_store import get_app_store

        if not get_app_store().delete_scheduler_task(task_id, user_id=self.user_id):
            raise ValueError(f"Task '{task_id}' not found")
        return True

    def get_task(self, task_id: str) -> Optional[dict]:
        from app.core.app_store import get_app_store

        return get_app_store().get_scheduler_task(task_id, user_id=self.user_id)

    def list_tasks(self, enabled_only: bool = False) -> List[dict]:
        from app.core.app_store import get_app_store

        return get_app_store().list_scheduler_tasks(user_id=self.user_id, enabled_only=enabled_only)

    def enable_task(self, task_id: str, enabled: bool = True) -> bool:
        return self.update_task(task_id, {"enabled": enabled})


class SQLiteRunStore:
    """SQLite-backed scheduler run store with optional user scoping."""

    def __init__(self, user_id: Optional[str] = None, max_records: int = 500):
        self.user_id = user_id
        self.max_records = max_records

    def for_user(self, user_id: str) -> "SQLiteRunStore":
        return SQLiteRunStore(user_id=user_id, max_records=self.max_records)

    def add_run(self, run: dict) -> dict:
        from app.core.app_store import get_app_store

        if self.user_id:
            run["user_id"] = self.user_id
        if not run.get("user_id"):
            task_id = run.get("task_id")
            if task_id:
                task = get_app_store().get_scheduler_task(task_id)
                if task:
                    run["user_id"] = task.get("user_id")
        if not run.get("user_id"):
            raise ValueError("Scheduler run requires user_id")
        return get_app_store().add_scheduler_run(run, max_records=self.max_records)

    def list_runs(self, task_id: Optional[str] = None, limit: int = 50) -> List[dict]:
        from app.core.app_store import get_app_store

        return get_app_store().list_scheduler_runs(user_id=self.user_id, task_id=task_id, limit=limit)
