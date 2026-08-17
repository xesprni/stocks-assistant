"""工具结果的统一来源与证据元数据。"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

from app.schemas.evidence import Evidence, SourceReference


LONGBRIDGE_DOCS_URL = "https://open.longbridge.com/docs"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def source_reference(
    *,
    source_type: str,
    provider: str,
    title: str,
    url: Optional[str] = None,
    published_at: Optional[str] = None,
    as_of: Optional[str] = None,
    fetched_at: Optional[str] = None,
    stale: bool = False,
    symbol: Optional[str] = None,
    locator: Optional[str] = None,
) -> SourceReference:
    fetched = fetched_at or utc_now_iso()
    identity = "|".join(
        str(value or "")
        for value in (source_type, provider, title, url, published_at, as_of, symbol, locator)
    )
    source_id = "src_" + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:16]
    return SourceReference(
        id=source_id,
        source_type=source_type,
        provider=provider,
        title=title,
        url=url,
        published_at=published_at,
        as_of=as_of,
        fetched_at=fetched,
        stale=stale,
        symbol=symbol,
        locator=locator,
    )


def evidence_for_source(
    source: SourceReference,
    *,
    excerpt: Optional[str] = None,
    data: Optional[dict[str, Any]] = None,
) -> Evidence:
    identity = f"{source.id}|{excerpt or ''}|{data or {}}"
    evidence_id = "ev_" + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:16]
    return Evidence(id=evidence_id, source=source, excerpt=excerpt, data=data or {})


def evidence_metadata(items: Iterable[Evidence]) -> dict[str, Any]:
    values = [item.model_dump(mode="json") for item in items]
    return {"evidence": values, "sources": [item["source"] for item in values]}


def infer_result_timestamp(data: Any) -> tuple[Optional[str], Optional[str], bool]:
    """从服务返回中尽力提取数据时间、抓取时间和陈旧状态。"""
    if isinstance(data, dict):
        as_of = data.get("as_of") or data.get("timestamp") or data.get("quote_time")
        fetched_at = data.get("fetched_at")
        stale = bool(data.get("stale", False))
        return _string_or_none(as_of), _string_or_none(fetched_at), stale
    return None, None, False


def longbridge_evidence(
    *,
    title: str,
    data: Any,
    symbols: Iterable[str] = (),
    source_type: str = "market_data",
) -> dict[str, Any]:
    as_of, fetched_at, stale = infer_result_timestamp(data)
    normalized = [str(symbol).strip() for symbol in symbols if str(symbol).strip()]
    symbol_text = ",".join(normalized) or None
    source = source_reference(
        source_type=source_type,
        provider="Longbridge OpenAPI",
        title=title,
        url=LONGBRIDGE_DOCS_URL,
        as_of=as_of,
        fetched_at=fetched_at,
        stale=stale,
        symbol=symbol_text,
    )
    return evidence_metadata([evidence_for_source(source)])


def merge_evidence_metadata(*metadata_values: Optional[dict[str, Any]]) -> dict[str, Any]:
    evidence: list[dict[str, Any]] = []
    sources: list[dict[str, Any]] = []
    seen_evidence: set[str] = set()
    seen_sources: set[str] = set()
    for metadata in metadata_values:
        if not metadata:
            continue
        for item in metadata.get("evidence", []):
            item_id = str(item.get("id") or "") if isinstance(item, dict) else ""
            if item_id and item_id not in seen_evidence:
                seen_evidence.add(item_id)
                evidence.append(item)
        for item in metadata.get("sources", []):
            item_id = str(item.get("id") or "") if isinstance(item, dict) else ""
            if item_id and item_id not in seen_sources:
                seen_sources.add(item_id)
                sources.append(item)
    return {"evidence": evidence, "sources": sources}


def _string_or_none(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None

