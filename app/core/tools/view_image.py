"""读取用户工作空间中的图片，供视觉模型实际检查渲染结果。"""

from __future__ import annotations

import base64
import io
from pathlib import Path
from typing import Any

from app.core.tools.base_tool import BaseTool, ToolResult
from app.core.tools.paths import resolve_workspace_path

MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_IMAGE_PIXELS = 50_000_000


class ViewImageTool(BaseTool):
    read_only = True
    name = "view_image"
    description = (
        "View a PNG or JPEG in your workspace using the current model's vision capability. "
        "Use after render_image to inspect the final image and its top/middle/bottom crops. "
        "Requires an image-capable model; reading metadata alone is not a visual inspection."
    )
    params = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Image path relative to your workspace"},
        },
        "required": ["path"],
        "additionalProperties": False,
    }

    def __init__(self, workspace_dir: str = "."):
        super().__init__()
        self.workspace_dir = Path(workspace_dir).expanduser().resolve()

    def execute(self, args: dict[str, Any]) -> ToolResult:
        path = args.get("path")
        if not isinstance(path, str) or not path.strip():
            return ToolResult.fail("path must be a non-empty string")
        try:
            from PIL import Image, UnidentifiedImageError
        except ImportError:
            return ToolResult.fail("Image viewing requires Pillow. Run: uv sync --extra rendering.")

        try:
            target = resolve_workspace_path(self.workspace_dir, path.strip())
            if not target.is_file():
                return ToolResult.fail("Image file not found")
            # 先限制输入字节，再解码像素；不能把任意本地文件当作图片传给模型。
            with target.open("rb") as handle:
                data = handle.read(MAX_IMAGE_BYTES + 1)
            if len(data) > MAX_IMAGE_BYTES:
                return ToolResult.fail("Image exceeds the 20 MiB limit; view a rendered crop.")
            with Image.open(io.BytesIO(data)) as picture:
                image_format = picture.format
                width, height = picture.size
                if image_format not in {"PNG", "JPEG"}:
                    return ToolResult.fail("Only PNG and JPEG images are supported")
                if width * height > MAX_IMAGE_PIXELS:
                    return ToolResult.fail("Image exceeds 50 million pixels; view a rendered crop.")
                if getattr(picture, "n_frames", 1) != 1:
                    return ToolResult.fail("Animated images are not supported")
                picture.verify()
            # verify 校验容器结构，load 确认像素可解码；始终发送原图，不插值放大。
            with Image.open(io.BytesIO(data)) as picture:
                picture.load()
            mime_type = "image/png" if image_format == "PNG" else "image/jpeg"
            relative_path = target.relative_to(self.workspace_dir).as_posix()
            return ToolResult.success(
                {
                    "path": relative_path,
                    "mime_type": mime_type,
                    "width": width,
                    "height": height,
                    "size_bytes": len(data),
                    "instruction": "Inspect the attached image visually before reporting findings.",
                },
                # 图片只沿模型私有通道传递，公共工具事件只保留上面的元数据。
                ext_data={
                    "image_blocks": [
                        {
                            "type": "image",
                            "source_path": relative_path,
                            "source": {
                                "type": "base64",
                                "media_type": mime_type,
                                "data": base64.b64encode(data).decode("ascii"),
                            },
                        }
                    ]
                },
            )
        except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError) as exc:
            return ToolResult.fail(f"Cannot view image: {exc}")
