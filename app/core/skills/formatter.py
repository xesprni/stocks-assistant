"""技能提示词格式化器

将可用技能列表格式化为 XML 格式的提示词片段，
拼接到系统提示词末尾供 LLM 使用。
"""

from typing import Dict, List

from app.core.skills.types import Skill, SkillEntry


def format_skills_for_prompt(skills: List[Skill]) -> str:
    visible = [s for s in skills if not s.disable_model_invocation]
    if not visible:
        return ""
    lines = ["", "<available_skills>"]
    for skill in visible:
        lines.append("  <skill>")
        lines.append(f"    <name>{_esc(skill.name)}</name>")
        lines.append(f"    <description>{_esc(skill.description)}</description>")
        lines.append(f"    <location>{_esc(skill.file_path)}</location>")
        lines.append("  </skill>")
    lines.append("</available_skills>")
    return "\n".join(lines)


def format_skill_entries_for_prompt(entries: List[SkillEntry]) -> str:
    return format_skills_for_prompt([e.skill for e in entries])


def format_unavailable_skills_for_prompt(
    entries: List[SkillEntry],
    missing_map: Dict[str, Dict[str, List[str]]],
) -> str:
    if not entries:
        return ""
    lines = [
        "", "<unavailable_skills>",
        "The following skills are installed but not yet ready.",
    ]
    for entry in entries:
        skill = entry.skill
        missing = missing_map.get(skill.name, {})
        missing_parts = [f"{k}: {', '.join(v)}" for k, v in missing.items()]
        lines.append("  <skill>")
        lines.append(f"    <name>{_esc(skill.name)}</name>")
        lines.append(f"    <description>{_esc(skill.description)}</description>")
        lines.append(f"    <missing>{_esc('; '.join(missing_parts) if missing_parts else 'unknown')}</missing>")
        lines.append("  </skill>")
    lines.append("</unavailable_skills>")
    return "\n".join(lines)


def _esc(text: str) -> str:
    return text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')
