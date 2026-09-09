"""Disposable Playwright process; never run model-authored JavaScript."""

from __future__ import annotations

import json
import math
import signal
import sys
from pathlib import Path
from typing import Any

from app.core.rendering.document import (
    CONTENT_SECURITY_POLICY,
    MAX_LOGICAL_HEIGHT,
    MAX_OUTPUT_PIXELS,
    RENDER_ORIGIN,
)
from app.core.rendering.layout import LAYOUT_AUDIT_JS

_READY_JS = """async () => {
  const timeout = new Promise((_, reject) => setTimeout(
    () => reject(new Error('Images or fonts did not become ready within 10 seconds')), 10000));
  await Promise.race([timeout, (async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(async image => {
      image.loading = 'eager';
      await image.decode();
      if (!image.naturalWidth) throw new Error('Image has no decoded pixels');
    }));
    if ([...document.fonts].some(font => font.status === 'error'))
      throw new Error('An embedded font failed to load');
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()]);
}"""


def render(job_path: Path) -> dict[str, Any]:
    from PIL import Image
    from playwright.sync_api import Route, sync_playwright

    work = job_path.parent
    job = json.loads(job_path.read_text(encoding="utf-8"))
    width, scale = job["logical_width"], job["scale"]
    source = (work / "source.html").read_text(encoding="utf-8")
    blocked = 0

    def route_resource(route: Route) -> None:
        nonlocal blocked
        if route.request.url == RENDER_ORIGIN and route.request.is_navigation_request():
            route.fulfill(
                status=200,
                content_type="text/html; charset=utf-8",
                headers={"Content-Security-Policy": CONTENT_SECURITY_POLICY},
                body=source,
            )
        else:
            blocked += 1
            route.abort()

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, chromium_sandbox=True)
        try:
            context = browser.new_context(
                viewport={"width": width, "height": 600},
                device_scale_factor=scale,
                service_workers="block",
                accept_downloads=False,
                locale="zh-CN",
                reduced_motion="reduce",
            )
            # CSP 同时禁止脚本、外部请求和嵌套页面；route 是额外的联网拦截边界。
            context.route("**/*", route_resource)
            context.route_web_socket("**/*", lambda ws: ws.close())
            context.add_init_script(
                "window.__blockedResources = 0; document.addEventListener('securitypolicyviolation', "
                "() => { window.__blockedResources += 1; });"
            )
            page = context.new_page()
            page.set_default_timeout(15000)
            page.goto(RENDER_ORIGIN, wait_until="load")
            page.add_style_tag(
                content=(
                    "*,*::before,*::after {animation:none!important;transition:none!important;"
                    "caret-color:transparent!important;content-visibility:visible!important}"
                )
            )
            page.evaluate(_READY_JS)
            audit = page.evaluate(LAYOUT_AUDIT_JS)
            height = math.ceil(audit["height"])
            if (
                height <= 0
                or height > MAX_LOGICAL_HEIGHT
                or width * height * scale**2 > MAX_OUTPUT_PIXELS
            ):
                raise ValueError(
                    "Report exceeds the 50 million pixel / 12000 CSS px height limit; "
                    "split the content into several images"
                )
            if any(issue["code"] == "horizontal_overflow" for issue in audit["issues"]):
                raise ValueError(
                    "Horizontal overflow would change the export width; reduce columns/labels "
                    "or fix overflowing elements before rendering"
                )
            if blocked or page.evaluate("window.__blockedResources"):
                raise ValueError(
                    "Blocked resources detected; embed all images/fonts and remove external CSS URLs"
                )
            # CSS 的小数高度可能被浏览器向下取整；补齐根容器到整数像素，避免丢失末行边缘。
            page.evaluate(
                "height => document.documentElement.style.setProperty('min-height', height + 'px', 'important')",
                height,
            )
            page.evaluate(_READY_JS)
            stable_audit = page.evaluate(LAYOUT_AUDIT_JS)
            if stable_audit["height"] != height:
                raise ValueError(
                    "Layout height changed during export; use content-sized containers"
                )
            # 固定宽度裁切框包含完整文档高度；像素由 Chromium 按 DPR 直接生成。
            page.screenshot(
                path=str(work / "image.png"),
                full_page=True,
                clip={"x": 0, "y": 0, "width": width, "height": height},
                animations="disabled",
                scale="device",
                timeout=15000,
            )
        finally:
            browser.close()

    # 检查实际 PNG 而非只相信浏览器的尺寸报告；检查图直接从最终文件裁出。
    with Image.open(work / "image.png") as image:
        image.load()
        expected = (width * scale, height * scale)
        if image.size != expected or image.format != "PNG":
            raise ValueError(
                f"PNG dimensions {image.size} do not match the requested native render resolution {expected}"
            )
        crop_height = min(image.height, 700 * scale)
        offsets = {
            "top": 0,
            "middle": (image.height - crop_height) // 2,
            "bottom": image.height - crop_height,
        }
        for name, top in offsets.items():
            image.crop((0, top, image.width, top + crop_height)).save(work / f"{name}.png")
        mobile_height = max(1, round(image.height * 390 / image.width))
        image.resize((390, mobile_height), Image.Resampling.LANCZOS).save(work / "mobile.png")
    return {
        "width": width * scale,
        "height": height * scale,
        "logical_height": height,
        "layout": audit,
        "render_checks": {
            "fonts_ready": True,
            "images_decoded": True,
            "native_resolution": True,
            "network_requests_blocked": True,
            "scripts_disabled": True,
            "visual_inspection_completed": False,
        },
    }


def main() -> None:
    def terminate(signum: int, _frame: Any) -> None:
        # SIGTERM 先走 render 的 finally，让 Playwright/Node 有机会关闭独立浏览器组。
        raise SystemExit(128 + signum)

    previous_handler = signal.signal(signal.SIGTERM, terminate)
    try:
        result = render(Path(sys.argv[1]))
    except Exception as exc:
        # 不向调用方回传浏览器日志或 HTML；依赖缺失提示保留可执行的修复方法。
        message = str(exc).splitlines()[0] if str(exc).splitlines() else type(exc).__name__
        if "Executable doesn't exist" in message or isinstance(exc, ImportError):
            from app.core.rendering.service import INSTALL_HELP

            message = INSTALL_HELP
        print(json.dumps({"error": message[:1500]}, ensure_ascii=False))
        raise SystemExit(1) from None
    finally:
        signal.signal(signal.SIGTERM, previous_handler)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
