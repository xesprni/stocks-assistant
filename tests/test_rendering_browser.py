"""Opt-in Chromium integration tests; all assets are inline and network is blocked."""

from __future__ import annotations

import base64
import hashlib
import io
import json
import os
from pathlib import Path
from typing import Any

import pytest

from app.core.rendering.document import MAX_LOGICAL_HEIGHT
from app.core.rendering.service import RenderImageService
from app.schemas.rendering import RenderImageRequest, RenderSnapshot

pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_RENDERING_BROWSER_TESTS") != "1",
    reason="Set RUN_RENDERING_BROWSER_TESTS=1 after installing rendering extras and Chromium",
)


@pytest.fixture
def renderer(tmp_path: Path) -> RenderImageService:
    return RenderImageService(str(tmp_path))


def _issue_codes(result: dict[str, Any]) -> set[str]:
    return {issue["code"] for issue in result["layout"]["issues"]}


def test_long_chinese_svg_report_exports_native_png_and_exact_crops(
    renderer: RenderImageService, tmp_path: Path
) -> None:
    from PIL import Image

    snapshot = RenderSnapshot(
        as_of="2026-09-09 15:00 Asia/Shanghai",
        sources=["本地固定测试数据"],
        data={"quarters": ["第一季度", "第二季度"], "revenue": [120, 180], "unit": "万元"},
    )
    sections = "".join(
        f'<section style="min-height:360px;padding:20px;background:#{shade}">'
        f"<h2>第 {index} 部分：季度营业收入</h2>"
        "<p>第一季度 120 万元，第二季度 180 万元。</p></section>"
        for index, shade in enumerate(["eaf4ff", "f0f9ee", "fff4e5", "f5efff"], start=1)
    )
    result = renderer.render(
        RenderImageRequest(
            html=(
                '<h1>本地中文投研图表</h1><svg viewBox="0 0 700 240" '
                'xmlns="http://www.w3.org/2000/svg" aria-label="季度营业收入，单位万元">'
                '<rect x="30" y="100" width="200" height="100" fill="#1463bf"/>'
                '<rect x="350" y="50" width="200" height="150" fill="#00865a"/>'
                '<text x="60" y="85">120 万元</text>'
                '<text x="380" y="35">180 万元</text>'
                '<text x="40" y="232" font-size="24">第一季度</text>'
                '<text x="360" y="232" font-size="24">第二季度</text></svg>'
                f'{sections}<div style="height:12px;background:#e02852"></div>'
            ),
            snapshot=snapshot,
        )
    )

    assert result["width"] == 2400
    assert result["height"] == result["logical_height"] * 3
    assert result["logical_height"] > 1800
    assert result["layout"]["width"] == 800
    assert result["layout"]["height"] == result["logical_height"]
    assert not result["layout"]["stats"]["truncated"]
    assert _issue_codes(result) == {"manual_review_required"}
    assert result["visual_review"]["status"] == "required"
    assert result["render_checks"]["visual_inspection_completed"] is False
    assert result["render_checks"]["native_resolution"] is True
    assert result["render_checks"]["fonts_ready"] is True
    assert result["render_checks"]["images_decoded"] is True

    with Image.open(tmp_path / result["files"]["image"]) as final_image:
        final_image.load()
        assert final_image.format == "PNG"
        assert final_image.size == (result["width"], result["height"])
        assert final_image.getbbox() == (0, 0, final_image.width, final_image.height)
        crop_height = min(final_image.height, 2100)
        offsets = {
            "top": 0,
            "middle": (final_image.height - crop_height) // 2,
            "bottom": final_image.height - crop_height,
        }
        for name, y in offsets.items():
            with Image.open(tmp_path / result["files"][name]) as crop:
                expected = final_image.crop((0, y, final_image.width, y + crop_height))
                assert crop.size == expected.size
                assert crop.mode == expected.mode
                assert crop.tobytes() == expected.tobytes()
        with Image.open(tmp_path / result["files"]["mobile"]) as mobile:
            assert mobile.size == (390, round(final_image.height * 390 / final_image.width))
        # 条形图的内部像素来自原生 SVG 绘制，校验完整图实际包含图形。
        assert any(color == (20, 99, 191) for _, color in (final_image.getcolors(100000) or []))

    snapshot_bytes = (tmp_path / result["snapshot_path"]).read_bytes()
    assert hashlib.sha256(snapshot_bytes).hexdigest() == result["snapshot_sha256"]
    assert json.loads(snapshot_bytes) == snapshot.model_dump()
    source = (tmp_path / result["source_path"]).read_text(encoding="utf-8")
    assert "本地中文投研图表" in source
    assert "2026-09-09 15:00 Asia/Shanghai" in source
    assert "本地固定测试数据" in source
    assert not any(tmp_path.glob("artifacts/renderings/.render-*"))


