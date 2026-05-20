"""Skill instruction reader tool.

Provides progressive disclosure for skills: the system prompt exposes only a
small skill index, and the model can call this tool to load one skill body when
it is actually needed.
"""

from typing import Any, Dict, Optional

from app.core.skills.config import should_include_skill
from app.core.skills.types import SkillEntry
from app.core.tools.base_tool import BaseTool, ToolResult


class ReadSkillTool(BaseTool):
    name: str = "read_skill"
    description: str = (
        "Load the full instructions for an enabled skill by exact skill name. "
        "Use this before applying a skill listed in the system prompt."
    )
    params: dict = {
        "type": "object",
        "properties": {
            "skill_name": {"type": "string", "description": "Exact name of the skill to load"},
            "start_line": {"type": "integer", "description": "Start line (default: 1)", "default": 1},
            "num_lines": {"type": "integer", "description": "Number of lines to read (default: all)"},
        },
        "required": ["skill_name"],
    }

    def execute(self, args: Dict[str, Any]) -> ToolResult:
        skill_name = str(args.get("skill_name") or "").strip()
        if not skill_name:
            return ToolResult.fail("Error: skill_name is required")

        manager = self._get_skill_manager()
        if not manager:
            return ToolResult.fail("Skills are not initialized")

        allowed_filter = self._get_active_skill_filter()
        entries = manager.filter_skills(skill_filter=allowed_filter, include_disabled=False)
        entries = [entry for entry in entries if not entry.skill.disable_model_invocation and should_include_skill(entry, manager.config)]

        entry = self._find_entry(entries, skill_name)
        if not entry:
            available = ", ".join(entry.skill.name for entry in entries) or "(none)"
            return ToolResult.fail(f"Skill not found or not enabled: {skill_name}. Available skills: {available}")

        content = entry.skill.content or ""
        lines = content.splitlines()
        start_line = max(1, self._as_int(args.get("start_line"), 1))
        num_lines_raw = args.get("num_lines")
        num_lines = self._as_int(num_lines_raw, 0) if num_lines_raw is not None else 0

        start_idx = min(start_line - 1, len(lines))
        selected = lines[start_idx:start_idx + num_lines] if num_lines and num_lines > 0 else lines[start_idx:]
        body = "\n".join(f"{start_idx + idx + 1}: {line}" for idx, line in enumerate(selected))
        end_line = start_idx + len(selected)
        return ToolResult.success(
            f"Skill: {entry.skill.name}\n"
            f"Description: {entry.skill.description}\n"
            f"File: {entry.skill.file_path}\n"
            f"Lines: {start_idx + 1}-{end_line} of {len(lines)}\n\n"
            f"{body}"
        )

    def _get_skill_manager(self):
        ctx = getattr(self, "context", None)
        if ctx and hasattr(ctx, "skill_manager"):
            return ctx.skill_manager
        try:
            from app.deps import get_skill_manager

            return get_skill_manager()
        except Exception:
            return None

    def _get_active_skill_filter(self) -> Optional[list[str]]:
        ctx = getattr(self, "context", None)
        active = getattr(ctx, "active_skill_filter", None) if ctx else None
        if not active:
            return None
        return list(active)

    @staticmethod
    def _find_entry(entries: list[SkillEntry], skill_name: str) -> Optional[SkillEntry]:
        exact = {entry.skill.name: entry for entry in entries}
        if skill_name in exact:
            return exact[skill_name]
        lowered = skill_name.lower()
        for entry in entries:
            if entry.skill.name.lower() == lowered:
                return entry
        return None

    @staticmethod
    def _as_int(value: Any, default: int) -> int:
        try:
            return int(value)
        except (TypeError, ValueError):
            return default
