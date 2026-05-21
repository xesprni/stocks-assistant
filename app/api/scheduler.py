"""调度系统 API

提供定时任务的 CRUD 接口和启用/禁用切换。
支持三种调度类型：cron 表达式、固定间隔、一次性执行。
"""

from datetime import datetime
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query

from app.schemas.scheduler import (
    TaskCreateRequest,
    TaskListResponse,
    TaskResponse,
    TaskRunListResponse,
    TaskRunResponse,
    TaskUpdateRequest,
)
from app.deps import get_scheduler_service
from app.core.security import CurrentUser, require_permissions

router = APIRouter()


def _task_to_response(task: dict) -> TaskResponse:
    return TaskResponse(
        id=task.get("id", ""),
        name=task.get("name", ""),
        prompt=task.get("prompt", ""),
        schedule=task.get("schedule", {}).get("expression", str(task.get("schedule", {}))),
        enabled=task.get("enabled", True),
        last_run=task.get("last_run_at"),
        next_run=task.get("next_run_at"),
        run_count=task.get("run_count", 0),
        last_error=task.get("last_error"),
        metadata=task.get("metadata"),
    )


def _run_to_response(run: dict) -> TaskRunResponse:
    return TaskRunResponse(
        id=run.get("id", ""),
        task_id=run.get("task_id", ""),
        task_name=run.get("task_name", ""),
        trigger=run.get("trigger", "schedule"),
        status=run.get("status", ""),
        started_at=run.get("started_at", ""),
        ended_at=run.get("ended_at"),
        duration_ms=int(run.get("duration_ms", 0) or 0),
        output_preview=run.get("output_preview", ""),
        error=run.get("error"),
    )


@router.get("/tasks", response_model=TaskListResponse)
async def list_tasks(current_user: CurrentUser = Depends(require_permissions("scheduler:read"))):
    service = get_scheduler_service()
    tasks = service.task_store.for_user(current_user.id).list_tasks()
    return TaskListResponse(
        tasks=[_task_to_response(t) for t in tasks],
        total=len(tasks),
    )


@router.post("/tasks", response_model=TaskResponse)
async def create_task(request: TaskCreateRequest, current_user: CurrentUser = Depends(require_permissions("scheduler:write"))):
    service = get_scheduler_service()
    task_store = service.task_store.for_user(current_user.id)
    task_id = str(uuid.uuid4())[:8]

    schedule = _parse_schedule(request.schedule)
    now = datetime.now().isoformat()
    metadata = request.metadata or {}
    metadata["notify_telegram"] = request.notify_telegram

    task = {
        "id": task_id,
        "user_id": current_user.id,
        "name": request.name,
        "prompt": request.prompt,
        "schedule": schedule,
        "enabled": request.enabled,
        "created_at": now,
        "updated_at": now,
        "run_count": 0,
        "metadata": metadata,
    }
    next_run = service._calculate_next(task, datetime.now())
    if next_run:
        task["next_run_at"] = next_run.isoformat()

    try:
        task_store.add_task(task)
        return _task_to_response(task)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/tasks/{task_id}", response_model=TaskResponse)
async def get_task(task_id: str, current_user: CurrentUser = Depends(require_permissions("scheduler:read"))):
    service = get_scheduler_service()
    task = service.task_store.for_user(current_user.id).get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return _task_to_response(task)


@router.put("/tasks/{task_id}", response_model=TaskResponse)
async def update_task(
    task_id: str,
    request: TaskUpdateRequest,
    current_user: CurrentUser = Depends(require_permissions("scheduler:write")),
):
    service = get_scheduler_service()
    task_store = service.task_store.for_user(current_user.id)
    task = task_store.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    updates = {}
    if request.name is not None:
        updates["name"] = request.name
    if request.prompt is not None:
        updates["prompt"] = request.prompt
    if request.schedule is not None:
        updates["schedule"] = _parse_schedule(request.schedule)
    if request.enabled is not None:
        updates["enabled"] = request.enabled

    if request.metadata is not None or request.notify_telegram is not None:
        metadata = dict(task.get("metadata") or {})
        if request.metadata is not None:
            metadata.update(request.metadata)
        if request.notify_telegram is not None:
            metadata["notify_telegram"] = request.notify_telegram
        updates["metadata"] = metadata

    if "schedule" in updates or "enabled" in updates:
        next_task = {**task, **updates}
        next_run = service._calculate_next(next_task, datetime.now())
        updates["next_run_at"] = next_run.isoformat() if next_run else None

    try:
        task_store.update_task(task_id, updates)
    except ValueError:
        raise HTTPException(status_code=404, detail="Task not found")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    updated = task_store.get_task(task_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Task not found")
    return _task_to_response(updated)


@router.post("/tasks/{task_id}/run", response_model=TaskRunResponse)
async def run_task_now(task_id: str, current_user: CurrentUser = Depends(require_permissions("scheduler:run"))):
    service = get_scheduler_service()
    try:
        if not service.task_store.for_user(current_user.id).get_task(task_id):
            raise ValueError("Task not found")
        run = await service.execute_task_now(task_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Task not found")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _run_to_response(run)


@router.get("/tasks/{task_id}/runs", response_model=TaskRunListResponse)
async def list_task_runs(
    task_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    current_user: CurrentUser = Depends(require_permissions("scheduler:read")),
):
    service = get_scheduler_service()
    task = service.task_store.for_user(current_user.id).get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    runs = service.run_store.for_user(current_user.id).list_runs(task_id=task_id, limit=limit) if service.run_store else []
    return TaskRunListResponse(runs=[_run_to_response(run) for run in runs], total=len(runs))


@router.get("/runs", response_model=TaskRunListResponse)
async def list_runs(
    limit: int = Query(default=50, ge=1, le=200),
    current_user: CurrentUser = Depends(require_permissions("scheduler:read")),
):
    service = get_scheduler_service()
    runs = service.run_store.for_user(current_user.id).list_runs(limit=limit) if service.run_store else []
    return TaskRunListResponse(runs=[_run_to_response(run) for run in runs], total=len(runs))


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: str, current_user: CurrentUser = Depends(require_permissions("scheduler:write"))):
    service = get_scheduler_service()
    try:
        service.task_store.for_user(current_user.id).delete_task(task_id)
        return {"status": "ok"}
    except ValueError:
        raise HTTPException(status_code=404, detail="Task not found")


@router.post("/tasks/{task_id}/toggle")
async def toggle_task(task_id: str, current_user: CurrentUser = Depends(require_permissions("scheduler:write"))):
    service = get_scheduler_service()
    task_store = service.task_store.for_user(current_user.id)
    task = task_store.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    new_enabled = not task.get("enabled", True)
    task_store.update_task(task_id, {"enabled": new_enabled})
    return {"status": "ok", "enabled": new_enabled}


def _parse_schedule(schedule_str: str) -> dict:
    """Parse schedule string into schedule dict."""
    try:
        from croniter import croniter
        croniter(schedule_str)
        return {"type": "cron", "expression": schedule_str}
    except Exception:
        pass

    if schedule_str.startswith("every "):
        parts = schedule_str.split()
        if len(parts) >= 2:
            try:
                value = int(parts[1])
                unit = parts[2] if len(parts) > 2 else "seconds"
                multiplier = {"seconds": 1, "minutes": 60, "hours": 3600, "days": 86400}
                seconds = value * multiplier.get(unit, 1)
                return {"type": "interval", "seconds": seconds}
            except (ValueError, KeyError):
                pass

    return {"type": "once", "run_at": datetime.now().isoformat()}
