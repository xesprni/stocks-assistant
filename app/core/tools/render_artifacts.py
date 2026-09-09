"""Resolve private rendering artifacts without exposing arbitrary workspace files."""

from pathlib import Path
from re import fullmatch

_IMAGE_FILES = frozenset({"image.png", "top.png", "middle.png", "bottom.png", "mobile.png"})


def rendered_image_path(workspace_dir: str, artifact_id: str, filename: str) -> Path:
    if fullmatch(r"[0-9a-f]{32}", artifact_id) is None or filename not in _IMAGE_FILES:
        raise ValueError("Invalid rendering artifact")
    workspace = Path(workspace_dir).expanduser()
    # 用户目录、制图目录和文件均禁止符号链接，避免跨用户读取或文件类型替换。
    if workspace.is_symlink() or workspace.parent.is_symlink():
        raise ValueError("Invalid user workspace")
    root = workspace.resolve(strict=True)
    candidate = root
    for component in ("artifacts", "renderings", artifact_id, filename):
        candidate /= component
        if candidate.is_symlink():
            raise ValueError("Rendering artifact cannot be a symbolic link")
    resolved = candidate.resolve(strict=True)
    if not resolved.is_relative_to(root) or not resolved.is_file():
        raise ValueError("Invalid rendering artifact")
    return resolved
