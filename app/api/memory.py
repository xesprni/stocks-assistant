"""记忆系统 API

提供记忆搜索、添加、同步、状态查询、文件列表和内容读取接口。
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.schemas.memory import (
    MemorySearchRequest, MemorySearchResult, MemoryAddRequest, MemoryStatusResponse,
)
from app.deps import get_memory_manager
from app.core.security import CurrentUser, require_permissions

router = APIRouter()


@router.get("/search", response_model=list[MemorySearchResult])
async def search_memory(
    q: str = Query(..., description="Search query"),
    user_id: Optional[str] = None,
    limit: Optional[int] = None,
    min_score: Optional[float] = None,
    current_user: CurrentUser = Depends(require_permissions("memory:read")),
):
    mgr = get_memory_manager()
    effective_user_id = user_id if (user_id and current_user.is_admin) else current_user.id
    try:
        results = await mgr.search(
            query=q,
            user_id=effective_user_id,
            max_results=limit,
            min_score=min_score,
            include_shared=current_user.is_admin and not user_id,
        )
        return [MemorySearchResult(**r.__dict__) for r in results]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/add")
async def add_memory(request: MemoryAddRequest, current_user: CurrentUser = Depends(require_permissions("memory:write"))):
    mgr = get_memory_manager()
    try:
        effective_user_id = request.user_id if (request.user_id and current_user.is_admin) else current_user.id
        await mgr.add_memory(
            content=request.content,
            user_id=effective_user_id,
            scope="shared" if (current_user.is_admin and request.scope == "shared") else "user",
            source=request.source,
            path=request.path, metadata=request.metadata,
        )
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sync")
async def sync_memory(current_user: CurrentUser = Depends(require_permissions("memory:write"))):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Only admins can run full memory sync")
    mgr = get_memory_manager()
    try:
        await mgr.sync()
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status", response_model=MemoryStatusResponse)
async def memory_status(_: CurrentUser = Depends(require_permissions("memory:read"))):
    mgr = get_memory_manager()
    return MemoryStatusResponse(**mgr.get_status())


@router.get("/files")
async def list_memory_files(current_user: CurrentUser = Depends(require_permissions("memory:read"))):
    from pathlib import Path
    from app.config import get_settings

    mgr = get_memory_manager()
    settings = get_settings()
    workspace = Path(settings.workspace_dir).expanduser()
    memory_dir = workspace / "memory"

    files_by_path = {}
    root_memory = workspace / "MEMORY.md"
    disk_files = [root_memory] if (current_user.is_admin and root_memory.exists()) else []
    if memory_dir.exists():
        if current_user.is_admin:
            disk_files.extend(memory_dir.rglob("*.md"))
        else:
            user_dir = memory_dir / "users" / current_user.id
            if user_dir.exists():
                disk_files.extend(user_dir.rglob("*.md"))

    for f in disk_files:
        rel = str(f.relative_to(workspace))
        stat = f.stat()
        files_by_path[rel] = {"path": rel, "size": stat.st_size, "modified": stat.st_mtime}

    try:
        rows = mgr.storage.list_indexed_files(source="memory")
        for row in rows:
            files_by_path.setdefault(
                row["path"],
                {
                    "path": row["path"],
                    "size": row["size"],
                    "modified": row["mtime"],
                    "indexed_only": True,
                },
            )
    except Exception:
        pass

    files = sorted(files_by_path.values(), key=lambda item: item.get("modified", 0), reverse=True)
    return {"files": files}


@router.delete("/files/{name:path}")
async def delete_memory_file(name: str, current_user: CurrentUser = Depends(require_permissions("memory:write"))):
    if not current_user.is_admin and not name.startswith(f"memory/users/{current_user.id}/"):
        raise HTTPException(status_code=403, detail="Cannot delete another user's memory")
    mgr = get_memory_manager()
    try:
        result = mgr.delete_memory_path(name, delete_file=True)
        return {"status": "ok", **result}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="File not found") from exc


@router.delete("/index/{name:path}")
async def delete_memory_index(name: str, current_user: CurrentUser = Depends(require_permissions("memory:write"))):
    if not current_user.is_admin and not name.startswith(f"memory/users/{current_user.id}/"):
        raise HTTPException(status_code=403, detail="Cannot delete another user's memory")
    mgr = get_memory_manager()
    result = mgr.storage.delete_indexed_file(name)
    if result["deleted_chunks"] == 0 and result["deleted_index_files"] == 0:
        raise HTTPException(status_code=404, detail="Indexed memory not found")
    return {"status": "ok", "deleted_file": False, **result}


@router.get("/files/{name:path}")
async def get_memory_file(name: str, current_user: CurrentUser = Depends(require_permissions("memory:read"))):
    from pathlib import Path
    from app.config import get_settings

    settings = get_settings()
    workspace = Path(settings.workspace_dir).expanduser()
    file_path = (workspace / name).resolve()

    if not str(file_path).startswith(str(workspace.resolve())):
        raise HTTPException(status_code=403, detail="Path outside workspace")
    if not current_user.is_admin and not name.startswith(f"memory/users/{current_user.id}/"):
        raise HTTPException(status_code=403, detail="Cannot read another user's memory")

    if not file_path.exists():
        mgr = get_memory_manager()
        rows = mgr.storage.get_chunks_by_path(name)
        if not rows:
            raise HTTPException(status_code=404, detail="File not found")
        content = "\n\n".join(row["text"] for row in rows)
        return {"path": name, "content": content, "size": len(content), "indexed_only": True}

    content = file_path.read_text(encoding="utf-8")
    return {"path": name, "content": content, "size": len(content)}
