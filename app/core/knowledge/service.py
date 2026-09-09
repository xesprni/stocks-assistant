"""知识库服务

基于 Markdown 文件的个人知识库，提供：
- 目录树浏览
- 文件内容读取
- 文件/URL 保存
- 知识图谱构建（基于 Markdown 内部链接）

知识库目录结构：workspace/knowledge/**/*.md
"""

import logging
import os
import re
from pathlib import Path
from urllib.parse import unquote, urlparse

import httpx

from app.core.html_text import HTMLTextExtractor

logger = logging.getLogger("stocks-assistant.knowledge")

MAX_KNOWLEDGE_CHARS = 2_000_000
MAX_URL_BYTES = 5_000_000
TEXT_EXTENSIONS = {".md", ".markdown", ".txt", ".csv", ".json", ".log", ".html", ".htm"}


class _HTMLTextExtractor(HTMLTextExtractor):
    block_tags = frozenset(
        [
            "article",
            "aside",
            "blockquote",
            "br",
            "div",
            "footer",
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "header",
            "li",
            "main",
            "p",
            "pre",
            "section",
            "table",
            "tr",
        ]
    )
    capture_title = True


class KnowledgeService:
    """知识库服务

    管理 workspace/knowledge/ 目录下的 Markdown 知识文件。
    """

    def __init__(self, workspace_root: str):
        self.workspace_root = workspace_root
        self.knowledge_dir = os.path.join(workspace_root, "knowledge")
        self.knowledge_path = Path(self.knowledge_dir).resolve()

    def list_tree(self) -> dict:
        """获取知识库目录树"""
        if not os.path.isdir(self.knowledge_dir):
            return {"tree": [], "stats": {"pages": 0, "size": 0}, "enabled": True}
        stats = {"pages": 0, "size": 0}
        root_files, tree = self._scan_dir(self.knowledge_dir, stats, is_root=True)
        return {"root_files": root_files, "tree": tree, "stats": stats, "enabled": True}

    def _scan_dir(self, dir_path: str, stats: dict, is_root: bool = False) -> tuple:
        """递归扫描目录，返回文件列表和子目录树"""
        files, children = [], []
        for name in sorted(os.listdir(dir_path)):
            if name.startswith("."):
                continue
            full = os.path.join(dir_path, name)
            if os.path.isdir(full):
                sub_files, sub_children = self._scan_dir(full, stats)
                children.append({"dir": name, "files": sub_files, "children": sub_children})
            elif name.endswith(".md"):
                size = os.path.getsize(full)
                stats["pages"] += 1
                stats["size"] += size
                title = name.replace(".md", "")
                try:
                    with open(full, encoding="utf-8") as f:
                        first_line = f.readline().strip()
                    if first_line.startswith("# "):
                        title = first_line[2:].strip()
                except Exception:
                    pass
                files.append({"name": name, "title": title, "size": size})
        return files, children

    def read_file(self, rel_path: str) -> dict:
        """读取知识文件内容（含路径安全检查）"""
        if not rel_path or ".." in rel_path:
            raise ValueError("invalid path")
        full_path = os.path.normpath(os.path.join(self.knowledge_dir, rel_path))
        allowed = os.path.normpath(self.knowledge_dir)
        if not full_path.startswith(allowed + os.sep) and full_path != allowed:
            raise ValueError("path outside knowledge dir")
        if not os.path.isfile(full_path):
            raise FileNotFoundError(f"file not found: {rel_path}")
        with open(full_path, encoding="utf-8") as f:
            content = f.read()
        return {"content": content, "path": rel_path}

    def save_text_file(
        self,
        filename: str,
        content: str,
        directory: str | None = None,
        *,
        source_url: str | None = None,
    ) -> dict:
        """Save user-provided text as a Markdown knowledge file."""
        if not isinstance(content, str) or not content.strip():
            raise ValueError("content is required")
        if len(content) > MAX_KNOWLEDGE_CHARS:
            raise ValueError(f"content is too large; limit is {MAX_KNOWLEDGE_CHARS} characters")

        safe_name = self._markdown_filename(filename)
        rel_dir = self._safe_directory(directory)
        rel_path = "/".join([p for p in [rel_dir, safe_name] if p])
        full_path = self._unique_path(self._resolve_path(rel_path))
        rel_saved = full_path.relative_to(self.knowledge_path).as_posix()

        title = Path(safe_name).stem.replace("-", " ").replace("_", " ").strip() or "Knowledge"
        document = self._format_markdown_document(
            title=title, content=content, source_url=source_url
        )
        full_path.parent.mkdir(parents=True, exist_ok=True)
        full_path.write_text(document, encoding="utf-8")

        size = full_path.stat().st_size
        logger.info("Saved knowledge file: %s", rel_saved)
        return {"status": "ok", "path": rel_saved, "size": size, "source": source_url}

    def save_url(self, url: str, filename: str | None = None, directory: str | None = None) -> dict:
        """Fetch an HTTP(S) URL and save its readable content as Markdown."""
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("url must be an absolute http(s) URL")

        content_type, raw, final_url = self._fetch_url(url)
        charset = self._charset_from_content_type(content_type) or "utf-8"
        text = raw.decode(charset, errors="replace").replace("\x00", "")
        if len(text) > MAX_KNOWLEDGE_CHARS:
            text = text[:MAX_KNOWLEDGE_CHARS] + "\n\n[Content truncated while importing URL.]"

        final_parsed = urlparse(final_url)
        ext = Path(final_parsed.path).suffix.lower()
        title = ""
        if "html" in content_type.lower() or ext in {".html", ".htm", ""}:
            extractor = _HTMLTextExtractor()
            extractor.feed(text)
            title = extractor.title
            text = extractor.text or text

        target_name = filename or self._filename_from_url(final_url, title)
        return self.save_text_file(target_name, text, directory, source_url=final_url)

    def _fetch_url(self, url: str) -> tuple[str, bytes, str]:
        with httpx.Client(timeout=20.0, follow_redirects=True) as client:
            try:
                with client.stream(
                    "GET", url, headers={"User-Agent": "stocks-assistant/knowledge-import"}
                ) as response:
                    response.raise_for_status()
                    chunks: list[bytes] = []
                    total = 0
                    for chunk in response.iter_bytes():
                        total += len(chunk)
                        if total > MAX_URL_BYTES:
                            raise ValueError(
                                f"url content is too large; limit is {MAX_URL_BYTES} bytes"
                            )
                        chunks.append(chunk)
                    return (
                        response.headers.get("content-type", ""),
                        b"".join(chunks),
                        str(response.url),
                    )
            except httpx.HTTPError as exc:
                raise ValueError(f"failed to fetch url: {exc}") from exc

    def _resolve_path(self, rel_path: str) -> Path:
        rel_path = rel_path.replace("\\", "/").strip().lstrip("/")
        path = Path(rel_path)
        if not rel_path or any(part in {"", ".", ".."} for part in path.parts):
            raise ValueError("invalid path")
        if path.suffix.lower() != ".md":
            raise ValueError("knowledge files must be saved as .md")
        self.knowledge_path.mkdir(parents=True, exist_ok=True)
        full_path = (self.knowledge_path / path).resolve()
        if os.path.commonpath([str(self.knowledge_path.resolve()), str(full_path)]) != str(
            self.knowledge_path.resolve()
        ):
            raise ValueError("path outside knowledge dir")
        return full_path

    def _unique_path(self, full_path: Path) -> Path:
        if not full_path.exists():
            return full_path
        stem = full_path.stem
        suffix = full_path.suffix
        parent = full_path.parent
        for idx in range(2, 10_000):
            candidate = parent / f"{stem}-{idx}{suffix}"
            if not candidate.exists():
                return candidate
        raise ValueError("unable to allocate a unique filename")

    def _safe_directory(self, directory: str | None) -> str:
        if not directory:
            return ""
        parts = []
        for raw_part in directory.replace("\\", "/").split("/"):
            part = self._safe_name(raw_part)
            if part:
                parts.append(part)
        return "/".join(parts)

    def _markdown_filename(self, filename: str) -> str:
        raw = Path(filename or "knowledge.md").name.strip()
        stem = self._safe_name(Path(raw).stem) or "knowledge"
        suffix = Path(raw).suffix.lower()
        if suffix and suffix not in TEXT_EXTENSIONS:
            raise ValueError(f"unsupported file type: {suffix}")
        return f"{stem}.md"

    def _filename_from_url(self, url: str, title: str = "") -> str:
        parsed = urlparse(url)
        name = unquote(Path(parsed.path).name or "").strip()
        if name:
            return name
        if title:
            return f"{title}.md"
        return f"{parsed.netloc}.md"

    def _safe_name(self, value: str) -> str:
        normalized = re.sub(r"\s+", "-", value.strip())
        normalized = re.sub(r"[^\w.\-]+", "-", normalized, flags=re.UNICODE)
        normalized = normalized.strip(".-")
        return normalized[:120]

    def _format_markdown_document(self, title: str, content: str, source_url: str | None) -> str:
        body = content.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "").strip()
        prefix = ""
        if not body.lstrip().startswith("#"):
            prefix = f"# {title}\n\n"
        if source_url:
            source_block = f"> Source: {source_url}\n\n"
            if prefix:
                return f"{prefix}{source_block}{body}\n"
            return f"{source_block}{body}\n"
        return f"{prefix}{body}\n"

    def _charset_from_content_type(self, content_type: str) -> str | None:
        match = re.search(r"charset=([^;\s]+)", content_type, flags=re.IGNORECASE)
        return match.group(1).strip("\"'") if match else None

    def build_graph(self) -> dict:
        """构建知识图谱（基于 Markdown 内部链接 [[target]] 或 [text](target.md)）"""
        knowledge_path = Path(self.knowledge_dir)
        if not knowledge_path.is_dir():
            return {"nodes": [], "links": []}
        nodes, links = {}, []
        link_re = re.compile(r"\[([^\]]*)\]\(([^)]+\.md)\)")
        for md_file in knowledge_path.rglob("*.md"):
            rel = str(md_file.relative_to(knowledge_path))
            if rel in ("index.md", "log.md"):
                continue
            parts = rel.split("/")
            category = parts[0] if len(parts) > 1 else "root"
            title = md_file.stem.replace("-", " ").title()
            try:
                content = md_file.read_text(encoding="utf-8")
                first_line = content.strip().split("\n")[0]
                if first_line.startswith("# "):
                    title = first_line[2:].strip()
                for _, target in link_re.findall(content):
                    resolved = (md_file.parent / target).resolve()
                    try:
                        target_rel = str(resolved.relative_to(knowledge_path))
                    except ValueError:
                        continue
                    if target_rel != rel:
                        links.append({"source": rel, "target": target_rel})
            except Exception:
                pass
            nodes[rel] = {"id": rel, "label": title, "category": category}
        valid_ids = set(nodes.keys())
        seen, deduped = set(), []
        for link in links:
            if link["source"] in valid_ids and link["target"] in valid_ids:
                key = tuple(sorted([link["source"], link["target"]]))
                if key not in seen:
                    seen.add(key)
                    deduped.append(link)
        return {"nodes": list(nodes.values()), "links": deduped}