def test_layout_reports_small_text_overlap_hidden_content_and_top_clipping(
    renderer: RenderImageService,
) -> None:
    result = renderer.render(
        RenderImageRequest(
            html=(
                '<div style="position:absolute;top:-14px;left:40px">顶部裁切</div>'
                '<h1>排版风险样例</h1><p style="font-size:18px">字号过小的来源信息</p>'
                '<section style="position:relative;height:150px">'
                '<span style="position:absolute;left:0;top:10px">重叠标题一</span>'
                '<span style="position:absolute;left:20px;top:14px">重叠标题二</span>'
                '</section><div style="height:70px;overflow:hidden">'
                '<p style="height:200px">被裁切的内容<br>第二行<br>第三行</p></div>'
                '<div style="height:100px"></div>'
            )
        )
    )
    assert {"small_text", "text_overlap", "clipped_container", "vertical_clipping"}.issubset(
        _issue_codes(result)
    )


@pytest.mark.parametrize(
    "html",
    [
        '<div style="width:1000px;height:100px;background:red">超出右边界</div>',
        '<div style="position:absolute;left:-35px;top:60px">超出左边界</div>',
    ],
    ids=["positive-overflow", "negative-position"],
)
def test_horizontal_overflow_fails_without_publishing_artifacts(
    renderer: RenderImageService, tmp_path: Path, html: str
) -> None:
    with pytest.raises(RuntimeError, match="Horizontal overflow"):
        renderer.render(RenderImageRequest(html=html))
    assert list((tmp_path / "artifacts/renderings").iterdir()) == []


@pytest.mark.parametrize(
    ("html", "error"),
    [
        (
            '<div style="height:80px;background-image:url(https://blocked.invalid/pixel.png)">'
            "外部背景图片</div>",
            "Blocked resources",
        ),
        ('<img src="data:image/png;base64,bm90LWEtcG5n" alt="损坏图片">', "decod"),
    ],
    ids=["external-css-background", "broken-inline-png"],
)
def test_unavailable_assets_fail_without_publishing_artifacts(
    renderer: RenderImageService, tmp_path: Path, html: str, error: str
) -> None:
    with pytest.raises(RuntimeError, match=error):
        renderer.render(RenderImageRequest(html=html))
    assert list((tmp_path / "artifacts/renderings").iterdir()) == []


@pytest.mark.parametrize("failed_weight", [400, 500, 700])
def test_failed_embedded_font_identifies_only_the_failed_weight(
    renderer: RenderImageService, tmp_path: Path, failed_weight: int
) -> None:
    valid_font = base64.b64encode(
        (Path(__file__).parent / "fixtures/rendering-font.ttf").read_bytes()
    ).decode("ascii")
    broken_font = base64.b64encode(b"deliberately-invalid-font").decode("ascii")
    faces = []
    samples = []
    for weight in (400, 500, 700):
        font = broken_font if weight == failed_weight else valid_font
        faces.append(
            f"@font-face {{font-family:RenderFontProbe;font-weight:{weight};"
            f"src:url(data:font/ttf;base64,{font}) format('truetype')}}"
        )
        # 三个字重都参与实际布局，确保 document.fonts.ready 触发各自字体加载。
        samples.append(f'<p style="font-family:RenderFontProbe;font-weight:{weight}">A</p>')
    with pytest.raises(RuntimeError, match="An embedded font failed to load") as error:
        renderer.render(
            RenderImageRequest(html=f"<style>{''.join(faces)}</style>{''.join(samples)}")
        )

    message = str(error.value)
    assert '"family":"RenderFontProbe"' in message
    assert f'"weight":"{failed_weight}"' in message
    assert '"style":"normal"' in message
    assert '"status":"error"' in message
    assert message.count('"family":') == 1
    assert "data:" not in message
    assert broken_font not in message
    assert valid_font not in message
    assert list((tmp_path / "artifacts/renderings").iterdir()) == []


