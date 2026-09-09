"""Parse, persist and index uploaded research materials."""

from __future__ import annotations

from collections.abc import Callable
from io import BytesIO
from typing import TYPE_CHECKING, Any

from starlette.concurrency import run_in_threadpool

from app.schemas.research import ResearchDocumentCreate

if TYPE_CHECKING:
    from app.core.memory.manager import MemoryManager
    from app.core.research.service import ResearchService


def extract_uploaded_content(
    raw: bytes,
    filename: str,
    content_type: str | None,
    document_type: str,
) -> tuple[str, list[str], str]:
    """Extract PDF pages or UTF-8 text, preserving existing upload semantics."""
    if filename.lower().endswith(".pdf") or content_type == "application/pdf":
        try:
            from pypdf import PdfReader
        except ImportError as exc:
            raise ValueError(
                "PDF parser is unavailable; install project dependencies with uv sync"
            ) from exc
        reader = PdfReader(BytesIO(raw))
        page_texts = [(page.extract_text() or "").strip() for page in reader.pages]
        if not any(page_texts):
            raise ValueError(
                "PDF has no extractable text; OCR is required for this scanned document"
            )
        return (
            ("pdf" if document_type == "note" else document_type),
            page_texts,
            "\n".join(page_texts),
        )
    return document_type, [], raw.decode("utf-8")


class ResearchDocumentService:
    """Coordinate document persistence and the existing user-scoped memory index."""

    def __init__(
        self, research: ResearchService, memory_factory: Callable[[str], MemoryManager]
    ) -> None:
        self.research = research
        self.memory_factory = memory_factory

    async def ingest(
        self, user_id: str, symbol: str, request: ResearchDocumentCreate
    ) -> dict[str, Any]:
        # SQLite 和材料写盘继续放在线程池；索引失败保留已保存的版本，便于用户重试。
        ingestion = await run_in_threadpool(
            self.research.ingest_document_version, user_id, symbol, request
        )
        document = ingestion.document
        path = await run_in_threadpool(
            self.research.materialize_document_version,
            user_id,
            document["id"],
            version_id=ingestion.version_id,
        )
        manager = self.memory_factory(user_id)
        await manager.index_file(
            path,
            source="knowledge",
            scope="user",
            user_id=user_id,
            metadata={
                "research_document_id": document["id"],
                "research_document_version_id": ingestion.version_id,
            },
        )
        return document

    async def upload(
        self,
        user_id: str,
        symbol: str,
        raw: bytes,
        filename: str,
        content_type: str | None,
        *,
        title: str = "",
        document_type: str = "pdf",
        document_id: str | None = None,
        source_url: str | None = None,
        published_at: str | None = None,
    ) -> dict[str, Any]:
        # PDF 逐页抽取也在线程池执行，解析成功后才开始持久化。
        kind, pages, content = await run_in_threadpool(
            extract_uploaded_content,
            raw,
            filename,
            content_type,
            document_type,
        )
        request = ResearchDocumentCreate(
            document_id=document_id,
            title=title.strip() or filename,
            document_type=kind,
            content=content,
            source_url=source_url,
            published_at=published_at,
            page_texts=pages,
        )
        return await self.ingest(user_id, symbol, request)
