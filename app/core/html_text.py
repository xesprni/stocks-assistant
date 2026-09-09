"""Shared HTML text extraction for news and imported knowledge."""

from html.parser import HTMLParser
from typing import ClassVar


class HTMLTextExtractor(HTMLParser):
    """Extract visible HTML text with domain-specific paragraph and title handling."""

    block_tags: ClassVar[frozenset[str]] = frozenset()
    capture_title: ClassVar[bool] = False

    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.title_parts: list[str] = []
        self._skip_depth = 0
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag in {"script", "style", "noscript", "svg"}:
            self._skip_depth += 1
            return
        if self.capture_title and tag == "title":
            self._in_title = True
        if tag in self.block_tags:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in {"script", "style", "noscript", "svg"} and self._skip_depth:
            self._skip_depth -= 1
            return
        if self.capture_title and tag == "title":
            self._in_title = False
        if tag in self.block_tags:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        text = data.strip()
        if not text:
            return
        if self._in_title:
            self.title_parts.append(text)
            return
        self.parts.append(text)
        self.parts.append(" ")

    @property
    def title(self) -> str:
        return " ".join(" ".join(self.title_parts).split())

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
