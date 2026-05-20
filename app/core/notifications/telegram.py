"""Telegram Bot API message sender."""

from __future__ import annotations

from dataclasses import dataclass
import html
import re
from typing import Any

import httpx


TELEGRAM_MESSAGE_LIMIT = 4096
TELEGRAM_FORMATTED_SOURCE_LIMIT = 3000
TELEGRAM_FORMATTED_RETRY_SOURCE_LIMIT = 1800


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

        text = text.strip() or "(empty)"
        render_html = _should_render_markdown_as_html(self.parse_mode)
        limit = TELEGRAM_FORMATTED_SOURCE_LIMIT if render_html else TELEGRAM_MESSAGE_LIMIT
        chunks = _chunk_message(text, limit=limit)

        responses = []
        for chunk in chunks:
            if render_html:
                rendered = _markdown_to_telegram_html(chunk)
                if len(rendered) > TELEGRAM_MESSAGE_LIMIT:
                    for sub_chunk in _chunk_message(chunk, limit=TELEGRAM_FORMATTED_RETRY_SOURCE_LIMIT):
                        responses.append(
                            self._send_chunk(
                                _markdown_to_telegram_html(sub_chunk),
                                parse_mode="HTML",
                                fallback_text=_markdown_to_plain_text(sub_chunk),
                            )
                        )
                else:
                    responses.append(self._send_chunk(rendered, parse_mode="HTML", fallback_text=_markdown_to_plain_text(chunk)))
            else:
                responses.append(self._send_chunk(chunk, parse_mode=_telegram_parse_mode(self.parse_mode)))
        return {"ok": True, "chunks": len(responses), "responses": responses}

    def _send_chunk(self, text: str, parse_mode: str = "", fallback_text: str | None = None) -> dict[str, Any]:
        api_base = self.api_base.rstrip("/")
        url = f"{api_base}/bot{self.bot_token}/sendMessage"
        payload: dict[str, Any] = {
            "chat_id": self.chat_id,
            "text": text,
            "disable_web_page_preview": True,
        }
        if parse_mode:
            payload["parse_mode"] = parse_mode

        with httpx.Client(timeout=self.timeout_seconds) as client:
            response = client.post(url, json=payload)
            if parse_mode and response.status_code >= 400 and _should_retry_without_parse_mode(response):
                fallback_payload = dict(payload)
                fallback_payload.pop("parse_mode", None)
                if fallback_text is not None:
                    fallback_payload["text"] = fallback_text
                response = client.post(url, json=fallback_payload)

        if response.status_code >= 400:
            detail = _telegram_error_detail(response)
            raise RuntimeError(f"Telegram send failed: HTTP {response.status_code}: {detail}")

        data = response.json()
        if not data.get("ok", False):
            raise RuntimeError(f"Telegram send failed: {data.get('description') or 'unknown error'}")
        return data


def _chunk_message(text: str, limit: int = TELEGRAM_MESSAGE_LIMIT) -> list[str]:
    if len(text) <= limit:
        return [text]

    chunks: list[str] = []
    remaining = text
    while remaining:
        chunk = remaining[:limit]
        split_at = max(chunk.rfind("\n"), chunk.rfind(" "))
        if split_at > limit * 0.6:
            chunk = remaining[:split_at]
        chunks.append(chunk)
        remaining = remaining[len(chunk):].lstrip()
    return chunks


def _should_render_markdown_as_html(parse_mode: str) -> bool:
    mode = (parse_mode or "").strip().lower()
    return mode in {"", "auto", "html", "markdown", "markdownv2"}


def _telegram_parse_mode(parse_mode: str) -> str:
    mode = (parse_mode or "").strip()
    if mode.lower() in {"", "auto", "plain", "none", "text"}:
        return ""
    return mode


def _markdown_to_telegram_html(text: str) -> str:
    lines = text.splitlines()
    output: list[str] = []
    code_lines: list[str] = []
    table_lines: list[str] = []
    in_code = False

    def flush_code() -> None:
        nonlocal code_lines
        if code_lines:
            output.append(f"<pre>{html.escape(chr(10).join(code_lines), quote=False)}</pre>")
            code_lines = []

    def flush_table() -> None:
        nonlocal table_lines
        if table_lines:
            output.extend(_markdown_table_to_html_lines(table_lines))
            table_lines = []

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("```"):
            flush_table()
            if in_code:
                flush_code()
            in_code = not in_code
            continue

        if in_code:
            code_lines.append(line)
            continue

        if _looks_like_markdown_table_line(line):
            table_lines.append(line)
            continue

        flush_table()
        if not stripped:
            output.append("")
            continue
        if re.fullmatch(r"[-*_]{3,}", stripped):
            output.append("────────")
            continue

        heading = re.match(r"^(#{1,6})\s+(.+)$", stripped)
        if heading:
            output.append(f"<b>{_format_inline_markdown(heading.group(2))}</b>")
            continue

        numbered_heading = re.match(r"^(\d+(?:\.\d+)*)\.\s+(.+)$", stripped)
        if numbered_heading:
            output.append(f"<b>{html.escape(numbered_heading.group(1), quote=False)}. {_format_inline_markdown(numbered_heading.group(2))}</b>")
            continue

        quote = re.match(r"^>\s?(.*)$", stripped)
        if quote:
            output.append(f"<blockquote>{_format_inline_markdown(quote.group(1))}</blockquote>")
            continue

        output.append(_format_inline_markdown(line))

    if in_code:
        flush_code()
    flush_table()
    return "\n".join(output).strip() or html.escape(text.strip() or "(empty)", quote=False)


