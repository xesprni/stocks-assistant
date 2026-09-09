"""Prepare a self-contained, passive document before starting the browser."""

from __future__ import annotations

import hashlib
import json
from html import escape
from html.parser import HTMLParser
from typing import Any

from app.core.rendering.layout import DEFAULT_CSS
from app.schemas.rendering import RenderSnapshot

MAX_SOURCE_BYTES = 2_000_000
MAX_OUTPUT_PIXELS = 50_000_000
MAX_LOGICAL_HEIGHT = 12_000
RENDER_ORIGIN = "https://render.invalid/"
CONTENT_SECURITY_POLICY = (
    "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; "
    "img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; "
    "object-src 'none'; base-uri 'none'; form-action 'none'; "
    "frame-ancestors 'none'"
)


class _PassiveFragment(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.elements = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        # 模型只负责静态排版与 SVG；不把任意脚本、嵌套页面或外部资源变成后端执行能力。
        if tag in {
            "script",
            "iframe",
            "frame",
            "frameset",
            "object",
            "embed",
            "link",
            "meta",
            "base",
            "form",
            "input",
            "button",
            "textarea",
            "select",
            "video",
            "audio",
            "source",
            "canvas",
            "animate",
            "animatetransform",
            "animatemotion",
            "set",
            "foreignobject",
            "html",
            "head",
            "body",
        }:
            raise ValueError(f"Unsupported <{tag}>; provide a static HTML fragment with inline SVG")
        self.elements += 1
        if self.elements > 5000:
            raise ValueError("HTML exceeds the 5000 element limit; simplify or split the report")
        for name, value in attrs:
            if name.startswith("on") or name in {"srcdoc", "srcset", "ping"}:
                raise ValueError(f"Unsupported active HTML attribute: {name}")
            if name in {"src", "href", "xlink:href"} and value:
                target = value.strip().lower()
                if not target.startswith(
                    (
                        "#",
                        "data:image/png;base64,",
                        "data:image/jpeg;base64,",
                        "data:image/webp;base64,",
                    )
                ):
                    raise ValueError(
                        "Resources must be inline PNG/JPEG/WebP data or SVG #references"
                    )

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)


def canonical_json(value: Any) -> str:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, allow_nan=False, separators=(",", ":")
    )


def prepare_document(fragment: str, snapshot: RenderSnapshot | None) -> tuple[str, str | None]:
    if not fragment.strip() or len(fragment.encode("utf-8")) > MAX_SOURCE_BYTES:
        raise ValueError("HTML must be non-empty and no larger than 2 MB (UTF-8)")
    parser = _PassiveFragment()
    parser.feed(fragment)
    parser.close()
    snapshot_hash = None
    footer = ""
    if snapshot is not None:
        serialized = canonical_json(snapshot.model_dump())
        if len(serialized.encode("utf-8")) > MAX_SOURCE_BYTES:
            raise ValueError("snapshot exceeds the 2 MB limit")
        snapshot_hash = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
        footer = (
            '<footer class="source" data-report-source="true">'
            f"<p>数据时间：{escape(snapshot.as_of)}</p>"
            + "".join(f"<p>来源：{escape(source)}</p>" for source in snapshot.sources)
            + "</footer>"
        )
    document = (
        '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
        f'<meta http-equiv="Content-Security-Policy" content="{escape(CONTENT_SECURITY_POLICY, quote=True)}">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<style>{DEFAULT_CSS}</style></head><body>{fragment}{footer}</body></html>"
    )
    return document, snapshot_hash
