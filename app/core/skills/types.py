"""技能系统类型定义

定义技能相关的所有数据结构：
- SkillInstallSpec: 技能安装规格
- SkillMetadata: 技能元数据（从 YAML frontmatter 解析）
- Skill: 技能定义（含文件路径和内容）
- SkillEntry: 技能条目（技能 + 启用状态）
- LoadSkillsResult: 技能加载结果
- SkillSnapshot: 技能快照
"""

from dataclasses import dataclass, field
from typing import Any


@dataclass
class SkillInstallSpec:
    kind: str
    id: str | None = None
    label: str | None = None
    bins: list[str] = field(default_factory=list)
    os: list[str] = field(default_factory=list)
    formula: str | None = None
    package: str | None = None
    module: str | None = None
    url: str | None = None
    archive: str | None = None
    extract: bool = False
    strip_components: int | None = None
    target_dir: str | None = None


@dataclass
class SkillMetadata:
    always: bool = False
    default_enabled: bool = True
    skill_key: str | None = None
    primary_env: str | None = None
    emoji: str | None = None
    homepage: str | None = None
    os: list[str] = field(default_factory=list)
    requires: dict[str, list[str]] = field(default_factory=dict)
    install: list[SkillInstallSpec] = field(default_factory=list)


@dataclass
class Skill:
    name: str
    description: str
    file_path: str
    base_dir: str
    source: str
    content: str
    disable_model_invocation: bool = False
    frontmatter: dict[str, Any] = field(default_factory=dict)


@dataclass
class SkillEntry:
    skill: Skill
    metadata: SkillMetadata | None = None
    user_invocable: bool = True


@dataclass
class LoadSkillsResult:
    skills: list[Skill]
    diagnostics: list[str] = field(default_factory=list)


@dataclass
class SkillSnapshot:
    prompt: str
    skills: list[dict[str, str]]
    resolved_skills: list[Skill] = field(default_factory=list)
    version: int | None = None