def _format_inline_markdown(text: str) -> str:
    parts = re.split(r"(`[^`]*`)", text)
    rendered: list[str] = []
    for part in parts:
        if len(part) >= 2 and part.startswith("`") and part.endswith("`"):
            rendered.append(f"<code>{html.escape(part[1:-1], quote=False)}</code>")
        else:
            rendered.append(_format_inline_without_code(part))
    return "".join(rendered)


def _format_inline_without_code(text: str) -> str:
    placeholders: list[str] = []

    def link_repl(match: re.Match[str]) -> str:
        label = html.escape(match.group(1), quote=False)
        url = html.escape(match.group(2), quote=True)
        placeholders.append(f'<a href="{url}">{label}</a>')
        return f"@@TG_LINK_{len(placeholders) - 1}@@"

    text = re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", link_repl, text)
    escaped = html.escape(text, quote=False)
    escaped = re.sub(r"\*\*([^*\n]+?)\*\*", r"<b>\1</b>", escaped)
    escaped = re.sub(r"__([^_\n]+?)__", r"<b>\1</b>", escaped)
    escaped = re.sub(r"~~([^~\n]+?)~~", r"<s>\1</s>", escaped)
    escaped = re.sub(r"(?<!\*)\*([^*\n]+?)\*(?!\*)", r"<i>\1</i>", escaped)

    for index, value in enumerate(placeholders):
        escaped = escaped.replace(f"@@TG_LINK_{index}@@", value)
    return escaped


def _looks_like_markdown_table_line(line: str) -> bool:
    stripped = line.strip()
    return stripped.count("|") >= 2 and ("---" in stripped or stripped.startswith("|") or stripped.endswith("|"))


def _markdown_table_to_html_lines(lines: list[str]) -> list[str]:
    rows = [_parse_markdown_table_row(line) for line in lines]
    rows = [row for row in rows if row and not _is_markdown_table_separator(row)]
    if not rows:
        return []

    header = rows[0]
    body = rows[1:]
    if not body:
        return [html.escape(" | ".join(_markdown_inline_to_plain(cell) for cell in header), quote=False)]

    rendered: list[str] = []
    for row in body:
        padded = row + [""] * max(0, len(header) - len(row))
        title = _markdown_inline_to_plain(padded[0]) if padded else ""
        details = []
        for index, value in enumerate(padded[1:], 1):
            plain_value = _markdown_inline_to_plain(value)
            if not plain_value:
                continue
            label = _markdown_inline_to_plain(header[index]) if index < len(header) else ""
            details.append(f"{label} {plain_value}".strip())

        if title and details:
            rendered.append(f"• <b>{html.escape(title, quote=False)}</b>: {html.escape(' · '.join(details), quote=False)}")
        elif title:
            rendered.append(f"• {html.escape(title, quote=False)}")
        elif details:
            rendered.append(f"• {html.escape(' · '.join(details), quote=False)}")
    return rendered


def _parse_markdown_table_row(line: str) -> list[str]:
    stripped = line.strip()
    if stripped.startswith("|"):
        stripped = stripped[1:]
    if stripped.endswith("|"):
        stripped = stripped[:-1]
    return [cell.strip() for cell in stripped.split("|")]


def _is_markdown_table_separator(row: list[str]) -> bool:
    return bool(row) and all(re.fullmatch(r":?-{3,}:?", cell.strip()) for cell in row)


def _markdown_inline_to_plain(text: str) -> str:
    text = re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", r"\1", text)
    text = re.sub(r"\*\*([^*\n]+?)\*\*", r"\1", text)
    text = re.sub(r"__([^_\n]+?)__", r"\1", text)
    text = re.sub(r"~~([^~\n]+?)~~", r"\1", text)
    text = re.sub(r"`([^`\n]+?)`", r"\1", text)
    text = re.sub(r"(?<!\*)\*([^*\n]+?)\*(?!\*)", r"\1", text)
    return " ".join(text.split())


def _markdown_to_plain_text(text: str) -> str:
    text = re.sub(r"```(?:\w+)?\n?", "", text)
    text = text.replace("```", "")
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"\*\*([^*\n]+?)\*\*", r"\1", text)
    text = re.sub(r"__([^_\n]+?)__", r"\1", text)
    text = re.sub(r"~~([^~\n]+?)~~", r"\1", text)
    text = re.sub(r"`([^`\n]+?)`", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", r"\1 (\2)", text)
    return text.strip() or "(empty)"


def _telegram_error_detail(response: httpx.Response) -> str:
    try:
        data = response.json()
    except ValueError:
        return response.text[:500]
    detail = data.get("description") if isinstance(data, dict) else None
    return str(detail or data)[:500]


def _should_retry_without_parse_mode(response: httpx.Response) -> bool:
    detail = _telegram_error_detail(response).lower()
    return response.status_code == 400 and (
        "can't parse entities" in detail
        or "can't find end of the entity" in detail
        or "entity" in detail and "parse" in detail
    )
