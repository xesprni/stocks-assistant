"""真实 worker 的内嵌字体格式与 CSS fallback 回归，无需系统字体或 fontTools。"""

from __future__ import annotations

import base64
import os
from pathlib import Path

import pytest

from app.core.rendering.service import RenderImageService
from app.schemas.rendering import RenderImageRequest

pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_RENDERING_BROWSER_TESTS") != "1",
    reason="Set RUN_RENDERING_BROWSER_TESTS=1 after installing rendering extras and Chromium",
)


def _font_url(extension: str, mime: str) -> str:
    font = Path(__file__).with_name("fixtures") / f"rendering-font.{extension}"
    return f"data:{mime};base64,{base64.b64encode(font.read_bytes()).decode('ascii')}"


@pytest.mark.parametrize(
    ("extension", "mime", "format_name"),
    [
        ("ttf", "font/truetype", "truetype"),
        ("ttf", "font/ttf", "truetype"),
        ("woff", "font/woff", "woff"),
    ],
)
def test_three_embedded_weights_render_actual_glyphs(
    tmp_path: Path, extension: str, mime: str, format_name: str
) -> None:
    from PIL import Image

    url = _font_url(extension, mime)
    faces = "".join(
        f"@font-face{{font-family:EmbeddedProbe;font-weight:{weight};"
        f'src:url("{url}") format("{format_name}")}}'
        for weight in (400, 500, 700)
    )
    lines = "".join(f'<div style="font-weight:{weight}">A</div>' for weight in (400, 500, 700))
    result = RenderImageService(str(tmp_path)).render(
        RenderImageRequest(
            html=(
                f"<style>{faces}body{{padding:0;color:#000;background:#fff;"
                "font-family:EmbeddedProbe;font-size:100px;line-height:100px;"
                f"font-synthesis:none}}</style>{lines}"
            ),
            scale=1,
        )
    )
    assert result["render_checks"]["fonts_ready"] is True
    # 人工 A 字形是实心矩形；检查实际像素，避免系统回退字体也让测试误通过。
    with Image.open(tmp_path / result["files"]["image"]) as image:
        pixels = image.convert("RGB")
        for top in (0, 100, 200):
            assert pixels.getpixel((30, top + 50)) == (0, 0, 0)
            assert pixels.getpixel((5, top + 50)) == (255, 255, 255)


def test_valid_css_fallback_source_does_not_fail_render(tmp_path: Path) -> None:
    url = _font_url("ttf", "font/ttf")
    result = RenderImageService(str(tmp_path)).render(
        RenderImageRequest(
            html=(
                "<style>@font-face{font-family:EmbeddedFallback;"
                'src:url("data:font/ttf;base64,YnJva2Vu") format("truetype"),'
                f'url("{url}") format("truetype")}}'
                "@font-face{font-family:UnusedBroken;"
                'src:url("data:font/ttf;base64,YnJva2Vu") format("truetype")}'
                '</style><p style="font-family:EmbeddedFallback">A</p>'
            )
        )
    )
    assert result["render_checks"]["fonts_ready"] is True
