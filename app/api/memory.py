"""记忆系统 API

提供记忆搜索、添加、同步、状态查询、文件列表和内容读取接口。
"""

from http import HTTPStatus

from fastapi import APIRouter, Depends, HTTPException, Query

from app.constants.security import Permission
from app.core.security import CurrentUser, require_permissions
from app.deps import get_memory_manager, get_memory_manager_for_user
from app.schemas.common import StatusResponse
from app.schemas.memory import (
    MemoryAddRequest,
    MemoryClearResponse,
    MemoryDeleteResponse,
    MemoryFileInfo,
    MemoryFileResponse,
    MemoryFilesResponse,
    MemorySearchResult,
    MemoryStatusResponse,
)

router = APIRouter()


def _user_id_from_memory_path(path: str) -> str | None:
    parts = path.split("/")
    if len(parts) >= 3 and parts[0] == "memory" and parts[1] == "users":
        return parts[2]
    return None


def _manager_for_memory_path(path: str, current_user: CurrentUser):
    path_user_id = _user_id_from_memory_path(path)
    if path_user_id:
        return get_memory_manager_for_user(
            path_user_id if current_user.is_admin else current_user.id
        )
    return (
        get_memory_manager()
        if current_user.is_admin
        else get_memory_manager_for_user(current_user.id)
    )


@router.get("/search", response_model=list[MemorySearchResult])
async def search_memory(
    q: str = Query(..., description="Search query"),
    user_id: str | None = None,
    limit: int | None = None,
    min_score: float | None = None,
    current_user: CurrentUser = Depends(require_permissions(Permission.MEMORY_READ)),
) -> list[MemorySearchResult]:
    effective_user_id = user_id if (user_id and current_user.is_admin) else current_user.id
    mgr = get_memory_manager_for_user(effective_user_id)
    try:
        results = await mgr.search(
            query=q,
            user_id=effective_user_id,
            max_results=limit,
            min_score=min_score,
            include_shared=False,
        )
        return [MemorySearchResult.model_validate(r.__dict__) for r in results]
    except Exception as e:
        raise HTTPException(status_code=HTTPStatus.INTERNAL_SERVER_ERROR, detail=str(e)) from e


@router.post("/add")
async def add_memory(
    request: MemoryAddRequest,
    current_user: CurrentUser = Depends(require_permissions(Permission.MEMORY_WRITE)),
) -> StatusResponse:
    try:
        effective_user_id = (
            request.user_id if (request.user_id and current_user.is_admin) else current_user.id
        )
        use_shared = current_user.is_admin and request.scope == "shared"
        mgr = get_memory_manager() if use_shared else get_memory_manager_for_user(effective_user_id)
        await mgr.add_memory(
            content=request.content,
            user_id=None if use_shared else effective_user_id,
            scope="shared" if use_shared else "user",
            source=request.source,
            path=request.path,
            metadata=request.metadata,
        )
        return StatusResponse()
    except Exception as e:
        raise HTTPException(status_code=HTTPStatus.INTERNAL_SERVER_ERROR, detail=str(e)) from e


@router.post("/sync")
async def sync_memory(
    current_user: CurrentUser = Depends(require_permissions(Permission.MEMORY_WRITE)),
) -> StatusResponse:
    if not current_user.is_admin:
        raise HTTPException(
            status_code=HTTPStatus.FORBIDDEN, detail="Only admins can run full memory sync"
        )
    mgr = get_memory_manager()
    try:
        await mgr.sync()
        return StatusResponse()
    except Exception as e:
        raise HTTPException(status_code=HTTPStatus.INTERNAL_SERVER_ERROR, detail=str(e)) from e


@router.get("/status", response_model=MemoryStatusResponse)
def memory_status(
    current_user: CurrentUser = Depends(require_permissions(Permission.MEMORY_READ)),
) -> MemoryStatusResponse:
    mgr = get_memory_manager_for_user(current_user.id)
    return mgr.get_status()


@router.delete("/clear")
def clear_memory(
    current_user: CurrentUser = Depends(require_permissions(Permission.MEMORY_WRITE)),
) -> MemoryClearResponse:
    mgr = get_memory_manager_for_user(current_user.id)
    try:
        # 一键清除只作用于当前账号的用户记忆，避免误删共享记忆或其他用户数据。
        result = mgr.clear_user_memory(current_user.id)
        return MemoryClearResponse.model_validate(result.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=HTTPStatus.BAD_REQUEST, detail=str(exc)) from exc


