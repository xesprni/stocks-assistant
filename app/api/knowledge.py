"""知识库 API

提供知识库目录树浏览、文件内容读取、文件导入、URL 导入和知识图谱接口。
"""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from starlette.concurrency import run_in_threadpool

from app.config import get_effective_settings
from app.core.knowledge.service import KnowledgeService
from app.core.security import CurrentUser, require_permissions, user_workspace_dir
from app.schemas.knowledge import KnowledgeFileSaveRequest, KnowledgeSaveResponse, KnowledgeUrlSaveRequest

router = APIRouter()


def _knowledge_service(user: CurrentUser) -> KnowledgeService:
    settings = get_effective_settings(user.id)
    root = user_workspace_dir(settings.workspace_dir, user.id)
    return KnowledgeService(workspace_root=root)


async def _index_saved_knowledge(user: CurrentUser, result: dict) -> None:
    """知识写入成功后立即进入当前用户索引，避免首次检索读不到新内容。"""
    from app.deps import get_memory_manager_for_user

    settings = get_effective_settings(user.id)
    if not settings.memory_enabled:
        return
    root = Path(user_workspace_dir(settings.workspace_dir, user.id))
    file_path = root / "knowledge" / str(result["path"])
    manager = get_memory_manager_for_user(user.id)
    await manager.index_file(
        file_path,
        source="knowledge",
        scope="user",
        user_id=user.id,
        metadata={"source_url": result.get("source")},
    )


@router.get("/tree")
async def knowledge_tree(current_user: CurrentUser = Depends(require_permissions("knowledge:read"))):
    service = _knowledge_service(current_user)
    try:
        tree = service.list_tree()
        return {"tree": tree}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/read")
async def read_knowledge_file(
    path: str = Query(..., description="File path relative to knowledge dir"),
    current_user: CurrentUser = Depends(require_permissions("knowledge:read")),
):
    service = _knowledge_service(current_user)
    try:
        content = service.read_file(path)
        if content is None:
            raise HTTPException(status_code=404, detail="File not found")
        return content
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/files", response_model=KnowledgeSaveResponse)
async def save_knowledge_file(
    payload: KnowledgeFileSaveRequest,
    current_user: CurrentUser = Depends(require_permissions("knowledge:write")),
):
    service = _knowledge_service(current_user)
    try:
        result = service.save_text_file(
            filename=payload.filename,
            content=payload.content,
            directory=payload.directory,
        )
        await _index_saved_knowledge(current_user, result)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/url", response_model=KnowledgeSaveResponse)
async def save_knowledge_url(
    payload: KnowledgeUrlSaveRequest,
    current_user: CurrentUser = Depends(require_permissions("knowledge:write")),
):
    service = _knowledge_service(current_user)
    try:
        result = await run_in_threadpool(
            service.save_url,
            payload.url,
            payload.filename,
            payload.directory,
        )
        await _index_saved_knowledge(current_user, result)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/graph")
async def knowledge_graph(current_user: CurrentUser = Depends(require_permissions("knowledge:read"))):
    service = _knowledge_service(current_user)
    try:
        graph = service.build_graph()
        return graph
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
