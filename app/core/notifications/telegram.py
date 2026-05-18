"""Telegram Bot API message sender."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx


TELEGRAM_MESSAGE_LIMIT = 4096


class TelegramConfigError(RuntimeError):
    """Raised when Telegram delivery is requested without required config."""


@dataclass
class TelegramSender:
    """Small synchronous Telegram sender used by scheduler worker threads."""

    enabled: bool
    bot_token: str
    chat_id: str
    api_base: str = "https://api.telegram.org"
    parse_mode: str = ""
    timeout_seconds: float = 15.0

    @classmethod
    def from_settings(cls, settings: Any) -> "TelegramSender":
        return cls(
            enabled=bool(getattr(settings, "telegram_enabled", False)),
            bot_token=str(getattr(settings, "telegram_bot_token", "") or ""),
            chat_id=str(getattr(settings, "telegram_chat_id", "") or ""),
            api_base=str(getattr(settings, "telegram_api_base", "") or "https://api.telegram.org"),
            parse_mode=str(getattr(settings, "telegram_parse_mode", "") or ""),
        )

    @property
    def configured(self) -> bool:
        return self.enabled and bool(self.bot_token and self.chat_id)

    def send_message(self, text: str) -> dict[str, Any]:
        if not self.enabled:
            return {"ok": False, "skipped": True, "reason": "telegram disabled"}
        if not self.bot_token or not self.chat_id:
            raise TelegramConfigError("Telegram bot token or chat id is missing")

        chunks = _chunk_message(text.strip() or "(empty)")
        responses = [self._send_chunk(chunk) for chunk in chunks]
        return {"ok": True, "chunks": len(responses), "responses": responses}

    def _send_chunk(self, text: str) -> dict[str, Any]:
        api_base = self.api_base.rstrip("/")
        url = f"{api_base}/bot{self.bot_token}/sendMessage"
        payload: dict[str, Any] = {
            "chat_id": self.chat_id,
            "text": text,
            "disable_web_page_preview": True,
        }
        if self.parse_mode:
            payload["parse_mode"] = self.parse_mode

        with httpx.Client(timeout=self.timeout_seconds) as client:
            response = client.post(url, json=payload)

        if response.status_code >= 400:
            detail = _telegram_error_detail(response)
            raise RuntimeError(f"Telegram send failed: HTTP {response.status_code}: {detail}")

        data = response.json()
        if not data.get("ok", False):
            raise RuntimeError(f"Telegram send failed: {data.get('description') or 'unknown error'}")
        return data


def _chunk_message(text: str) -> list[str]:
    if len(text) <= TELEGRAM_MESSAGE_LIMIT:
        return [text]

    chunks: list[str] = []
    remaining = text
    while remaining:
        chunk = remaining[:TELEGRAM_MESSAGE_LIMIT]
        split_at = max(chunk.rfind("\n"), chunk.rfind(" "))
        if split_at > TELEGRAM_MESSAGE_LIMIT * 0.6:
            chunk = remaining[:split_at]
        chunks.append(chunk)
        remaining = remaining[len(chunk):].lstrip()
    return chunks


def _telegram_error_detail(response: httpx.Response) -> str:
    try:
        data = response.json()
    except ValueError:
        return response.text[:500]
    detail = data.get("description") if isinstance(data, dict) else None
    return str(detail or data)[:500]
