"""Repeat font checks in fresh worker-like processes without changing the input HTML."""

from __future__ import annotations

import argparse
import base64
import contextlib
import hashlib
import importlib
import json
import platform
import re
import subprocess
import sys
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any
from urllib.parse import unquote

from app.core.rendering.document import (
    CONTENT_SECURITY_POLICY,
    MAX_SOURCE_BYTES,
    RENDER_ORIGIN,
    prepare_document,
)
from app.core.rendering.service import _stop_worker
from app.core.rendering.worker import _READY_JS

_FONTS_JS = """() => [...document.fonts].slice(0, 64).map((font, index) => ({
  index, family:font.family, weight:font.weight, style:font.style,
  stretch:font.stretch, status:font.status
}))"""
_SOURCES_JS = """() => {
  const faces = [];
  const visit = rules => {
    for (const rule of rules) {
      if (faces.length >= 64) return;
      if (rule instanceof CSSFontFaceRule) faces.push({
        family:rule.style.fontFamily, weight:rule.style.fontWeight,
        style:rule.style.fontStyle, src:rule.style.getPropertyValue('src')
      });
      else if (rule.cssRules) visit(rule.cssRules);
    }
  };
  for (const sheet of document.styleSheets) visit(sheet.cssRules);
  return faces;
}"""


def font_sources(faces: list[dict[str, str]]) -> list[dict[str, Any]]:
    """记录字体字节摘要以识别探针差异，不把 base64 或本地/远程资源地址写入报告。"""
    result = []
    for face in faces:
        source = face["src"]
        info: dict[str, Any] = {key: value[:200] for key, value in face.items() if key != "src"}
        info["formats"] = re.findall(r"format\(([^)]*)\)", source)
        info["resources"] = []
        for groups in re.findall(r"""url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)""", source):
            url = next((value for value in groups if value), "").strip()
            resource: dict[str, Any] = {"inline": url.lower().startswith("data:")}
            if resource["inline"]:
                header, separator, encoded = url.partition(",")
                resource["mime"] = header[5:].split(";")[0][:100]
                try:
                    if not separator or not header.lower().endswith(";base64"):
                        raise ValueError("not base64")
                    raw = base64.b64decode("".join(unquote(encoded).split()), validate=True)
                    resource.update(
                        base64_valid=True,
                        bytes=len(raw),
                        sha256=hashlib.sha256(raw).hexdigest(),
                        signature=raw[:4].hex(),
                    )
                except ValueError:
                    resource["base64_valid"] = False
            info["resources"].append(resource)
        result.append(info)
    return result


