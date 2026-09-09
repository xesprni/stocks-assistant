"""统一公司研究工作区 API。"""

from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile

from app.config import get_effective_settings
from app.core.research.documents import ResearchDocumentService
from app.core.research.quick_prompts import QuickPromptsUnavailableError
from app.core.security import CurrentUser, require_permissions
from app.deps import (
    get_memory_manager_for_user,
    get_research_quick_prompts_service,
    get_research_service,
)
from app.schemas.research import (
    DecisionCreate,
    DecisionResponse,
    DecisionUpdate,
    ResearchDocumentCreate,
    ResearchDocumentResponse,
    ResearchEvidenceCreate,
    ResearchEvidenceResponse,
    ResearchQuickPromptsResponse,
    SecurityWorkspaceSummary,
    ThesisSnapshotCreate,
    ThesisSnapshotResponse,
)

router = APIRouter()


@router.get("/quick-prompts", response_model=ResearchQuickPromptsResponse)
def quick_prompts(
    language: Literal["zh", "en"] | None = Query(None),
    force_refresh: bool = Query(False),
    current_user: CurrentUser = Depends(require_permissions("chat:write")),
):
    settings = get_effective_settings(current_user.id)
    try:
        return get_research_quick_prompts_service().get_prompts(
            current_user.id,
            language=language or settings.app_language,
            settings=settings,
            force_refresh=force_refresh,
            can_read_watchlist=current_user.can("watchlist:read"),
            can_read_portfolio=current_user.can("portfolio:read"),
        )
    except QuickPromptsUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


def _bad_request(exc: Exception) -> HTTPException:
    if isinstance(exc, KeyError):
        return HTTPException(status_code=404, detail="Research resource not found")
    return HTTPException(status_code=400, detail=str(exc))


@router.get("/metrics")
def research_metrics(
    days: int = Query(30, ge=1, le=365),
    current_user: CurrentUser = Depends(require_permissions("knowledge:read")),
):
    return get_research_service().research_metrics(current_user.id, days=days)


@router.get("/security/{symbol}/summary", response_model=SecurityWorkspaceSummary)
def security_summary(
    symbol: str, current_user: CurrentUser = Depends(require_permissions("knowledge:read"))
):
    try:
        return get_research_service().security_summary(current_user.id, symbol)
    except (ValueError, KeyError) as exc:
        raise _bad_request(exc) from exc


@router.get("/security/{symbol}/theses", response_model=list[ThesisSnapshotResponse])
def list_theses(
    symbol: str, current_user: CurrentUser = Depends(require_permissions("knowledge:read"))
):
    try:
        return get_research_service().list_theses(current_user.id, symbol)
    except ValueError as exc:
        raise _bad_request(exc) from exc


@router.post("/security/{symbol}/theses", response_model=ThesisSnapshotResponse)
def create_thesis(
    symbol: str,
    body: ThesisSnapshotCreate,
    current_user: CurrentUser = Depends(require_permissions("knowledge:write")),
):
    try:
        return get_research_service().create_thesis(current_user.id, symbol, body)
    except (ValueError, KeyError) as exc:
        raise _bad_request(exc) from exc


@router.get("/security/{symbol}/decisions", response_model=list[DecisionResponse])
def list_decisions(
    symbol: str,
    limit: int = Query(50, ge=1, le=200),
    current_user: CurrentUser = Depends(require_permissions("knowledge:read")),
):
    try:
        return get_research_service().list_decisions(current_user.id, symbol, limit)
    except ValueError as exc:
        raise _bad_request(exc) from exc


@router.post("/security/{symbol}/decisions", response_model=DecisionResponse)
def create_decision(
    symbol: str,
    body: DecisionCreate,
    current_user: CurrentUser = Depends(require_permissions("knowledge:write")),
):
    try:
        return get_research_service().create_decision(current_user.id, symbol, body)
    except (ValueError, KeyError) as exc:
        raise _bad_request(exc) from exc


@router.get("/security/{symbol}/evidence", response_model=list[ResearchEvidenceResponse])
def list_evidence(
    symbol: str, current_user: CurrentUser = Depends(require_permissions("knowledge:read"))
):
    try:
        return get_research_service().list_evidence(current_user.id, symbol)
    except ValueError as exc:
        raise _bad_request(exc) from exc


@router.post("/security/{symbol}/evidence", response_model=ResearchEvidenceResponse)
def save_evidence(
    symbol: str,
    body: ResearchEvidenceCreate,
    current_user: CurrentUser = Depends(require_permissions("knowledge:write")),
):
    try:
        return get_research_service().save_evidence(current_user.id, symbol, body)
    except ValueError as exc:
        raise _bad_request(exc) from exc


@router.patch("/decisions/{decision_id}", response_model=DecisionResponse)
def update_decision(
    decision_id: str,
    body: DecisionUpdate,
    current_user: CurrentUser = Depends(require_permissions("knowledge:write")),
):
    try:
        return get_research_service().update_decision_outcome(
            current_user.id, decision_id, body.outcome
        )
    except KeyError as exc:
        raise _bad_request(exc) from exc


@router.get("/security/{symbol}/documents", response_model=list[ResearchDocumentResponse])
def list_documents(
    symbol: str, current_user: CurrentUser = Depends(require_permissions("knowledge:read"))
):
    try:
        return get_research_service().list_documents(current_user.id, symbol)
    except ValueError as exc:
        raise _bad_request(exc) from exc


@router.post("/security/{symbol}/documents", response_model=ResearchDocumentResponse)
async def ingest_document(
    symbol: str,
    body: ResearchDocumentCreate,
    current_user: CurrentUser = Depends(require_permissions("knowledge:write")),
):
    try:
        service = ResearchDocumentService(get_research_service(), get_memory_manager_for_user)
        return await service.ingest(current_user.id, symbol, body)
    except (ValueError, KeyError) as exc:
        raise _bad_request(exc) from exc


@router.post("/security/{symbol}/documents/upload", response_model=ResearchDocumentResponse)
async def upload_document(
    symbol: str,
    file: UploadFile = File(...),
    title: str = Form(""),
    document_type: str = Form("pdf"),
    document_id: str | None = Form(None),
    source_url: str | None = Form(None),
    published_at: str | None = Form(None),
    current_user: CurrentUser = Depends(require_permissions("knowledge:write")),
):
    raw = await file.read(20 * 1024 * 1024 + 1)
    if len(raw) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Document exceeds 20 MB")
    filename = file.filename or "document"
    try:
        service = ResearchDocumentService(get_research_service(), get_memory_manager_for_user)
        return await service.upload(
            current_user.id,
            symbol,
            raw,
            filename,
            file.content_type,
            title=title,
            document_type=document_type,
            document_id=document_id,
            source_url=source_url,
            published_at=published_at,
        )
    except (ValueError, UnicodeError, KeyError) as exc:
        raise _bad_request(exc) from exc


@router.get("/documents/{document_id}", response_model=ResearchDocumentResponse)
def get_document(
    document_id: str, current_user: CurrentUser = Depends(require_permissions("knowledge:read"))
):
    try:
        return get_research_service().get_document(current_user.id, document_id)
    except KeyError as exc:
        raise _bad_request(exc) from exc
