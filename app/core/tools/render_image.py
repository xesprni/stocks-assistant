"""将模型编排的静态 HTML/SVG 导出为用户工作空间内的高清 PNG。"""

from typing import Any

from pydantic import ValidationError

from app.core.rendering.service import RenderImageService
from app.core.tools.base_tool import BaseTool, ToolResult
from app.schemas.rendering import RenderImageRequest


class RenderImageTool(BaseTool):
    name = "render_image"
    description = (
        "Render a local report/chart from a self-contained static HTML fragment with CSS and inline "
        "SVG to a high-resolution PNG. Default: 800 CSS px wide at 3x (2400 physical px), automatic "
        "height. Use inline SVG for sharp charts; no JavaScript, canvas, external URLs or local "
        "resource references. Embed raster images/fonts as data URLs. Inputs: html OR workspace "
        "html_path. Use the SAME supplied snapshot for chart and prose; its hash records provenance, "
        "not numerical verification. Returns original PNG, top/middle/bottom crops, mobile preview "
        "and layout issues. REQUIRED: call view_image on the final PNG and each review crop before "
        "claiming visual quality; inspect Chinese, labels, units, clipping and data consistency. "
        "Fix crowding by removing duplicate labels, simplifying text, reducing columns, increasing "
        "chart height/spacing, then total height. Never fix by shrinking text or upscaling a bitmap."
    )
    params = RenderImageRequest.model_json_schema()

    def __init__(self, workspace_dir: str = "."):
        self.service = RenderImageService(workspace_dir)

    def execute(self, params: dict[str, Any]) -> ToolResult:
        try:
            request = RenderImageRequest.model_validate(params)
            return ToolResult.success(self.service.render(request))
        except (ValidationError, ValueError, RuntimeError, OSError) as exc:
            return ToolResult.fail(str(exc))