def test_embedded_font_error_details_are_bounded_and_single_line(
    renderer: RenderImageService, tmp_path: Path
) -> None:
    faces = []
    samples = []
    for index in range(6):
        family = f"Diagnostic\u2028Font-{index}-" + "x" * 180
        faces.append(
            f'@font-face {{font-family:"{family}";'
            'src:url(data:font/ttf;base64,aW52YWxpZA==) format("truetype")}'
        )
        samples.append(f"<p style='font-family:\"{family}\"'>A</p>")
    with pytest.raises(RuntimeError, match="An embedded font failed to load") as error:
        renderer.render(
            RenderImageRequest(html=f"<style>{''.join(faces)}</style>{''.join(samples)}")
        )

    message = str(error.value)
    assert message.count('"family":') == 4
    assert message.endswith("; +2 more")
    assert len(message) < 1000
    assert not any(ord(char) < 32 or 127 <= ord(char) <= 159 for char in message)
    assert "\u2028" not in message
    assert "\u2029" not in message
    assert "x" * 81 not in message
    assert "data:" not in message
    assert list((tmp_path / "artifacts/renderings").iterdir()) == []


def test_excessive_height_is_rejected_before_export(
    renderer: RenderImageService, tmp_path: Path
) -> None:
    with pytest.raises(RuntimeError, match="12000 CSS px height limit"):
        renderer.render(
            RenderImageRequest(
                html=f'<div style="height:{MAX_LOGICAL_HEIGHT + 1}px">过长报告</div>'
            )
        )
    assert list((tmp_path / "artifacts/renderings").iterdir()) == []


def test_large_document_reports_bounded_partial_inspection(renderer: RenderImageService) -> None:
    cells = "".join('<span style="font-size:24px">格</span>' for _ in range(3100))
    result = renderer.render(
        RenderImageRequest(html=f'<div style="line-height:1.2">{cells}</div>', scale=1)
    )
    stats = result["layout"]["stats"]
    assert stats["truncated"] is True
    assert "inspection_limit" in _issue_codes(result)
    assert stats["inspectedElements"] <= stats["limits"]["elements"]
    assert stats["inspectedTextRects"] <= stats["limits"]["textRects"]
    assert stats["overlapComparisons"] <= stats["limits"]["comparisons"]


@pytest.mark.parametrize("raster_width", [30, 300], ids=["low-resolution", "native-resolution"])
def test_short_report_uses_content_height_and_checks_raster_resolution(
    renderer: RenderImageService, raster_width: int
) -> None:
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (raster_width, raster_width // 2), "#1463bf").save(buffer, format="PNG")
    data = base64.b64encode(buffer.getvalue()).decode("ascii")
    result = renderer.render(
        RenderImageRequest(
            html=f'<img style="display:block;width:100px;height:50px" '
            f'src="data:image/png;base64,{data}" alt="像素质量样例">'
        )
    )
    assert result["logical_height"] == 114  # 50px 图片 + 上下各 32px 默认内边距。
    assert result["height"] == 342
    assert ("low_resolution_image" in _issue_codes(result)) is (raster_width == 30)


def test_fractional_content_height_keeps_the_last_rendered_pixel(
    renderer: RenderImageService, tmp_path: Path
) -> None:
    from PIL import Image

    result = renderer.render(
        RenderImageRequest(
            html=(
                "<style>body {padding:0}</style>"
                '<svg viewBox="0 0 800 114.3" style="display:block;height:114.3px">'
                '<rect width="800" height="114.3" fill="#1463bf"/>'
                '<rect y="113.3" width="800" height="1" fill="#e02852"/></svg>'
            )
        )
    )
    assert result["logical_height"] == 115
    assert result["height"] == 345
    with Image.open(tmp_path / result["files"]["image"]) as image:
        assert image.size == (2400, 345)
        # 114.3 × 3 = 342.9，末条色带必须保留第 343 行，不能按 114px 裁切。
        red, green, blue = image.convert("RGB").getpixel((1200, 342))
        assert red > 200 and green < 200 and blue < 200
        assert image.convert("RGB").getpixel((1200, 344)) == (255, 255, 255)
