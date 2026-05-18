"""知识库 API

提供知识库目录树浏览、文件内容读取、文件导入、URL 导入和知识图谱接口。
"""

from fastapi import APIRouter, HTTPException, Query
from starlette.concurrency import run_in_threadpool

from app.deps import get_knowledge_service
from app.schemas.knowledge import KnowledgeFileSaveRequest, KnowledgeSaveResponse, KnowledgeUrlSaveRequest

router = APIRouter()


@router.get("/tree")
async def knowledge_tree():
    service = get_knowledge_service()
    try:
        tree = service.list_tree()
        return {"tree": tree}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/read")
async def read_knowledge_file(path: str = Query(..., description="File path relative to knowledge dir")):
    service = get_knowledge_service()
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
async def save_knowledge_file(payload: KnowledgeFileSaveRequest):
    service = get_knowledge_service()
    try:
        return service.save_text_file(
            filename=payload.filename,
            content=payload.content,
            directory=payload.directory,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/url", response_model=KnowledgeSaveResponse)
async def save_knowledge_url(payload: KnowledgeUrlSaveRequest):
    service = get_knowledge_service()
    try:
        return await run_in_threadpool(
            service.save_url,
            payload.url,
            payload.filename,
            payload.directory,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/graph")
async def knowledge_graph():
    service = get_knowledge_service()
    try:
        graph = service.build_graph()
        return graph
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
