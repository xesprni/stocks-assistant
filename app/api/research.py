"""统一公司研究工作区 API。"""

from io import BytesIO
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from starlette.concurrency import run_in_threadpool

from app.core.security import CurrentUser, require_permissions
from app.deps import get_memory_manager_for_user, get_research_service
from app.schemas.research import (
    DecisionCreate, DecisionResponse, DecisionUpdate, ResearchDocumentCreate, ResearchDocumentResponse,
    ResearchEvidenceCreate, ResearchEvidenceResponse, SecurityWorkspaceSummary, ThesisSnapshotCreate, ThesisSnapshotResponse,
)

router = APIRouter()


async def _index_latest_document(user_id: str, document: dict) -> None:
    file_path = get_research_service().materialize_document_version(user_id, document["id"])
    manager = get_memory_manager_for_user(user_id)
    await manager.index_file(file_path, source="knowledge", scope="user", user_id=user_id, metadata={"research_document_id": document["id"]})


def _bad_request(exc: Exception) -> HTTPException:
    if isinstance(exc, KeyError):
        return HTTPException(status_code=404, detail="Research resource not found")
    return HTTPException(status_code=400, detail=str(exc))


@router.get("/metrics")
async def research_metrics(
    days: int = Query(30, ge=1, le=365),
    current_user: CurrentUser = Depends(require_permissions("knowledge:read")),
):
    return get_research_service().research_metrics(current_user.id, days=days)


@router.get("/security/{symbol}/summary", response_model=SecurityWorkspaceSummary)
async def security_summary(symbol: str, current_user: CurrentUser = Depends(require_permissions("knowledge:read"))):
    try:
        return await run_in_threadpool(get_research_service().security_summary, current_user.id, symbol)
    except (ValueError, KeyError) as exc:
        raise _bad_request(exc) from exc


@router.get("/security/{symbol}/theses", response_model=list[ThesisSnapshotResponse])
async def list_theses(symbol: str, current_user: CurrentUser = Depends(require_permissions("knowledge:read"))):
    try:
        return get_research_service().list_theses(current_user.id, symbol)
    except ValueError as exc:
        raise _bad_request(exc) from exc


@router.post("/security/{symbol}/theses", response_model=ThesisSnapshotResponse)
async def create_thesis(symbol: str, body: ThesisSnapshotCreate, current_user: CurrentUser = Depends(require_permissions("knowledge:write"))):
    try:
        return get_research_service().create_thesis(current_user.id, symbol, body)
    except (ValueError, KeyError) as exc:
        raise _bad_request(exc) from exc


@router.get("/security/{symbol}/decisions", response_model=list[DecisionResponse])
async def list_decisions(symbol: str, limit: int = Query(50, ge=1, le=200), current_user: CurrentUser = Depends(require_permissions("knowledge:read"))):
    try:
        return get_research_service().list_decisions(current_user.id, symbol, limit)
    except ValueError as exc:
        raise _bad_request(exc) from exc


@router.post("/security/{symbol}/decisions", response_model=DecisionResponse)
async def create_decision(symbol: str, body: DecisionCreate, current_user: CurrentUser = Depends(require_permissions("knowledge:write"))):
    try:
        return get_research_service().create_decision(current_user.id, symbol, body)
    except (ValueError, KeyError) as exc:
        raise _bad_request(exc) from exc


@router.get("/security/{symbol}/evidence", response_model=list[ResearchEvidenceResponse])
async def list_evidence(symbol: str, current_user: CurrentUser = Depends(require_permissions("knowledge:read"))):
    try:
        return get_research_service().list_evidence(current_user.id, symbol)
    except ValueError as exc:
        raise _bad_request(exc) from exc


@router.post("/security/{symbol}/evidence", response_model=ResearchEvidenceResponse)
async def save_evidence(symbol: str, body: ResearchEvidenceCreate, current_user: CurrentUser = Depends(require_permissions("knowledge:write"))):
    try:
        return get_research_service().save_evidence(current_user.id, symbol, body)
    except ValueError as exc:
        raise _bad_request(exc) from exc


@router.patch("/decisions/{decision_id}", response_model=DecisionResponse)
async def update_decision(decision_id: str, body: DecisionUpdate, current_user: CurrentUser = Depends(require_permissions("knowledge:write"))):
    try:
        return get_research_service().update_decision_outcome(current_user.id, decision_id, body.outcome)
    except KeyError as exc:
        raise _bad_request(exc) from exc


@router.get("/security/{symbol}/documents", response_model=list[ResearchDocumentResponse])
async def list_documents(symbol: str, current_user: CurrentUser = Depends(require_permissions("knowledge:read"))):
    try:
        return get_research_service().list_documents(current_user.id, symbol)
    except ValueError as exc:
        raise _bad_request(exc) from exc


@router.post("/security/{symbol}/documents", response_model=ResearchDocumentResponse)
async def ingest_document(symbol: str, body: ResearchDocumentCreate, current_user: CurrentUser = Depends(require_permissions("knowledge:write"))):
    try:
        document = get_research_service().ingest_document(current_user.id, symbol, body)
        await _index_latest_document(current_user.id, document)
        return document
    except (ValueError, KeyError) as exc:
        raise _bad_request(exc) from exc


@router.post("/security/{symbol}/documents/upload", response_model=ResearchDocumentResponse)
async def upload_document(
    symbol: str,
    file: UploadFile = File(...),
    title: str = Form(""),
    document_type: str = Form("pdf"),
    document_id: Optional[str] = Form(None),
    source_url: Optional[str] = Form(None),
    published_at: Optional[str] = Form(None),
    current_user: CurrentUser = Depends(require_permissions("knowledge:write")),
):
    raw = await file.read(20 * 1024 * 1024 + 1)
    if len(raw) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Document exceeds 20 MB")
    filename = file.filename or "document"
    try:
        if filename.lower().endswith(".pdf") or file.content_type == "application/pdf":
            try:
                from pypdf import PdfReader
            except ImportError as exc:
                raise ValueError("PDF parser is unavailable; install project dependencies with uv sync") from exc
            reader = PdfReader(BytesIO(raw))
            page_texts = [(page.extract_text() or "").strip() for page in reader.pages]
            if not any(page_texts):
                raise ValueError("PDF has no extractable text; OCR is required for this scanned document")
            content = "\n".join(page_texts)
            document_type = "pdf" if document_type == "note" else document_type
        else:
            page_texts = []
            content = raw.decode("utf-8")
        request = ResearchDocumentCreate(
            document_id=document_id, title=title.strip() or filename, document_type=document_type,
            content=content, source_url=source_url, published_at=published_at, page_texts=page_texts,
        )
        document = await run_in_threadpool(get_research_service().ingest_document, current_user.id, symbol, request)
        await _index_latest_document(current_user.id, document)
        return document
    except (ValueError, UnicodeError, KeyError) as exc:
        raise _bad_request(exc) from exc


@router.get("/documents/{document_id}", response_model=ResearchDocumentResponse)
async def get_document(document_id: str, current_user: CurrentUser = Depends(require_permissions("knowledge:read"))):
    try:
        return get_research_service().get_document(current_user.id, document_id)
    except KeyError as exc:
        raise _bad_request(exc) from exc
