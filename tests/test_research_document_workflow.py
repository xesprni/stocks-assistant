"""Document parsing, persistence and indexing retain their established ordering."""

import asyncio
from io import BytesIO
from unittest.mock import AsyncMock

import pytest
from pypdf import PdfWriter

from app.core.research.documents import ResearchDocumentService, extract_uploaded_content
from app.core.research.service import ResearchService
from app.schemas.research import ResearchDocumentCreate


def test_utf8_upload_uses_filename_and_user_index_metadata(tmp_path):
    research = ResearchService(str(tmp_path))
    memory = AsyncMock()
    users = []

    def memory_factory(user_id):
        users.append(user_id)
        return memory

    workflow = ResearchDocumentService(research, memory_factory)
    result = asyncio.run(
        workflow.upload(
            "reader",
            "AAA.US",
            "研究正文".encode(),
            "report.md",
            "text/markdown",
            title=" ",
            document_type="note",
        )
    )

    assert result["title"] == "report.md"
    assert users == ["reader"]
    saved = research.get_document("reader", result["id"])
    assert saved["versions"][0]["content"] == "研究正文"
    memory.index_file.assert_awaited_once()
    path = memory.index_file.call_args.args[0]
    assert path.is_relative_to(tmp_path / "users" / "reader" / "knowledge")
    assert memory.index_file.call_args.kwargs == {
        "source": "knowledge",
        "scope": "user",
        "user_id": "reader",
        "metadata": {
            "research_document_id": result["id"],
            "research_document_version_id": saved["versions"][0]["id"],
        },
    }


def test_failed_index_keeps_saved_version_for_retry(tmp_path):
    research = ResearchService(str(tmp_path))
    memory = AsyncMock()
    memory.index_file.side_effect = RuntimeError("index failed")
    workflow = ResearchDocumentService(research, lambda _user_id: memory)
    request = ResearchDocumentCreate(title="Report", content="text")

    with pytest.raises(RuntimeError, match="index failed"):
        asyncio.run(workflow.ingest("reader", "AAA.US", request))

    documents = research.list_documents("reader", "AAA.US")
    assert len(documents) == 1
    memory.index_file.side_effect = None
    retry = request.model_copy(update={"document_id": documents[0]["id"]})
    result = asyncio.run(workflow.ingest("reader", "AAA.US", retry))
    assert result["latest_version"] == 1


def test_invalid_upload_does_not_create_document_or_initialize_memory(tmp_path):
    research = ResearchService(str(tmp_path))

    def unavailable_memory(_user_id):
        raise AssertionError("parsing must finish before memory initialization")

    workflow = ResearchDocumentService(research, unavailable_memory)
    with pytest.raises(UnicodeDecodeError):
        asyncio.run(
            workflow.upload(
                "reader", "AAA.US", b"\xff", "note.md", "text/plain", document_type="note"
            )
        )
    assert research.list_documents("reader", "AAA.US") == []


def test_scanned_pdf_requires_ocr():
    writer = PdfWriter()
    writer.add_blank_page(width=100, height=100)
    stream = BytesIO()
    writer.write(stream)
    with pytest.raises(ValueError, match="OCR is required"):
        extract_uploaded_content(stream.getvalue(), "scan.PDF", None, "note")


def test_interleaved_update_indexes_the_version_committed_by_this_request(tmp_path, monkeypatch):
    research = ResearchService(str(tmp_path))
    memory = AsyncMock()
    original = research.ingest_document_version

    def save_then_update(user_id, symbol, request):
        saved = original(user_id, symbol, request)
        original(
            user_id,
            symbol,
            request.model_copy(update={"document_id": saved.document["id"], "content": "new text"}),
        )
        return saved

    monkeypatch.setattr(research, "ingest_document_version", save_then_update)
    result = asyncio.run(
        ResearchDocumentService(research, lambda _user: memory).ingest(
            "reader", "AAA.US", ResearchDocumentCreate(title="Report", content="original text")
        )
    )
    assert result["latest_version"] == 1
    assert research.get_document("reader", result["id"])["latest_version"] == 2
    indexed = memory.index_file.call_args.args[0]
    assert indexed.name.endswith("-v1.md")
    assert "original text" in indexed.read_text()
    assert "new text" not in indexed.read_text()
    assert (
        memory.index_file.call_args.kwargs["metadata"]["research_document_version_id"]
        == result["versions"][0]["id"]
    )


def test_retry_of_older_content_indexes_its_exact_version(tmp_path):
    research = ResearchService(str(tmp_path))
    memory = AsyncMock()
    first = ResearchDocumentCreate(title="Report", content="original text")
    saved = research.ingest_document("reader", "AAA.US", first)
    research.ingest_document(
        "reader",
        "AAA.US",
        first.model_copy(update={"document_id": saved["id"], "content": "new text"}),
    )
    result = asyncio.run(
        ResearchDocumentService(research, lambda _user: memory).ingest(
            "reader", "AAA.US", first.model_copy(update={"document_id": saved["id"]})
        )
    )
    assert result["latest_version"] == 2
    assert len(result["versions"]) == 2
    indexed = memory.index_file.call_args.args[0]
    assert indexed.name.endswith("-v1.md")
    assert "original text" in indexed.read_text()
