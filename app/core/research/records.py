"""Immutable identities passed between document persistence and indexing."""

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class DocumentIngestion:
    document: dict[str, Any]
    version_id: str
