"""Curate durable memories from completed chat exchanges."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass
from typing import Any, Dict, Optional

from app.core.agent.models import LLMRequest

logger = logging.getLogger("stocks-assistant.memory.curator")


ALLOWED_CATEGORIES = {
    "user_preference",
    "watchlist_interest",
    "analysis_style",
    "risk_profile",
    "portfolio_constraint",
    "persistent_fact",
}


CURATOR_SYSTEM_PROMPT = """You are a memory curator for a stock, finance, and market-analysis assistant.

Decide whether the latest exchange contains durable information worth saving for future conversations.
Save only stable, reusable facts or preferences. Do not save ordinary answers, one-off analysis, current prices,
short-term news, transient market opinions, or anything the assistant inferred without user confirmation.

Allowed categories:
- user_preference
- watchlist_interest
- analysis_style
- risk_profile
- portfolio_constraint
- persistent_fact

Return only one JSON object with these fields:
{
  "should_save": boolean,
  "importance": number,
  "confidence": number,
  "category": string,
  "memory": string,
  "reason": string
}
"""


@dataclass
class CuratedMemory:
    should_save: bool
    importance: float
    confidence: float
    category: str
    memory: str
    reason: str


class MemoryCurator:
    """LLM-backed gate that writes only useful long-term memories."""

    def __init__(
        self,
        llm_provider: Any,
        memory_manager: Any,
        model: str,
        min_importance: float = 0.7,
        min_confidence: float = 0.7,
    ):
        self.llm_provider = llm_provider
        self.memory_manager = memory_manager
        self.model = model
        self.min_importance = min_importance
        self.min_confidence = min_confidence

    def curate_exchange(
        self,
        session_id: str,
        user_message: str,
        assistant_response: str,
        user_message_id: Optional[str] = None,
        assistant_message_id: Optional[str] = None,
    ) -> Optional[CuratedMemory]:
        if not user_message.strip() or not assistant_response.strip():
            return None

        raw = self._call_curator(user_message=user_message, assistant_response=assistant_response)
        decision = self._parse_decision(raw)
        if not self._passes_gate(decision):
            return None
        if self._is_duplicate(decision.memory):
            logger.info("Skipping duplicate curated memory for session %s", session_id)
            return None

        metadata = {
            "source": "chat_curator",
            "category": decision.category,
            "importance": decision.importance,
            "confidence": decision.confidence,
            "session_id": session_id,
            "user_message_id": user_message_id,
            "assistant_message_id": assistant_message_id,
            "reason": decision.reason,
        }
        asyncio.run(self.memory_manager.add_memory(
            content=decision.memory,
            scope="shared",
            source="memory",
            metadata=metadata,
        ))
        logger.info("Saved curated memory for session %s: %s", session_id, decision.category)
        return decision

    def _call_curator(self, user_message: str, assistant_response: str) -> str:
        request = LLMRequest(
            model=self.model,
            temperature=0,
            max_tokens=800,
            system=CURATOR_SYSTEM_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "Latest exchange:\n\n"
                                f"USER:\n{_truncate(user_message, 4000)}\n\n"
                                f"ASSISTANT:\n{_truncate(assistant_response, 6000)}"
                            ),
                        }
                    ],
                }
            ],
        )
        response = self.llm_provider.call(request)
        return _extract_response_text(response)

    def _parse_decision(self, raw: str) -> CuratedMemory:
        data = _load_json_object(raw)
        return CuratedMemory(
            should_save=bool(data.get("should_save", False)),
            importance=_coerce_float(data.get("importance")),
            confidence=_coerce_float(data.get("confidence")),
            category=str(data.get("category") or "").strip(),
            memory=str(data.get("memory") or "").strip(),
            reason=str(data.get("reason") or "").strip(),
        )

    def _passes_gate(self, decision: CuratedMemory) -> bool:
        if not decision.should_save:
            return False
        if decision.importance < self.min_importance or decision.confidence < self.min_confidence:
            return False
        if decision.category not in ALLOWED_CATEGORIES:
            return False
        if len(decision.memory) < 8 or len(decision.memory) > 1200:
            return False
        return True

    def _is_duplicate(self, memory: str) -> bool:
        try:
            results = asyncio.run(self.memory_manager.search(
                query=memory,
                max_results=5,
                min_score=0.72,
            ))
        except Exception as exc:
            logger.warning("Curated memory dedupe search failed: %s", exc)
            return False

        normalized = _normalize(memory)
        for result in results:
            snippet = _normalize(getattr(result, "snippet", ""))
            if snippet == normalized or (normalized and normalized in snippet):
                return True
            score = float(getattr(result, "score", 0.0) or 0.0)
            if score >= 0.88:
                return True
        return False


def _extract_response_text(response: Dict[str, Any]) -> str:
    choices = response.get("choices") or []
    if not choices:
        return ""
    message = choices[0].get("message") or {}
    content = message.get("content") or ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(str(item.get("text") or ""))
        return "\n".join(parts)
    return str(content)


def _load_json_object(raw: str) -> Dict[str, Any]:
    text = raw.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL | re.IGNORECASE)
    if fence:
        text = fence.group(1).strip()
    if not text.startswith("{"):
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            text = text[start:end + 1]
    data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError("Curator response must be a JSON object")
    return data


def _coerce_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _normalize(text: str) -> str:
    return re.sub(r"\s+", "", text).lower()


def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + "...[truncated]"
