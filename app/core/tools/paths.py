"""Shared path boundary for workspace file tools."""

from pathlib import Path


def resolve_workspace_path(workspace: Path, path: str) -> Path:
    """Resolve a target while rejecting parent, prefix and symlink escapes."""
    root = workspace.resolve()
    target = (root / path).resolve()
    # 必须比较真实目录层级；字符串前缀会放行同名前缀目录和指向外部的软链接。
    if not target.is_relative_to(root):
        raise ValueError("Error: path outside workspace")
    return target
