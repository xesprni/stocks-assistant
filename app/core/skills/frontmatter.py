"""Markdown 技能文件的 YAML/JSON frontmatter 解析器

解析格式如下的 Markdown 文件：
```
---
name: skill-name
description: 技能描述
enabled: true
---
技能正文内容...
```
"""

import os
import re
import json
from typing import Any, Dict, List, Optional

from app.core.skills.types import SkillMetadata, SkillInstallSpec


def parse_frontmatter(content: str) -> Dict[str, Any]:
    frontmatter = {}
    match = re.match(r'^---\s*\n(.*?)\n---\s*\n', content, re.DOTALL)
    if not match:
        return frontmatter
    text = match.group(1)
    try:
        import yaml
        frontmatter = yaml.safe_load(text)
        if not isinstance(frontmatter, dict):
            frontmatter = {}
        return frontmatter
    except Exception:
        pass
    for line in text.split('\n'):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if ':' in line:
            key, value = line.split(':', 1)
            key, value = key.strip(), value.strip()
            if value.startswith('{') or value.startswith('['):
                try:
                    value = json.loads(value)
                except json.JSONDecodeError:
                    pass
            elif value.lower() in ('true', 'false'):
                value = value.lower() == 'true'
            elif value.isdigit():
                value = int(value)
            frontmatter[key] = value
    return frontmatter


def parse_metadata(frontmatter: Dict[str, Any]) -> Optional[SkillMetadata]:
    metadata_raw = frontmatter.get('metadata')
    if not metadata_raw:
        return None
    if isinstance(metadata_raw, str):
        try:
            metadata_raw = json.loads(metadata_raw)
        except json.JSONDecodeError:
            return None
    if not isinstance(metadata_raw, dict):
        return None
    meta_obj = _unwrap_namespace(metadata_raw)
    install_specs = []
    for spec_raw in meta_obj.get('install', []):
        if not isinstance(spec_raw, dict):
            continue
        kind = spec_raw.get('kind', spec_raw.get('type', '')).lower()
        if kind:
            install_specs.append(SkillInstallSpec(
                kind=kind, id=spec_raw.get('id'), label=spec_raw.get('label'),
                bins=_normalize_list(spec_raw.get('bins')),
                os=_normalize_list(spec_raw.get('os')),
                formula=spec_raw.get('formula'), package=spec_raw.get('package'),
                module=spec_raw.get('module'), url=spec_raw.get('url'),
                archive=spec_raw.get('archive'), extract=spec_raw.get('extract', False),
                strip_components=spec_raw.get('stripComponents'),
                target_dir=spec_raw.get('targetDir'),
            ))
    requires = {}
    requires_raw = meta_obj.get('requires', {})
    if isinstance(requires_raw, dict):
        for key, value in requires_raw.items():
            requires[key] = _normalize_list(value)
    return SkillMetadata(
        always=meta_obj.get('always', False),
        default_enabled=meta_obj.get('default_enabled', True),
        skill_key=meta_obj.get('skillKey'),
        primary_env=meta_obj.get('primaryEnv'),
        emoji=meta_obj.get('emoji'),
        homepage=meta_obj.get('homepage'),
        os=_normalize_list(meta_obj.get('os')),
        requires=requires,
        install=install_specs,
    )


_KNOWN_NS = {"cowagent", "openclaw"}


def _unwrap_namespace(metadata: dict) -> dict:
    keys = set(metadata.keys())
    ns = keys & _KNOWN_NS
    if len(ns) == 1 and len(keys) == 1:
        inner = metadata[ns.pop()]
        if isinstance(inner, dict):
            return inner
    return metadata


def _normalize_list(value: Any) -> List[str]:
    if not value:
        return []
    if isinstance(value, list):
        return [str(v).strip() for v in value if v]
    if isinstance(value, str):
        return [v.strip() for v in value.split(',') if v.strip()]
    return []


def parse_boolean_value(value, default=False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.lower() in ('true', '1', 'yes', 'on')
    return default


def get_frontmatter_value(frontmatter: dict, key: str):
    value = frontmatter.get(key)
    return str(value) if value is not None else None
