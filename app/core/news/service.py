"""Longbridge content/news and Guardian RSS/Open Platform service."""

from __future__ import annotations

import html
from datetime import datetime
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from typing import Any, Optional
from urllib.parse import urlparse, urlunparse
from xml.etree import ElementTree as ET

import httpx

from app.core.agent.models import LLMRequest
from app.config import get_settings
from app.core.watchlist.service import LongbridgeUnavailableError

GUARDIAN_ALLOWED_HOSTS = {"theguardian.com", "www.theguardian.com"}
GUARDIAN_CONTENT_API_BASE = "https://content.guardianapis.com"
GUARDIAN_MAX_TRANSLATE_CHARS = 30_000
GUARDIAN_USER_AGENT = "stocks-assistant/guardian-news"


class GuardianConfigError(ValueError):
    """Guardian feature is unavailable until required user configuration exists."""


class GuardianUpstreamError(RuntimeError):
    """Guardian RSS/Open Platform request failed upstream."""


class GuardianTranslationError(RuntimeError):
    """LLM translation failed or returned no usable output."""


class _HTMLTextExtractor(HTMLParser):
    """Small stdlib HTML-to-text extractor for Guardian summaries and article body."""

    block_tags = {
        "article",
        "blockquote",
        "br",
        "div",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "li",
        "p",
        "section",
    }

    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs) -> None:
        tag = tag.lower()
        if tag in {"script", "style", "noscript", "svg"}:
            self._skip_depth += 1
            return
        if tag in self.block_tags:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in {"script", "style", "noscript", "svg"} and self._skip_depth:
            self._skip_depth -= 1
            return
        if tag in self.block_tags:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        text = data.strip()
        if text:
            self.parts.append(text)
            self.parts.append(" ")

    @property
    def text(self) -> str:
        raw = "".join(self.parts)
        lines = [" ".join(line.split()) for line in raw.splitlines()]
        compact: list[str] = []
        blank = False
        for line in lines:
            if line:
                compact.append(line)
                blank = False
            elif not blank and compact:
                compact.append("")
                blank = True
        return "\n".join(compact).strip()


def normalize_news_symbol(symbol: str) -> str:
    value = str(symbol or "").strip().upper()
    if not value:
        raise ValueError("Symbol is required")
    if "." in value:
        return value
    if value.isdigit():
        if len(value) >= 6:
            suffix = "SH" if value.startswith(("5", "6", "9")) else "SZ"
            return f"{value}.{suffix}"
        return f"{value.lstrip('0') or '0'}.HK"
    return f"{value}.US"


def normalize_guardian_feed_url(url: str) -> str:
    raw = str(url or "").strip()
    if not raw:
        raise ValueError("Guardian URL is required")
    if "://" not in raw:
        raw = f"https://{raw}"

    parsed = urlparse(raw)
    _validate_guardian_url(parsed)
    path = (parsed.path or "").rstrip("/")
    if not path:
        path = "/rss"
    elif not path.lower().endswith("/rss"):
        path = f"{path}/rss"
    return urlunparse(("https", "www.theguardian.com", path, "", "", ""))


def normalize_guardian_article_url(url: str) -> tuple[str, str]:
    raw = str(url or "").strip()
    if not raw:
        raise ValueError("Guardian article URL is required")
    if "://" not in raw:
        raw = f"https://{raw}"

    parsed = urlparse(raw)
    _validate_guardian_url(parsed)
    path = (parsed.path or "").strip("/")
    if not path or path.lower().endswith("/rss"):
        raise ValueError("Guardian article URL is required")
    web_url = urlunparse(("https", "www.theguardian.com", f"/{path}", "", "", ""))
    return web_url, path


def _validate_guardian_url(parsed) -> None:
    host = (parsed.hostname or "").lower()
    if parsed.scheme not in {"http", "https"} or host not in GUARDIAN_ALLOWED_HOSTS:
        raise ValueError("Only theguardian.com URLs are supported")


def _to_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _published_at_iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value).isoformat()
    return str(value)


def _published_at_ts(value: Any) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return int(value.timestamp())
    if isinstance(value, (int, float)):
        return int(value)
    return None


def _published_iso_and_ts(value: Any) -> tuple[Optional[str], Optional[int]]:
    if value is None:
        return None, None
    if isinstance(value, datetime):
        return value.isoformat(), int(value.timestamp())
    if isinstance(value, (int, float)):
        dt = datetime.fromtimestamp(value)
        return dt.isoformat(), int(value)
    text = str(value).strip()
    if not text:
        return None, None
    try:
        dt = parsedate_to_datetime(text)
    except (TypeError, ValueError):
        try:
            dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return text, None
    return dt.isoformat(), int(dt.timestamp())


