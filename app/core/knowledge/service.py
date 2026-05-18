"""知识库服务

基于 Markdown 文件的个人知识库，提供：
- 目录树浏览
- 文件内容读取
- 知识图谱构建（基于 Markdown 内部链接）

知识库目录结构：workspace/knowledge/**/*.md
"""
import os
import re
from pathlib import Path
from typing import Optional

import logging

logger = logging.getLogger("stocks-assistant.knowledge")


class KnowledgeService:
    """知识库服务

    管理 workspace/knowledge/ 目录下的 Markdown 知识文件。
    """

    def __init__(self, workspace_root: str):
        self.workspace_root = workspace_root
        self.knowledge_dir = os.path.join(workspace_root, "knowledge")

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
                if not is_root:
                    stats["pages"] += 1
                    stats["size"] += size
                title = name.replace(".md", "")
                try:
                    with open(full, "r", encoding="utf-8") as f:
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
        with open(full_path, "r", encoding="utf-8") as f:
            content = f.read()
        return {"content": content, "path": rel_path}

    def build_graph(self) -> dict:
        """构建知识图谱（基于 Markdown 内部链接 [[target]] 或 [text](target.md)）"""
        knowledge_path = Path(self.knowledge_dir)
        if not knowledge_path.is_dir():
            return {"nodes": [], "links": []}
        nodes, links = {}, []
        link_re = re.compile(r'\[([^\]]*)\]\(([^)]+\.md)\)')
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
        for l in links:
            if l["source"] in valid_ids and l["target"] in valid_ids:
                key = tuple(sorted([l["source"], l["target"]]))
                if key not in seen:
                    seen.add(key)
                    deduped.append(l)
        return {"nodes": list(nodes.values()), "links": deduped}
