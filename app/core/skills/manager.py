"""技能管理器

管理技能的加载、启用/禁用、过滤和提示词生成。
技能配置持久化到 skills_config.json 文件。
"""

import json
import logging
import os
from pathlib import Path
from typing import Dict, List, Optional

from app.core.skills.types import Skill, SkillEntry, SkillSnapshot
from app.core.skills.loader import SkillLoader
from app.core.skills.formatter import format_skill_entries_for_prompt, format_unavailable_skills_for_prompt
from app.core.skills.config import should_include_skill, get_missing_requirements

logger = logging.getLogger("stocks-assistant.skills")

SKILLS_CONFIG_FILE = "skills_config.json"


class SkillManager:
    def __init__(
        self,
        builtin_dir: Optional[str] = None,
        custom_dir: Optional[str] = None,
        config: Optional[Dict] = None,
    ):
        project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
        self.builtin_dir = builtin_dir or os.path.join(project_root, 'skills')
        self.custom_dir = custom_dir or os.path.join(project_root, 'workspace', 'skills')
        self.config = config or {}
        self._skills_config_path = os.path.join(self.custom_dir, SKILLS_CONFIG_FILE)
        self.skills_config: Dict[str, dict] = {}
        self.loader = SkillLoader()
        self.skills: Dict[str, SkillEntry] = {}
        self.refresh_skills()

    def refresh_skills(self):
        self.skills = self.loader.load_all_skills(
            builtin_dir=self.builtin_dir, custom_dir=self.custom_dir,
        )
        self._sync_skills_config()
        logger.debug(f"Loaded {len(self.skills)} skills")

    def _sync_skills_config(self):
        saved = self._load_skills_config()
        merged: Dict[str, dict] = {}
        for name, entry in self.skills.items():
            prev = saved.get(name, {})
            enabled = prev.get("enabled", entry.metadata.default_enabled if entry.metadata else True) if name in saved else (entry.metadata.default_enabled if entry.metadata else True)
            merged[name] = {
                "name": name,
                "description": entry.skill.description,
                "source": prev.get("source") or entry.skill.source,
                "enabled": enabled,
            }
        self.skills_config = merged
        self._save_skills_config()

    def _load_skills_config(self) -> Dict[str, dict]:
        if not os.path.exists(self._skills_config_path):
            return {}
        try:
            with open(self._skills_config_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def _save_skills_config(self):
        os.makedirs(os.path.dirname(self._skills_config_path) or ".", exist_ok=True)
        try:
            with open(self._skills_config_path, "w", encoding="utf-8") as f:
                json.dump(self.skills_config, f, indent=4, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Failed to save skills config: {e}")

    def is_skill_enabled(self, name: str) -> bool:
        entry = self.skills_config.get(name)
        return entry.get("enabled", True) if entry else True

    def set_skill_enabled(self, name: str, enabled: bool):
        if name not in self.skills_config:
            raise ValueError(f"Skill '{name}' not found")
        self.skills_config[name]["enabled"] = enabled
        self._save_skills_config()

    def get_skills_config(self) -> Dict[str, dict]:
        return dict(self.skills_config)

    def get_skill(self, name: str) -> Optional[SkillEntry]:
        return self.skills.get(name)

    def list_skills(self) -> List[SkillEntry]:
        return list(self.skills.values())

    def filter_skills(self, skill_filter: Optional[List[str]] = None, include_disabled: bool = False) -> List[SkillEntry]:
        entries = list(self.skills.values())
        entries = [e for e in entries if should_include_skill(e, self.config)]
        if skill_filter:
            entries = [e for e in entries if e.skill.name in skill_filter]
        if not include_disabled:
            entries = [e for e in entries if self.is_skill_enabled(e.skill.name)]
        return entries

    def build_skills_prompt(self, skill_filter: Optional[List[str]] = None) -> str:
        eligible = self.filter_skills(skill_filter=skill_filter, include_disabled=False)
        result = format_skill_entries_for_prompt(eligible)
        unavailable = [e for e in self.filter_skills(skill_filter=skill_filter) if not should_include_skill(e, self.config)]
        if unavailable:
            missing_map = {e.skill.name: get_missing_requirements(e) for e in unavailable}
            result += format_unavailable_skills_for_prompt(unavailable, missing_map)
        return result

    def build_skill_snapshot(self, skill_filter: Optional[List[str]] = None, version: Optional[int] = None) -> SkillSnapshot:
        entries = self.filter_skills(skill_filter=skill_filter, include_disabled=False)
        prompt = format_skill_entries_for_prompt(entries)
        skills_info = [{"name": e.skill.name, "primary_env": e.metadata.primary_env if e.metadata else None} for e in entries]
        return SkillSnapshot(prompt=prompt, skills=skills_info, resolved_skills=[e.skill for e in entries], version=version)