def _html_to_text(value: Any) -> str:
    text = str(value or "").replace("\x00", "").strip()
    if not text:
        return ""
    if "<" not in text and ">" not in text:
        return " ".join(html.unescape(text).split())
    extractor = _HTMLTextExtractor()
    try:
        extractor.feed(text)
    except Exception:
        return " ".join(html.unescape(text).split())
    return extractor.text or " ".join(html.unescape(text).split())


def _xml_local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def _xml_child_text(element: ET.Element, *names: str) -> str:
    wanted = {name.lower() for name in names}
    for child in list(element):
        if _xml_local_name(child.tag) in wanted:
            return "".join(child.itertext()).strip()
    return ""


def _xml_child_texts(element: ET.Element, *names: str) -> list[str]:
    wanted = {name.lower() for name in names}
    values: list[str] = []
    for child in list(element):
        if _xml_local_name(child.tag) in wanted:
            text = "".join(child.itertext()).strip()
            if text:
                values.append(html.unescape(text))
    return values


def _extract_llm_response_text(response: Any) -> str:
    if not response:
        return ""
    if isinstance(response, dict):
        if response.get("error"):
            return ""
        content = response.get("content")
        if isinstance(content, list):
            parts = [
                str(block.get("text") or "")
                for block in content
                if isinstance(block, dict) and block.get("type") == "text"
            ]
            return "\n".join(part for part in parts if part).strip()
        choices = response.get("choices") or []
        if choices:
            message = choices[0].get("message") or {}
            content = message.get("content") or ""
            if isinstance(content, str):
                return content.strip()
            if isinstance(content, list):
                parts = [
                    str(block.get("text") or "")
                    for block in content
                    if isinstance(block, dict) and block.get("type") == "text"
                ]
                return "\n".join(part for part in parts if part).strip()
    if hasattr(response, "choices") and response.choices:
        return (response.choices[0].message.content or "").strip()
    return ""


def _news_item_to_dict(item: Any) -> dict[str, Any]:
    published_at = getattr(item, "published_at", None)
    return {
        "id": str(getattr(item, "id", "") or ""),
        "title": str(getattr(item, "title", "") or ""),
        "description": str(getattr(item, "description", "") or ""),
        "url": str(getattr(item, "url", "") or ""),
        "published_at": _published_at_iso(published_at),
        "published_at_ts": _published_at_ts(published_at),
        "likes_count": _to_int(getattr(item, "likes_count", None)),
        "comments_count": _to_int(getattr(item, "comments_count", None)),
        "shares_count": _to_int(getattr(item, "shares_count", None)),
    }


