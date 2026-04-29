"""技能系统类型定义

定义技能相关的所有数据结构：
- SkillInstallSpec: 技能安装规格
- SkillMetadata: 技能元数据（从 YAML frontmatter 解析）
- Skill: 技能定义（含文件路径和内容）
- SkillEntry: 技能条目（技能 + 启用状态）
- LoadSkillsResult: 技能加载结果
- SkillSnapshot: 技能快照
"""

from typing import Any, Dict, List, Optional
from dataclasses import dataclass, field


@dataclass
class SkillInstallSpec:
    kind: str
    id: Optional[str] = None
    label: Optional[str] = None
    bins: List[str] = field(default_factory=list)
    os: List[str] = field(default_factory=list)
    formula: Optional[str] = None
    package: Optional[str] = None
    module: Optional[str] = None
    url: Optional[str] = None
    archive: Optional[str] = None
    extract: bool = False
    strip_components: Optional[int] = None
    target_dir: Optional[str] = None


@dataclass
class SkillMetadata:
    always: bool = False
    default_enabled: bool = True
    skill_key: Optional[str] = None
    primary_env: Optional[str] = None
    emoji: Optional[str] = None
    homepage: Optional[str] = None
    os: List[str] = field(default_factory=list)
    requires: Dict[str, List[str]] = field(default_factory=dict)
    install: List[SkillInstallSpec] = field(default_factory=list)


@dataclass
class Skill:
    name: str
    description: str
    file_path: str
    base_dir: str
    source: str
    content: str
    disable_model_invocation: bool = False
    frontmatter: Dict[str, Any] = field(default_factory=dict)


@dataclass
class SkillEntry:
    skill: Skill
    metadata: Optional[SkillMetadata] = None
    user_invocable: bool = True


@dataclass
class LoadSkillsResult:
    skills: List[Skill]
    diagnostics: List[str] = field(default_factory=list)


@dataclass
class SkillSnapshot:
    prompt: str
    skills: List[Dict[str, str]]
    resolved_skills: List[Skill] = field(default_factory=list)
    version: Optional[int] = None
