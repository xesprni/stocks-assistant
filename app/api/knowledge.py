"""知识库 API

提供知识库目录树浏览、文件内容读取和知识图谱接口。
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.deps import get_knowledge_service

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
        return {"path": path, "content": content}
    except HTTPException:
        raise
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