class NewsService:
    """Fetch symbol news and Guardian public/newswire content."""

    def get_security_news(self, symbol: str, limit: int = 50, settings: Any = None) -> dict[str, Any]:
        normalized_symbol = normalize_news_symbol(symbol)
        ctx = self._content_context(settings=settings)
        try:
            raw_items = list(ctx.news(normalized_symbol))
        except Exception as exc:
            raise LongbridgeUnavailableError(str(exc)) from exc

        items = [_news_item_to_dict(item) for item in raw_items]
        items.sort(key=lambda item: item.get("published_at_ts") or 0, reverse=True)
        items = items[:limit]
        return {"symbol": normalized_symbol, "news": items, "total": len(items)}

    def get_guardian_feed(self, url: str, limit: int = 30) -> dict[str, Any]:
        feed_url = normalize_guardian_feed_url(url)
        xml_text = self._fetch_guardian_rss(feed_url)
        try:
            root = ET.fromstring(xml_text)
        except ET.ParseError as exc:
            raise GuardianUpstreamError("Guardian RSS response was not valid XML") from exc
        channel = next((node for node in root.iter() if _xml_local_name(node.tag) == "channel"), root)
        feed_title = _xml_child_text(channel, "title")
        items = [
            self._guardian_rss_item_to_dict(item)
            for item in channel.iter()
            if _xml_local_name(item.tag) == "item"
        ]
        items.sort(key=lambda item: item.get("published_at_ts") or 0, reverse=True)
        items = items[:limit]
        return {"url": url, "feed_url": feed_url, "title": feed_title, "items": items, "total": len(items)}

    def get_guardian_article(self, url: str, settings: Any = None) -> dict[str, Any]:
        settings = settings or get_settings()
        api_key = str(getattr(settings, "guardian_api_key", "") or "").strip()
        if not api_key:
            raise GuardianConfigError("Guardian API key is not configured. Add it to Settings > Data Sources.")

        web_url, path = normalize_guardian_article_url(url)
        api_url = f"{GUARDIAN_CONTENT_API_BASE}/{path}"
        params = {
            "api-key": api_key,
            "show-fields": "body,headline,trailText,byline,thumbnail,shortUrl",
        }
        # Guardian 正文只能通过 Open Platform API 获取；密钥只在后端请求中使用，不返回给前端。
        with httpx.Client(timeout=20.0, follow_redirects=True) as client:
            try:
                response = client.get(api_url, params=params, headers={"User-Agent": GUARDIAN_USER_AGENT})
                if response.status_code in {401, 403}:
                    raise GuardianConfigError("Guardian API key was rejected by Guardian Open Platform")
                response.raise_for_status()
            except GuardianConfigError:
                raise
            except httpx.HTTPError as exc:
                raise GuardianUpstreamError(f"Guardian article request failed: {exc}") from exc

        try:
            payload = response.json()
        except ValueError as exc:
            raise GuardianUpstreamError("Guardian article response was not valid JSON") from exc

        content = (payload.get("response") or {}).get("content") or {}
        if not content:
            raise GuardianUpstreamError("Guardian article was not found")
        fields = content.get("fields") or {}
        body_html = str(fields.get("body") or "")
        published_at, published_at_ts = _published_iso_and_ts(content.get("webPublicationDate"))
        return {
            "id": str(content.get("id") or path),
            "title": str(fields.get("headline") or content.get("webTitle") or ""),
            "description": _html_to_text(fields.get("trailText") or ""),
            "url": str(content.get("webUrl") or web_url),
            "api_url": str(content.get("apiUrl") or api_url),
            "published_at": published_at,
            "published_at_ts": published_at_ts,
            "author": str(fields.get("byline") or ""),
            "thumbnail": str(fields.get("thumbnail") or ""),
            "body_html": body_html,
            "body_text": _html_to_text(body_html),
        }

    def translate_guardian_text(self, text: str, llm_provider: Any, target_language: str = "zh-CN") -> dict[str, Any]:
        source_text = str(text or "").strip()
        if not source_text:
            raise ValueError("Text is required")
        if len(source_text) > GUARDIAN_MAX_TRANSLATE_CHARS:
            raise ValueError(f"Text is too long; limit is {GUARDIAN_MAX_TRANSLATE_CHARS} characters")
        if not llm_provider:
            raise GuardianTranslationError("LLM provider is not available")

        normalized_target = str(target_language or "zh-CN").strip() or "zh-CN"
        # 翻译保持忠实直译，不要求模型做摘要或投资观点，避免新闻内容被改写。
        request = LLMRequest(
            messages=[
                {
                    "role": "user",
                    "content": (
                        f"Translate the following Guardian news article into {normalized_target}. "
                        "Preserve paragraph breaks, names, numbers, dates, and quoted speech. "
                        "Return only the translated article text.\n\n"
                        f"{source_text}"
                    ),
                }
            ],
            temperature=0,
            stream=False,
            system="You are a professional news translator. Translate faithfully without adding commentary.",
        )
        try:
            response = llm_provider.call(request)
        except Exception as exc:
            raise GuardianTranslationError(str(exc)) from exc
        translation = _extract_llm_response_text(response)
        if not translation:
            raise GuardianTranslationError("LLM returned an empty translation")
        return {
            "target_language": normalized_target,
            "translation": translation,
            "source_length": len(source_text),
            "model": str(getattr(llm_provider, "model", "") or ""),
        }

    def _fetch_guardian_rss(self, feed_url: str) -> str:
        with httpx.Client(timeout=20.0, follow_redirects=True) as client:
            try:
                response = client.get(feed_url, headers={"User-Agent": GUARDIAN_USER_AGENT})
                response.raise_for_status()
            except httpx.HTTPError as exc:
                raise GuardianUpstreamError(f"Guardian RSS request failed: {exc}") from exc
        return response.text

    def _guardian_rss_item_to_dict(self, item: ET.Element) -> dict[str, Any]:
        title = html.unescape(_xml_child_text(item, "title"))
        link = _xml_child_text(item, "link")
        guid = _xml_child_text(item, "guid")
        description = _html_to_text(_xml_child_text(item, "description"))
        published_at, published_at_ts = _published_iso_and_ts(
            _xml_child_text(item, "pubDate", "date", "updated", "published")
        )
        author = html.unescape(_xml_child_text(item, "creator", "author"))
        categories = _xml_child_texts(item, "category")
        return {
            "id": guid or link or title,
            "title": title,
            "description": description,
            "url": link,
            "published_at": published_at,
            "published_at_ts": published_at_ts,
            "author": author,
            "categories": categories,
        }

    def _content_context(self, settings: Any = None):
        from app.core.market.longbridge_context import get_cached_context

        return get_cached_context("ContentContext", settings=settings)
