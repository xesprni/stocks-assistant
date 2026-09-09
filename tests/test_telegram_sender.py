"""Telegram delivery uses HTTP doubles and isolated workspace attachments."""

import base64
import os
import struct
import zlib
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import httpx
import pytest

from app.core.notifications.telegram import (
    TELEGRAM_PHOTO_MAX_BYTES,
    TelegramConfigError,
    TelegramSender,
)


def _png_chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


PNG = (
    b"\x89PNG\r\n\x1a\n"
    + _png_chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    + _png_chunk(b"IDAT", zlib.compress(b"\x00\xff\xff\xff"))
    + _png_chunk(b"IEND", b"")
)
JPEG = base64.b64decode(
    "/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6AB"
    "AAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklN"
    "BAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8A"
    "AAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFB"
    "BhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldY"
    "WVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfI"
    "ycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYH"
    "CAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy"
    "0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWG"
    "h4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz"
    "9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwM"
    "DA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ"
    "EBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A/fyiiigD/9k="
)


@pytest.fixture
def http_client(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    client = MagicMock()
    client.__enter__.return_value = client
    client.post.return_value = httpx.Response(200, json={"ok": True, "result": {"message_id": 1}})
    monkeypatch.setattr("app.core.notifications.telegram.httpx.Client", lambda **kwargs: client)
    return client


@pytest.fixture
def sender(tmp_path: Path) -> TelegramSender:
    return TelegramSender(True, "test-secret-token", "42", workspace_dir=str(tmp_path))


def test_photo_url_uses_caption_and_original_text_path_stays_compatible(
    sender: TelegramSender, http_client: MagicMock
) -> None:
    result = sender.send_photo("https://example.org/chart.png", "**行情**")
    assert result["chunks"] == result["photos"] == 1
    assert http_client.post.call_args.args[0].endswith("/sendPhoto")
    assert http_client.post.call_args.kwargs == {
        "json": {
            "chat_id": "42",
            "photo": "https://example.org/chart.png",
            "caption": "<b>行情</b>",
            "parse_mode": "HTML",
        }
    }
    result = sender.send_message("**报告**")
    assert result["chunks"] == 1 and result["photos"] == 0
    assert http_client.post.call_args.args[0].endswith("/sendMessage")
    assert http_client.post.call_args.kwargs["json"]["text"] == "<b>报告</b>"


@pytest.mark.parametrize("absolute", [False, True])
@pytest.mark.parametrize(
    ("content", "mime"), [(PNG, "image/png"), (JPEG, "image/jpeg")], ids=["PNG", "JPEG"]
)
def test_local_photo_upload_uses_file_signature(
    sender: TelegramSender,
    http_client: MagicMock,
    tmp_path: Path,
    absolute: bool,
    content: bytes,
    mime: str,
) -> None:
    photo = tmp_path / "chart.bin"
    photo.write_bytes(content)
    result = sender.send_photo(str(photo) if absolute else "chart.bin")
    assert result["photos"] == 1
    assert http_client.post.call_args.kwargs == {
        "data": {"chat_id": "42"},
        "files": {"photo": ("chart.bin", content, mime)},
    }


def test_multiple_photos_share_only_first_caption(
    sender: TelegramSender, http_client: MagicMock, tmp_path: Path
) -> None:
    (tmp_path / "chart.png").write_bytes(PNG)
    result = sender.send_message("报告", photos=["chart.png", "https://example.org/next.png"])
    calls = http_client.post.call_args_list
    assert result["chunks"] == result["photos"] == 2
    assert calls[0].kwargs["data"]["caption"] == "报告"
    assert "caption" not in calls[1].kwargs["json"]


@pytest.mark.parametrize("text", ["字" * 1025, "😀" * 513, "&" * 300])
def test_long_caption_preserves_full_text_outside_photo(
    sender: TelegramSender, http_client: MagicMock, text: str
) -> None:
    result = sender.send_photo("https://example.org/chart.png", text)
    calls = http_client.post.call_args_list
    assert result["chunks"] == 2 and result["photos"] == 1
    assert calls[0].args[0].endswith("/sendMessage")
    assert calls[1].args[0].endswith("/sendPhoto")
    assert "caption" not in calls[1].kwargs["json"]
    assert calls[0].kwargs["json"]["text"] == text.replace("&", "&amp;")


def test_long_unicode_caption_is_split_within_message_limit(
    sender: TelegramSender, http_client: MagicMock
) -> None:
    text = "😀" * 5000
    result = sender.send_photo("https://example.org/chart.png", text)
    messages = [call.kwargs["json"]["text"] for call in http_client.post.call_args_list[:-1]]
    assert "".join(messages) == text
    assert all(len(message.encode("utf-16-le")) // 2 <= 4096 for message in messages)
    assert result["chunks"] == len(messages) + 1


@pytest.mark.parametrize("local", [False, True])
def test_caption_parse_failure_retries_plain_text_with_same_photo(
    sender: TelegramSender, http_client: MagicMock, tmp_path: Path, local: bool
) -> None:
    photo = "https://example.org/chart.png"
    if local:
        (tmp_path / "chart.png").write_bytes(PNG)
        photo = "chart.png"
    http_client.post.side_effect = [
        httpx.Response(400, json={"ok": False, "description": "Bad Request: can't parse entities"}),
        httpx.Response(200, json={"ok": True}),
    ]
    result = sender.send_photo(photo, "**报告**")
    assert result["chunks"] == 1
    first, second = http_client.post.call_args_list
    payload_key = "data" if local else "json"
    assert first.kwargs[payload_key]["parse_mode"] == "HTML"
    assert "parse_mode" not in second.kwargs[payload_key]
    assert second.kwargs[payload_key]["caption"] == "报告"
    if local:
        assert first.kwargs["files"] == second.kwargs["files"]


@pytest.mark.parametrize("kind", ["parent", "absolute", "symlink", "directory", "fifo", "missing"])
def test_local_file_boundaries_before_any_delivery(
    sender: TelegramSender, http_client: MagicMock, tmp_path: Path, kind: str
) -> None:
    (tmp_path / "valid.png").write_bytes(PNG)
    outside = tmp_path.parent / "outside.png"
    outside.write_bytes(PNG)
    source = {
        "parent": "../outside.png",
        "absolute": str(outside),
        "symlink": "escape.png",
        "directory": ".",
        "fifo": "pipe.png",
        "missing": "missing.png",
    }[kind]
    if kind == "symlink":
        (tmp_path / source).symlink_to(outside)
    if kind == "fifo":
        os.mkfifo(tmp_path / source)
    with pytest.raises(ValueError):
        sender.send_message("文字" * 1200, photos=["valid.png", source])
    http_client.post.assert_not_called()


@pytest.mark.parametrize(
    "content",
    [
        b"not an image",
        b"GIF89a",
        b"\xff\xd8\xff\xd9",
        PNG[:-1],
        PNG[:33] + _png_chunk(b"acTL", struct.pack(">II", 1, 0)) + PNG[33:],
    ],
)
def test_invalid_or_animated_files_are_rejected(
    sender: TelegramSender, http_client: MagicMock, tmp_path: Path, content: bytes
) -> None:
    (tmp_path / "fake.png").write_bytes(content)
    with pytest.raises(ValueError, match="static JPEG or PNG"):
        sender.send_photo("fake.png")
    http_client.post.assert_not_called()


def test_oversized_photo_rejected(
    sender: TelegramSender, http_client: MagicMock, tmp_path: Path
) -> None:
    photo = tmp_path / "large.png"
    with photo.open("wb") as file:
        file.write(PNG)
        file.truncate(TELEGRAM_PHOTO_MAX_BYTES + 1)
    with pytest.raises(ValueError, match="10 MB"):
        sender.send_photo("large.png")
    http_client.post.assert_not_called()


@pytest.mark.parametrize(
    "photos",
    [
        "https://example.org/chart.png",
        [" "],
        ["file:///tmp/photo.png"],
        ["https:///photo.png"],
        ["https://secret@example.org/photo.png"],
        ["https://example.org/a\nb.png"],
        ["https://example.org/chart.png"] * 11,
    ],
)
def test_bad_photo_parameters_rejected(
    sender: TelegramSender, http_client: MagicMock, photos: list[str]
) -> None:
    with pytest.raises(ValueError):
        sender.send_message("报告", photos=photos)
    http_client.post.assert_not_called()


def test_local_photos_require_explicit_user_workspace(
    http_client: MagicMock, tmp_path: Path
) -> None:
    settings = SimpleNamespace(
        telegram_enabled=True,
        telegram_bot_token="token",
        telegram_chat_id="42",
        workspace_dir=str(tmp_path),
    )
    sender = TelegramSender.from_settings(settings)
    assert sender.workspace_dir is None
    with pytest.raises(ValueError, match="user workspace"):
        sender.send_photo("chart.png")
    assert TelegramSender.from_settings(settings, workspace_dir=str(tmp_path)).workspace_dir == str(
        tmp_path
    )
    http_client.post.assert_not_called()


@pytest.mark.parametrize("photo", [False, True])
def test_network_failure_does_not_expose_token_or_url(
    sender: TelegramSender, http_client: MagicMock, photo: bool
) -> None:
    url = f"https://api.telegram.org/bot{sender.bot_token}/sendPhoto"
    http_client.post.side_effect = httpx.ConnectError(f"Network failed: {url}")
    with pytest.raises(RuntimeError) as error:
        if photo:
            sender.send_photo("https://example.org/chart.png")
        else:
            sender.send_message("报告")
    assert sender.bot_token not in str(error.value)
    assert "https://" not in str(error.value)
    assert error.value.__suppress_context__


@pytest.mark.parametrize("status", [200, 400])
def test_api_failure_redacts_sensitive_detail(
    sender: TelegramSender, http_client: MagicMock, status: int
) -> None:
    http_client.post.return_value = httpx.Response(
        status,
        json={
            "ok": False,
            "description": f"Failure {sender.bot_token}: https://example.org/private?secret=123",
        },
    )
    with pytest.raises(RuntimeError) as error:
        sender.send_photo("https://example.org/chart.png")
    assert sender.bot_token not in str(error.value)
    assert "https://" not in str(error.value)
    assert "secret=123" not in str(error.value)
    assert http_client.post.call_count == 1


def test_disabled_and_missing_config_avoid_delivery(
    sender: TelegramSender, http_client: MagicMock
) -> None:
    sender.enabled = False
    assert sender.send_photo("https://example.org/chart.png")["skipped"] is True
    sender.enabled = True
    sender.bot_token = ""
    with pytest.raises(TelegramConfigError):
        sender.send_photo("https://example.org/chart.png")
    http_client.post.assert_not_called()


def test_markdown_image_syntax_does_not_trigger_implicit_photo_upload(
    sender: TelegramSender, http_client: MagicMock
) -> None:
    result = sender.send_message("![chart](https://example.org/chart.png)")
    assert result["photos"] == 0
    assert http_client.post.call_args.args[0].endswith("/sendMessage")