def probe(path: Path, *, full_document: bool, width: int, scale: int) -> dict[str, Any]:
    from playwright.sync_api import Route, sync_playwright

    with path.open("rb") as source:
        raw = source.read(MAX_SOURCE_BYTES + 1)
    if len(raw) > MAX_SOURCE_BYTES:
        raise ValueError("Input exceeds 2 MB")
    document = raw.decode("utf-8")
    if not full_document:
        document, _ = prepare_document(document, None)
    result: dict[str, Any] = {
        "input_sha256": hashlib.sha256(raw).hexdigest(),
        "document_sha256": hashlib.sha256(document.encode("utf-8")).hexdigest(),
        "python": platform.python_version(),
        "platform": platform.platform(),
        "playwright": version("playwright"),
        "fonttools": None,
        "blocked_requests": 0,
        "font_console": [],
    }
    with contextlib.suppress(PackageNotFoundError):
        result["fonttools"] = version("fonttools")

    def route_resource(route: Route) -> None:
        if route.request.url == RENDER_ORIGIN and route.request.is_navigation_request():
            route.fulfill(
                status=200,
                content_type="text/html; charset=utf-8",
                headers={"Content-Security-Policy": CONTENT_SECURITY_POLICY},
                body=document,
            )
        else:
            result["blocked_requests"] += 1
            route.abort()

    def on_console(message: Any) -> None:
        # Chromium 的解码日志含完整 data URI；只保留 OTS 原因及不带资源内容的解码提示。
        text = message.text
        if text.startswith("Failed to decode downloaded font:"):
            text = "Failed to decode downloaded font [source omitted]"
        elif text.startswith("OTS parsing error:"):
            text = re.sub(r"data:\S+", "[source omitted]", text)[:500]
        else:
            return
        if len(result["font_console"]) < 20:
            result["font_console"].append(text)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, chromium_sandbox=True)
        try:
            result["chromium"] = browser.version
            context = browser.new_context(
                viewport={"width": width, "height": 600},
                device_scale_factor=scale,
                service_workers="block",
                accept_downloads=False,
                locale="zh-CN",
                reduced_motion="reduce",
            )
            context.route("**/*", route_resource)
            context.route_web_socket("**/*", lambda ws: ws.close())
            context.add_init_script(
                "window.__blockedResources=0;document.addEventListener('securitypolicyviolation',"
                "()=>{window.__blockedResources+=1;});"
            )
            page = context.new_page()
            page.set_default_timeout(15000)
            page.on("console", on_console)
            page.goto(RENDER_ORIGIN, wait_until="load")
            page.add_style_tag(
                content="*,*::before,*::after {animation:none!important;transition:none!important;"
                "caret-color:transparent!important;content-visibility:visible!important}"
            )
            result["error"] = None
            try:
                # 与生产 worker 共用检查代码；不主动 load、重试或重新声明字体影响结果。
                page.evaluate(_READY_JS)
            except Exception as exc:
                result["error"] = str(exc).splitlines()[0][:1500]
            result["fonts"] = page.evaluate(_FONTS_JS)
            result["font_count"] = page.evaluate("document.fonts.size")
            result["all_fonts_loaded"] = page.evaluate(
                "document.fonts.size > 0 && [...document.fonts].every(f=>f.status==='loaded')"
            )
            result["sources"] = font_sources(page.evaluate(_SOURCES_JS))
            result["csp_violations"] = page.evaluate("window.__blockedResources")
            result["passed"] = not (
                result["error"] or result["blocked_requests"] or result["csp_violations"]
            )
        finally:
            browser.close()
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "html", type=Path, nargs="+", help="Original fragment and optional candidates"
    )
    parser.add_argument("--repeat", type=int, choices=range(1, 31), default=5, metavar="N")
    parser.add_argument("--output", type=Path, help="Write full JSON evidence to this new file")
    parser.add_argument(
        "--full-document", action="store_true", help="Inputs are source.html documents"
    )
    parser.add_argument("--width", type=int, choices=range(360, 1201), default=800, metavar="PX")
    parser.add_argument("--scale", type=int, choices=range(1, 5), default=3)
    parser.add_argument("--probe", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.probe:
        try:
            result = probe(
                args.html[0], full_document=args.full_document, width=args.width, scale=args.scale
            )
        except Exception as exc:
            result = {"passed": False, "error": str(exc).splitlines()[0][:1500]}
        print(json.dumps(result, ensure_ascii=False))
        return 0

    psutil = importlib.import_module("psutil")

    if args.output and (args.output.exists() or args.output.is_symlink()):
        parser.error("--output must be a new file; existing evidence is not overwritten")
    results = []
    for run in range(1, args.repeat + 1):
        for path in args.html:
            command = [
                sys.executable,
                str(Path(__file__).resolve()),
                str(path.resolve()),
                "--probe",
                "--width",
                str(args.width),
                "--scale",
                str(args.scale),
            ]
            if args.full_document:
                command.append("--full-document")
            # 每轮都是新的 Python/Playwright/Chromium，避免复用探针页或浏览器缓存。
            process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                start_new_session=sys.platform != "win32",
            )
            try:
                stdout, _ = process.communicate(timeout=60)
                result = json.loads(stdout)
            except subprocess.TimeoutExpired:
                _stop_worker(process, psutil)
                result = {"passed": False, "error": "Probe exceeded 60 seconds"}
            except (ValueError, UnicodeError):
                result = {"passed": False, "error": "Probe process failed without a JSON report"}
            result.update(path=str(path), run=run)
            results.append(result)
            print(json.dumps(result, ensure_ascii=False), flush=True)
    if args.output:
        with args.output.open("x", encoding="utf-8") as handle:
            json.dump(results, handle, ensure_ascii=False, indent=2)
    return int(any(not result["passed"] for result in results))


if __name__ == "__main__":
    raise SystemExit(main())
