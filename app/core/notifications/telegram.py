"""Telegram Bot API message sender."""

from __future__ import annotations

import html
import os
import re
import stat
import struct
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx

from app.core.tools.paths import resolve_workspace_path

TELEGRAM_MESSAGE_LIMIT = 4096
TELEGRAM_FORMATTED_SOURCE_LIMIT = 3000
TELEGRAM_FORMATTED_RETRY_SOURCE_LIMIT = 1800
TELEGRAM_CAPTION_LIMIT = 1024
TELEGRAM_PHOTO_LIMIT = 10
TELEGRAM_PHOTO_MAX_BYTES = 10 * 1024 * 1024


class TelegramConfigError(RuntimeError):
    """Raised when Telegram delivery is requested without required config."""


@dataclass(frozen=True)
class _PreparedPhoto:
    source: str
    content: bytes | None = None
    content_type: str = ""


@dataclass
class TelegramSender:
    """Small synchronous Telegram sender used by scheduler worker threads."""

    enabled: bool
    bot_token: str
    chat_id: str
    api_base: str = "https://api.telegram.org"
    parse_mode: str = ""
    timeout_seconds: float = 15.0
    workspace_dir: str | None = None

    @classmethod
    def from_settings(cls, settings: Any, *, workspace_dir: str | None = None) -> TelegramSender:
        return cls(
            enabled=bool(getattr(settings, "telegram_enabled", False)),
            bot_token=str(getattr(settings, "telegram_bot_token", "") or ""),
            chat_id=str(getattr(settings, "telegram_chat_id", "") or ""),
            api_base=str(getattr(settings, "telegram_api_base", "") or "https://api.telegram.org"),
            parse_mode=str(getattr(settings, "telegram_parse_mode", "") or ""),
            workspace_dir=workspace_dir,
        )

    @property
    def configured(self) -> bool:
        return self.enabled and bool(self.bot_token and self.chat_id)

    def send_photo(self, photo: str, caption: str = "") -> dict[str, Any]:
        return self.send_message(caption, photos=[photo])

    def send_message(self, text: str, *, photos: list[str] | None = None) -> dict[str, Any]:
        if not self.enabled:
            return {"ok": False, "skipped": True, "reason": "telegram disabled"}
        if not self.bot_token or not self.chat_id:
            raise TelegramConfigError("Telegram bot token or chat id is missing")

        # 先验证并读取全部图片，防止发出文字后才发现越界路径或损坏附件。
        prepared = self._prepare_photos(photos)
        text = text.strip()
        caption, caption_mode, fallback_caption = "", "", None
        if prepared and text:
            caption, caption_mode, fallback_caption = self._prepare_caption(text)
        responses = []
        if not prepared or (text and not caption):
            responses.extend(self._send_text(text or "(empty)"))
        for index, photo in enumerate(prepared):
            responses.append(
                self._send_photo(
                    photo,
                    caption=caption if index == 0 else "",
                    parse_mode=caption_mode if index == 0 else "",
                    fallback_caption=fallback_caption if index == 0 else None,
                )
            )
        return {
            "ok": True,
            "chunks": len(responses),
            "photos": len(prepared),
            "responses": responses,
        }

    def _prepare_photos(self, photos: list[str] | None) -> list[_PreparedPhoto]:
        if photos is None:
            return []
        if not isinstance(photos, list) or len(photos) > TELEGRAM_PHOTO_LIMIT:
            raise ValueError(f"Telegram photos must be a list of at most {TELEGRAM_PHOTO_LIMIT}")
        prepared = []
        for source in photos:
            if not isinstance(source, str) or not source.strip():
                raise ValueError("Telegram photo must be a non-empty URL or workspace path")
            source = source.strip()
            if len(source) > 4096:
                raise ValueError("Telegram photo URL or workspace path exceeds 4096 characters")
            try:
                parsed = urlsplit(source)
            except ValueError:
                raise ValueError("Invalid Telegram photo URL") from None
            if parsed.scheme.lower() in {"http", "https"}:
                if (
                    not parsed.hostname
                    or parsed.username
                    or parsed.password
                    or any(char.isspace() or ord(char) < 32 for char in source)
                ):
                    raise ValueError("Invalid Telegram photo URL")
                # URL 交由 Telegram 获取，应用不自行下载外部资源。
                prepared.append(_PreparedPhoto(source=source))
                continue
            if parsed.scheme or source.startswith("//"):
                raise ValueError("Telegram photo URL must use HTTP or HTTPS")
            if not self.workspace_dir:
                raise ValueError("A user workspace is required for local Telegram photos")
            try:
                target = resolve_workspace_path(Path(self.workspace_dir), source)
                if not target.is_file():
                    raise ValueError("Telegram photo must be a regular file")
                # 禁止最终文件在校验后被替换为软链接或阻塞设备，再核对已打开的描述符。
                descriptor = os.open(target, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                with os.fdopen(descriptor, "rb") as file:
                    if not stat.S_ISREG(os.fstat(file.fileno()).st_mode):
                        raise ValueError("Telegram photo must be a regular file")
                    content = file.read(TELEGRAM_PHOTO_MAX_BYTES + 1)
            except (OSError, RuntimeError):
                raise ValueError("Telegram photo could not be read from the workspace") from None
            if len(content) > TELEGRAM_PHOTO_MAX_BYTES:
                raise ValueError("Telegram photo exceeds the 10 MB limit")
            content_type = _photo_content_type(content)
            prepared.append(_PreparedPhoto(target.name, content, content_type))
        return prepared

    def _prepare_caption(self, text: str) -> tuple[str, str, str | None]:
        if _should_render_markdown_as_html(self.parse_mode):
            caption = _markdown_to_telegram_html(text)
            fallback = _markdown_to_plain_text(text)
            # 按 UTF-16 保守计数，HTML 源码与降级文本都需可完整放入 caption。
            if max(_utf16_length(caption), _utf16_length(fallback)) <= TELEGRAM_CAPTION_LIMIT:
                return caption, "HTML", fallback
        elif _utf16_length(text) <= TELEGRAM_CAPTION_LIMIT:
            return text, _telegram_parse_mode(self.parse_mode), None
        return "", "", None

    def _send_text(self, text: str) -> list[dict[str, Any]]:
        render_html = _should_render_markdown_as_html(self.parse_mode)
        limit = TELEGRAM_FORMATTED_SOURCE_LIMIT if render_html else TELEGRAM_MESSAGE_LIMIT
        chunks = _chunk_message(text, limit=limit)

        responses = []
        for chunk in chunks:
            if render_html:
                rendered = _markdown_to_telegram_html(chunk)
                if _utf16_length(rendered) > TELEGRAM_MESSAGE_LIMIT:
                    for sub_chunk in _chunk_message(
                        chunk, limit=TELEGRAM_FORMATTED_RETRY_SOURCE_LIMIT
                    ):
                        responses.append(
                            self._send_chunk(
                                _markdown_to_telegram_html(sub_chunk),
                                parse_mode="HTML",
                                fallback_text=_markdown_to_plain_text(sub_chunk),
                            )
                        )
                else:
                    responses.append(
                        self._send_chunk(
                            rendered,
                            parse_mode="HTML",
                            fallback_text=_markdown_to_plain_text(chunk),
                        )
                    )
            else:
                responses.append(
                    self._send_chunk(chunk, parse_mode=_telegram_parse_mode(self.parse_mode))
                )
        return responses

    def _send_chunk(
        self, text: str, parse_mode: str = "", fallback_text: str | None = None
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "chat_id": self.chat_id,
            "text": text,
            "disable_web_page_preview": True,
        }
        if parse_mode:
            payload["parse_mode"] = parse_mode

        fallback_payload = dict(payload)
        fallback_payload.pop("parse_mode", None)
        if fallback_text is not None:
            fallback_payload["text"] = fallback_text
        return self._post("sendMessage", payload, fallback_payload=fallback_payload)

    def _send_photo(
        self,
        photo: _PreparedPhoto,
        *,
        caption: str,
        parse_mode: str,
        fallback_caption: str | None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"chat_id": self.chat_id}
        if photo.content is None:
            payload["photo"] = photo.source
        if caption:
            payload["caption"] = caption
        if parse_mode:
            payload["parse_mode"] = parse_mode
        fallback_payload = dict(payload)
        fallback_payload.pop("parse_mode", None)
        if fallback_caption is not None:
            fallback_payload["caption"] = fallback_caption
        return self._post("sendPhoto", payload, fallback_payload=fallback_payload, photo=photo)

    def _post(
        self,
        method: str,
        payload: dict[str, Any],
        *,
        fallback_payload: dict[str, Any],
        photo: _PreparedPhoto | None = None,
    ) -> dict[str, Any]:
        url = f"{self.api_base.rstrip('/')}/bot{self.bot_token}/{method}"

        def post(client: httpx.Client, data: dict[str, Any]) -> httpx.Response:
            if photo is not None and photo.content is not None:
                return client.post(
                    url,
                    data=data,
                    files={"photo": (photo.source, photo.content, photo.content_type)},
                )
            return client.post(url, json=data)

        # 异常不能带出请求 URL；Telegram 把 bot token 放在 URL 路径里。
        try:
            with httpx.Client(timeout=self.timeout_seconds) as client:
                response = post(client, payload)
                if payload.get("parse_mode") and _should_retry_without_parse_mode(response):
                    response = post(client, fallback_payload)
        except httpx.HTTPError:
            raise RuntimeError("Telegram send failed: network request failed") from None

        if response.status_code >= 400:
            detail = self._redact_error(_telegram_error_detail(response))
            raise RuntimeError(f"Telegram send failed: HTTP {response.status_code}: {detail}")

        try:
            data = response.json()
        except ValueError:
            raise RuntimeError("Telegram send failed: invalid API response") from None
        if not isinstance(data, dict):
            raise RuntimeError("Telegram send failed: invalid API response")
        if not data.get("ok", False):
            detail = self._redact_error(str(data.get("description") or "unknown error"))
            raise RuntimeError(f"Telegram send failed: {detail}")
        return data

    def _redact_error(self, detail: str) -> str:
        detail = detail.replace(self.bot_token, "[redacted]")
        return re.sub(r"https?://[^\s<>\"']+", "[redacted URL]", detail, flags=re.IGNORECASE)


def _photo_content_type(content: bytes) -> str:
    # 以实际文件签名和基本结构判断格式，不信任后缀；APNG 不属于静态图片。
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        offset = 8
        has_header = has_data = False
        while offset + 12 <= len(content):
            length = struct.unpack_from(">I", content, offset)[0]
            kind = content[offset + 4 : offset + 8]
            end = offset + 12 + length
            if end > len(content):
                break
            chunk = content[offset + 4 : end - 4]
            crc = struct.unpack_from(">I", content, end - 4)[0]
            if zlib.crc32(chunk) != crc or kind == b"acTL":
                break
            if not has_header:
                if kind != b"IHDR" or length != 13:
                    break
                width, height = struct.unpack_from(">II", content, offset + 8)
                if not width or not height:
                    break
                has_header = True
            if kind == b"IDAT":
                has_data = True
            if kind == b"IEND":
                if length == 0 and has_data and end == len(content):
                    return "image/png"
                break
            offset = end
    elif content.startswith(b"\xff\xd8\xff") and content.endswith(b"\xff\xd9"):
        offset = 2
        has_frame = False
        while offset + 4 <= len(content):
            if content[offset] != 0xFF:
                break
            marker = content[offset + 1]
            if marker == 0xFF:
                offset += 1
                continue
            length = struct.unpack_from(">H", content, offset + 2)[0]
            end = offset + 2 + length
            if length < 2 or end > len(content):
                break
            if marker in {0xC0, 0xC1, 0xC2}:
                if length < 8:
                    break
                has_frame = True
            if marker == 0xDA and has_frame and length >= 6 and end < len(content) - 2:
                return "image/jpeg"
            offset = end
    raise ValueError("Telegram local photo must be a valid static JPEG or PNG image")


def _utf16_length(text: str) -> int:
    return len(text.encode("utf-16-le")) // 2


def _chunk_message(text: str, limit: int = TELEGRAM_MESSAGE_LIMIT) -> list[str]:
    if _utf16_length(text) <= limit:
        return [text]

    chunks: list[str] = []
    remaining = text
    while remaining:
        # emoji 等非 BMP 字符占两个 UTF-16 单元，不能按 Python 字符数直接切片。
        units = 0
        count = 0
        for char in remaining:
            units += 2 if ord(char) > 0xFFFF else 1
            if units > limit:
                break
            count += 1
        chunk = remaining[:count]
        split_at = max(chunk.rfind("\n"), chunk.rfind(" "))
        if split_at > limit * 0.6:
            chunk = remaining[:split_at]
        chunks.append(chunk)
        remaining = remaining[len(chunk) :].lstrip()
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
            output.append(
                f"<b>{html.escape(numbered_heading.group(1), quote=False)}. {_format_inline_markdown(numbered_heading.group(2))}</b>"
            )
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
    return stripped.count("|") >= 2 and (
        "---" in stripped or stripped.startswith("|") or stripped.endswith("|")
    )


def _markdown_table_to_html_lines(lines: list[str]) -> list[str]:
    rows = [_parse_markdown_table_row(line) for line in lines]
    rows = [row for row in rows if row and not _is_markdown_table_separator(row)]
    if not rows:
        return []

    header = rows[0]
    body = rows[1:]
    if not body:
        return [
            html.escape(" | ".join(_markdown_inline_to_plain(cell) for cell in header), quote=False)
        ]

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
            rendered.append(
                f"• <b>{html.escape(title, quote=False)}</b>: {html.escape(' · '.join(details), quote=False)}"
            )
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
        or "entity" in detail
        and "parse" in detail
    )