@router.get("/files", response_model=MemoryFilesResponse, response_model_exclude_unset=True)
def list_memory_files(
    current_user: CurrentUser = Depends(require_permissions(Permission.MEMORY_READ)),
) -> MemoryFilesResponse:
    from pathlib import Path

    from app.config import get_settings

    mgr = get_memory_manager_for_user(current_user.id)
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
        files_by_path[rel] = MemoryFileInfo(path=rel, size=stat.st_size, modified=stat.st_mtime)

    try:
        rows = mgr.storage.list_indexed_files(source="memory")
        for row in rows:
            path = str(row["path"])
            if not current_user.is_admin and not path.startswith(
                f"memory/users/{current_user.id}/"
            ):
                continue
            files_by_path.setdefault(
                path,
                MemoryFileInfo(
                    path=path, size=row["size"], modified=row["mtime"], indexed_only=True
                ),
            )
    except Exception:
        pass

    files = sorted(files_by_path.values(), key=lambda item: item.modified, reverse=True)
    return MemoryFilesResponse(files=files)


@router.delete("/files/{name:path}")
def delete_memory_file(
    name: str, current_user: CurrentUser = Depends(require_permissions(Permission.MEMORY_WRITE))
) -> MemoryDeleteResponse:
    if not current_user.is_admin and not name.startswith(f"memory/users/{current_user.id}/"):
        raise HTTPException(
            status_code=HTTPStatus.FORBIDDEN, detail="Cannot delete another user's memory"
        )
    mgr = _manager_for_memory_path(name, current_user)
    try:
        result = mgr.delete_memory_path(name, delete_file=True)
        return MemoryDeleteResponse.model_validate(result.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=HTTPStatus.BAD_REQUEST, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=HTTPStatus.NOT_FOUND, detail="File not found") from exc


@router.delete("/index/{name:path}")
def delete_memory_index(
    name: str, current_user: CurrentUser = Depends(require_permissions(Permission.MEMORY_WRITE))
) -> MemoryDeleteResponse:
    if not current_user.is_admin and not name.startswith(f"memory/users/{current_user.id}/"):
        raise HTTPException(
            status_code=HTTPStatus.FORBIDDEN, detail="Cannot delete another user's memory"
        )
    mgr = _manager_for_memory_path(name, current_user)
    result = mgr.storage.delete_indexed_file(name)
    if result.deleted_chunks == 0 and result.deleted_index_files == 0:
        raise HTTPException(status_code=HTTPStatus.NOT_FOUND, detail="Indexed memory not found")
    return MemoryDeleteResponse(deleted_file=False, **result.model_dump())


@router.get(
    "/files/{name:path}", response_model=MemoryFileResponse, response_model_exclude_unset=True
)
def get_memory_file(
    name: str, current_user: CurrentUser = Depends(require_permissions(Permission.MEMORY_READ))
) -> MemoryFileResponse:
    from pathlib import Path

    from app.config import get_settings

    settings = get_settings()
    workspace = Path(settings.workspace_dir).expanduser()
    file_path = (workspace / name).resolve()

    if not file_path.is_relative_to(workspace.resolve()):
        raise HTTPException(status_code=HTTPStatus.FORBIDDEN, detail="Path outside workspace")
    # 必须按解析后的路径检查归属，原始前缀无法拦住 ../ 或跨用户符号链接。
    user_root = workspace.resolve() / "memory" / "users" / current_user.id
    if not current_user.is_admin and not file_path.is_relative_to(user_root):
        raise HTTPException(
            status_code=HTTPStatus.FORBIDDEN, detail="Cannot read another user's memory"
        )

    if not file_path.exists():
        mgr = _manager_for_memory_path(name, current_user)
        rows = mgr.storage.get_chunks_by_path(name)
        if not rows:
            raise HTTPException(status_code=HTTPStatus.NOT_FOUND, detail="File not found")
        content = "\n\n".join(row["text"] for row in rows)
        return MemoryFileResponse(path=name, content=content, size=len(content), indexed_only=True)

    content = file_path.read_text(encoding="utf-8")
    return MemoryFileResponse(path=name, content=content, size=len(content))
