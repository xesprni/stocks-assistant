"""技能加载器

从 skills/ 目录递归扫描 Markdown 文件，
解析 frontmatter 元数据并构建 Skill 对象。
"""

import logging
import os

from app.core.skills.frontmatter import (
    get_frontmatter_value,
    parse_boolean_value,
    parse_frontmatter,
    parse_metadata,
)
from app.core.skills.types import LoadSkillsResult, Skill, SkillEntry

logger = logging.getLogger("stocks-assistant.skills")


class SkillLoader:
    def load_skills_from_dir(self, dir_path: str, source: str) -> LoadSkillsResult:
        skills, diagnostics = [], []
        if not os.path.exists(dir_path) or not os.path.isdir(dir_path):
            return LoadSkillsResult(skills=skills, diagnostics=diagnostics)
        return self._load_recursive(dir_path, source, include_root_files=True)

    def _load_recursive(
        self, dir_path: str, source: str, include_root_files: bool = False
    ) -> LoadSkillsResult:
        skills, diagnostics = [], []
        try:
            entries = os.listdir(dir_path)
        except Exception as e:
            diagnostics.append(f"Failed to list {dir_path}: {e}")
            return LoadSkillsResult(skills=skills, diagnostics=diagnostics)

        if not include_root_files and "SKILL.md" in entries:
            skill_md = os.path.join(dir_path, "SKILL.md")
            if os.path.isfile(skill_md):
                result = self._load_from_file(skill_md, source)
                return result
            return LoadSkillsResult(skills=skills, diagnostics=diagnostics)

        for entry in entries:
            if entry.startswith(".") or entry in ("node_modules", "__pycache__", "venv", ".git"):
                continue
            full = os.path.join(dir_path, entry)
            if os.path.isdir(full):
                sub = self._load_recursive(full, source, include_root_files=False)
                skills.extend(sub.skills)
                diagnostics.extend(sub.diagnostics)
            elif os.path.isfile(full) and entry.endswith(".md") and entry.upper() != "README.MD":
                result = self._load_from_file(full, source)
                skills.extend(result.skills)
                diagnostics.extend(result.diagnostics)

        return LoadSkillsResult(skills=skills, diagnostics=diagnostics)

    def _load_from_file(self, file_path: str, source: str) -> LoadSkillsResult:
        diagnostics = []
        try:
            with open(file_path, encoding="utf-8") as f:
                content = f.read()
        except Exception as e:
            diagnostics.append(f"Failed to read {file_path}: {e}")
            return LoadSkillsResult(skills=[], diagnostics=diagnostics)

        frontmatter = parse_frontmatter(content)
        skill_dir = os.path.dirname(file_path)
        parent = os.path.basename(skill_dir)
        name = frontmatter.get("name", parent)
        if isinstance(name, list):
            name = name[0] if name else parent
        description = frontmatter.get("description", "")
        if isinstance(description, list):
            description = " ".join(str(d) for d in description if d)

        if not description or not description.strip():
            return LoadSkillsResult(skills=[], diagnostics=diagnostics)

        disable = parse_boolean_value(
            get_frontmatter_value(frontmatter, "disable-model-invocation"), default=False
        )
        skill = Skill(
            name=name,
            description=description,
            file_path=file_path,
            base_dir=skill_dir,
            source=source,
            content=content,
            disable_model_invocation=disable,
            frontmatter=frontmatter,
        )
        return LoadSkillsResult(skills=[skill], diagnostics=diagnostics)

    def load_all_skills(
        self,
        builtin_dir: str | None = None,
        custom_dir: str | None = None,
    ) -> dict[str, SkillEntry]:
        skill_map: dict[str, SkillEntry] = {}
        for dir_path, source in [(builtin_dir, "builtin"), (custom_dir, "custom")]:
            if dir_path and os.path.exists(dir_path):
                result = self.load_skills_from_dir(dir_path, source)
                for skill in result.skills:
                    metadata = parse_metadata(skill.frontmatter)
                    user_invocable = parse_boolean_value(
                        get_frontmatter_value(skill.frontmatter, "user-invocable"), default=True
                    )
                    skill_map[skill.name] = SkillEntry(
                        skill=skill,
                        metadata=metadata,
                        user_invocable=user_invocable,
                    )
        return skill_map
