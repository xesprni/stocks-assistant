"""记忆系统 API

提供记忆搜索、添加、同步、状态查询、文件列表和内容读取接口。
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.schemas.memory import (
    MemorySearchRequest, MemorySearchResult, MemoryAddRequest, MemoryStatusResponse,
)
from app.deps import get_memory_manager

router = APIRouter()


@router.get("/search", response_model=list[MemorySearchResult])
async def search_memory(
    q: str = Query(..., description="Search query"),
    user_id: Optional[str] = None,
    limit: Optional[int] = None,
    min_score: Optional[float] = None,
):
    mgr = get_memory_manager()
    try:
        results = await mgr.search(
            query=q, user_id=user_id, max_results=limit, min_score=min_score,
        )
        return [MemorySearchResult(**r.__dict__) for r in results]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/add")
async def add_memory(request: MemoryAddRequest):
    mgr = get_memory_manager()
    try:
        await mgr.add_memory(
            content=request.content, user_id=request.user_id,
            scope=request.scope, source=request.source,
            path=request.path, metadata=request.metadata,
        )
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sync")
async def sync_memory():
    mgr = get_memory_manager()
    try:
        await mgr.sync()
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status", response_model=MemoryStatusResponse)
async def memory_status():
    mgr = get_memory_manager()
    return MemoryStatusResponse(**mgr.get_status())


@router.get("/files")
async def list_memory_files():
    from pathlib import Path
    from app.config import get_settings

    settings = get_settings()
    workspace = Path(settings.workspace_dir).expanduser()
    memory_dir = workspace / "memory"

    if not memory_dir.exists():
        return {"files": []}

    files = []
    for f in memory_dir.rglob("*.md"):
        rel = str(f.relative_to(workspace))
        stat = f.stat()
        files.append({"path": rel, "size": stat.st_size, "modified": stat.st_mtime})

    return {"files": files}


@router.get("/files/{name:path}")
async def get_memory_file(name: str):
    from pathlib import Path
    from app.config import get_settings

    settings = get_settings()
    workspace = Path(settings.workspace_dir).expanduser()
    file_path = (workspace / name).resolve()

    if not str(file_path).startswith(str(workspace.resolve())):
        raise HTTPException(status_code=403, detail="Path outside workspace")

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    content = file_path.read_text(encoding="utf-8")
    return {"path": name, "content": content, "size": len(content)}
