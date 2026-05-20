"""技能提示词格式化器

将可用技能索引格式化为 XML 格式的提示词片段，
拼接到系统提示词末尾供 LLM 使用。

默认只披露 skill 名称、描述和位置；完整内容通过 read_skill 工具按需读取。
"""

from typing import Dict, List

from app.core.skills.types import Skill, SkillEntry


def format_skills_for_prompt(skills: List[Skill], include_content: bool = False) -> str:
    visible = [s for s in skills if not s.disable_model_invocation]
    if not visible:
        return ""
    lines = ["", "<available_skills>"]
    for skill in visible:
        lines.append("  <skill>")
        lines.append(f"    <name>{_esc(skill.name)}</name>")
        lines.append(f"    <description>{_esc(skill.description)}</description>")
        if include_content and skill.content:
            lines.append(f"    <content>")
            lines.append(f"      {_esc(skill.content)}")
            lines.append(f"    </content>")
        else:
            lines.append(f"    <location>{_esc(skill.file_path)}</location>")
        lines.append("  </skill>")
    lines.append("</available_skills>")
    lines.append("")
    lines.append(
        "When the user's request matches a skill, call the read_skill tool with the exact skill name before following it. "
        "The list above is only an index; do not infer detailed procedures from descriptions alone. "
        "Use read_skill instead of read_file or bash to load skill instructions."
    )
    return "\n".join(lines)


def format_skill_entries_for_prompt(entries: List[SkillEntry]) -> str:
    return format_skills_for_prompt([e.skill for e in entries], include_content=False)


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
