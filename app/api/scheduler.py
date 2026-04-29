"""调度系统 API

提供定时任务的 CRUD 接口和启用/禁用切换。
支持三种调度类型：cron 表达式、固定间隔、一次性执行。
"""

from fastapi import APIRouter, Depends, HTTPException

from app.schemas.scheduler import TaskCreateRequest, TaskResponse, TaskListResponse
from app.deps import get_scheduler_service

router = APIRouter()


@router.get("/tasks", response_model=TaskListResponse)
async def list_tasks():
    service = get_scheduler_service()
    tasks = service.task_store.list_tasks()
    return TaskListResponse(
        tasks=[
            TaskResponse(
                id=t.get("id", ""),
                name=t.get("name", ""),
                prompt=t.get("prompt", ""),
                schedule=t.get("schedule", {}).get("expression", str(t.get("schedule", {}))),
                enabled=t.get("enabled", True),
                last_run=t.get("last_run_at"),
                next_run=t.get("next_run_at"),
                run_count=t.get("run_count", 0),
                metadata=t.get("metadata"),
            )
            for t in tasks
        ],
        total=len(tasks),
    )


@router.post("/tasks", response_model=TaskResponse)
async def create_task(request: TaskCreateRequest):
    service = get_scheduler_service()
    task_id = str(uuid.uuid4())[:8]

    schedule = _parse_schedule(request.schedule)
    now = datetime.now().isoformat()

    task = {
        "id": task_id,
        "name": request.name,
        "prompt": request.prompt,
        "schedule": schedule,
        "enabled": request.enabled,
        "created_at": now,
        "updated_at": now,
        "run_count": 0,
        "metadata": request.metadata or {},
    }

    try:
        service.task_store.add_task(task)
        return TaskResponse(
            id=task_id, name=request.name, prompt=request.prompt,
            schedule=request.schedule, enabled=request.enabled,
            run_count=0, metadata=request.metadata,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/tasks/{task_id}", response_model=TaskResponse)
async def get_task(task_id: str):
    service = get_scheduler_service()
    task = service.task_store.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return TaskResponse(
        id=task.get("id", ""),
        name=task.get("name", ""),
        prompt=task.get("prompt", ""),
        schedule=task.get("schedule", {}).get("expression", str(task.get("schedule", {}))),
        enabled=task.get("enabled", True),
        last_run=task.get("last_run_at"),
        next_run=task.get("next_run_at"),
        run_count=task.get("run_count", 0),
        metadata=task.get("metadata"),
    )


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: str):
    service = get_scheduler_service()
    try:
        service.task_store.delete_task(task_id)
        return {"status": "ok"}
    except ValueError:
        raise HTTPException(status_code=404, detail="Task not found")


@router.post("/tasks/{task_id}/toggle")
async def toggle_task(task_id: str):
    service = get_scheduler_service()
    task = service.task_store.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    new_enabled = not task.get("enabled", True)
    service.task_store.update_task(task_id, {"enabled": new_enabled})
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
