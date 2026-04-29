"""技能资格检查

根据运行环境判断技能是否可用（如检查依赖的工具、API 密钥等）。
"""

import os
from typing import Any, Dict, List, Optional

import logging

from app.core.skills.types import SkillEntry

logger = logging.getLogger("stocks-assistant.skills")


def resolve_runtime_platform() -> str:
    import platform
    return platform.system().lower()


def has_binary(bin_name: str) -> bool:
    import shutil
    return shutil.which(bin_name) is not None


def has_env_var(env_name: str) -> bool:
    return env_name in os.environ and bool(os.environ[env_name].strip())


def should_include_skill(
    entry: SkillEntry,
    config: Optional[Dict] = None,
    current_platform: Optional[str] = None,
) -> bool:
    metadata = entry.metadata
    if not metadata:
        return True
    if metadata.os:
        platform_name = current_platform or resolve_runtime_platform()
        if platform_name not in metadata.os:
            return False
    if metadata.always:
        return True
    if metadata.requires:
        required_bins = metadata.requires.get('bins', [])
        if required_bins and not all(has_binary(b) for b in required_bins):
            return False
        required_env = metadata.requires.get('env', [])
        if required_env and not all(has_env_var(e) for e in required_env):
            return False
    return True


def get_missing_requirements(entry: SkillEntry, current_platform: Optional[str] = None) -> Dict[str, List[str]]:
    missing: Dict[str, List[str]] = {}
    metadata = entry.metadata
    if not metadata or not metadata.requires:
        return missing
    required_bins = metadata.requires.get('bins', [])
    if required_bins:
        missing_bins = [b for b in required_bins if not has_binary(b)]
        if missing_bins:
            missing['bins'] = missing_bins
    required_env = metadata.requires.get('env', [])
    if required_env:
        missing_env = [e for e in required_env if not has_env_var(e)]
        if missing_env:
            missing['env'] = missing_env
    return missing
