"""Bounded local rendering jobs with immutable, user-scoped artifacts."""

from __future__ import annotations

import contextlib
import hashlib
import importlib.util
import json
import logging
import os
import signal
import subprocess
import sys
import tempfile
import threading
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.core.rendering.document import MAX_SOURCE_BYTES, canonical_json, prepare_document
from app.core.rendering.layout import CROWDING_FIX_ORDER, VISUAL_CHECKLIST
from app.core.tools.paths import resolve_workspace_path
from app.schemas.rendering import RenderImageRequest

logger = logging.getLogger("stocks-assistant.rendering")
_RENDER_SLOTS = threading.BoundedSemaphore(2)
INSTALL_HELP = (
    "Local rendering requires Playwright, Pillow and Chromium. "
    "Run: uv sync --extra rendering; uv run playwright install chromium. "
    "On Linux install Chromium system dependencies and fonts-noto-cjk "
    "(uv run playwright install --with-deps chromium)."
)


def _stop_worker(process: subprocess.Popen[bytes], process_module: Any) -> None:
    """先让 Playwright 清理浏览器，再强制回收独立进程组中的后代。"""
    tracked: dict[tuple[int, float], Any] = {}
    with contextlib.suppress(process_module.Error):
        parent = process_module.Process(process.pid)
        tracked[(parent.pid, parent.create_time())] = parent

    def capture_descendants() -> None:
        for parent in list(tracked.values()):
            with contextlib.suppress(process_module.Error):
                for child in parent.children(recursive=True):
                    tracked[(child.pid, child.create_time())] = child

    # Chromium 会被 Playwright 放进独立进程组，单独 killpg(worker) 并不能覆盖它。
    capture_descendants()
    if os.name == "nt":
        with contextlib.suppress(OSError):
            process.terminate()
    else:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGTERM)
    try:
        process.communicate(timeout=3)
    except subprocess.TimeoutExpired:
        pass
    finally:
        capture_descendants()
        # psutil 的进程对象校验创建时间，避免清理等待期间误杀复用同一 PID 的进程。
        for child in reversed(list(tracked.values())):
            with contextlib.suppress(process_module.Error):
                child.kill()
        if os.name != "nt":
            with contextlib.suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
        else:
            with contextlib.suppress(OSError):
                process.kill()
        with contextlib.suppress(process_module.Error):
            process_module.wait_procs(list(tracked.values()), timeout=1)
        try:
            process.communicate(timeout=3)
        except subprocess.TimeoutExpired:
            # 管道或失控后代不能把 60 秒制图期限变成无期限等待。
            if process.stdout is not None:
                process.stdout.close()
            if process.stderr is not None:
                process.stderr.close()


def _run_worker(request_path: Path) -> dict[str, Any]:
    try:
        psutil = importlib.import_module("psutil")
    except ImportError:
        raise RuntimeError(INSTALL_HELP) from None
    # 独立进程隔离浏览器生命周期；超时优先触发 Node 的正常浏览器清理。
    process = subprocess.Popen(
        [sys.executable, "-m", "app.core.rendering.worker", str(request_path)],
        cwd=Path(__file__).resolve().parents[3],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=os.name != "nt",
    )
    try:
        stdout, _stderr = process.communicate(timeout=60)
    except subprocess.TimeoutExpired:
        _stop_worker(process, psutil)
        raise RuntimeError("Rendering exceeded 60 seconds; simplify or split the report") from None
    try:
        result = json.loads(stdout)
    except (ValueError, UnicodeError):
        raise RuntimeError(f"Rendering worker failed. {INSTALL_HELP}") from None
    if process.returncode or not isinstance(result, dict) or result.get("error"):
        detail = (
            result.get("error", "worker failed") if isinstance(result, dict) else "worker failed"
        )
        raise RuntimeError(f"Rendering failed: {detail}")
    return result


class RenderImageService:
    def __init__(self, workspace_dir: str):
        self.workspace = Path(workspace_dir).expanduser().resolve()

    def render(self, request: RenderImageRequest) -> dict[str, Any]:
        fragment = request.html
        if fragment is None:
            path = resolve_workspace_path(self.workspace, request.html_path or "")
            if not path.is_file() or path.stat().st_size > MAX_SOURCE_BYTES:
                raise ValueError("html_path must be a workspace file no larger than 2 MB")
            # 有界读取，防止校验大小后文件增长导致无限分配。
            with path.open("rb") as source:
                raw = source.read(MAX_SOURCE_BYTES + 1)
            if len(raw) > MAX_SOURCE_BYTES:
                raise ValueError("HTML exceeds the 2 MB limit")
            fragment = raw.decode("utf-8")
        document, snapshot_hash = prepare_document(fragment, request.snapshot)
        if any(importlib.util.find_spec(name) is None for name in ("playwright", "PIL")):
            raise RuntimeError(INSTALL_HELP)
        if not _RENDER_SLOTS.acquire(blocking=False):
            raise RuntimeError("Two render jobs are already running; retry after one finishes")
        try:
            return self._render(request, document, snapshot_hash)
        finally:
            _RENDER_SLOTS.release()

    def _render(
        self, request: RenderImageRequest, document: str, snapshot_hash: str | None
    ) -> dict[str, Any]:
        artifact_id = uuid.uuid4().hex
        # 与图片下载接口共用无符号链接的产物约定，避免成功生成却无法预览。
        for directory in (self.workspace / "artifacts", self.workspace / "artifacts/renderings"):
            if directory.is_symlink():
                raise ValueError(
                    "Rendering directories cannot be symbolic links outside workspace or inside it"
                )
        base = resolve_workspace_path(self.workspace, "artifacts/renderings")
        base.mkdir(parents=True, exist_ok=True)
        final_dir = resolve_workspace_path(self.workspace, f"artifacts/renderings/{artifact_id}")
        # 临时目录完成所有检查后才发布；失败不会留下可误用的半张 PNG。
        with tempfile.TemporaryDirectory(prefix=".render-", dir=base) as scratch:
            work = Path(scratch)
            (work / "source.html").write_text(document, encoding="utf-8")
            if request.snapshot is not None:
                (work / "snapshot.json").write_text(
                    canonical_json(request.snapshot.model_dump()), encoding="utf-8"
                )
            job_path = work / "job.json"
            job_path.write_text(
                canonical_json({"logical_width": request.logical_width, "scale": request.scale}),
                encoding="utf-8",
            )
            rendered = _run_worker(job_path)
            relative_dir = final_dir.relative_to(self.workspace).as_posix()
            result = {
                "artifact_id": artifact_id,
                "image_path": f"{relative_dir}/image.png",
                "files": {
                    key: f"{relative_dir}/{key}.png"
                    for key in ("image", "top", "middle", "bottom", "mobile")
                },
                "source_path": f"{relative_dir}/source.html",
                "manifest_path": f"{relative_dir}/manifest.json",
                "snapshot_path": f"{relative_dir}/snapshot.json" if snapshot_hash else None,
                "snapshot_sha256": snapshot_hash,
                "document_sha256": hashlib.sha256(document.encode("utf-8")).hexdigest(),
                "created_at": datetime.now(UTC).isoformat(),
                "format": "png",
                "logical_width": request.logical_width,
                "scale": request.scale,
                **rendered,
                "visual_review": {
                    "status": "required",
                    "checklist": VISUAL_CHECKLIST,
                    "fix_order": CROWDING_FIX_ORDER,
                    "instruction": (
                        "Call view_image on files.image, files.top, files.middle, files.bottom and "
                        "files.mobile. Crops are cut from the final PNG without rescaling. "
                        "mobile is a 390px viewing simulation of the same PNG, not a new layout. "
                        "Review the complete image as well as the crops; split very long reports. "
                        "Do not claim checks passed until the images have actually been inspected."
                    ),
                },
                "snapshot_consistency": "requires_review" if snapshot_hash else "not_provided",
            }
            (work / "manifest.json").write_text(
                json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            job_path.unlink()
            work.rename(final_dir)
        logger.info(
            "Rendered artifact %s (%s x %s)", artifact_id, result["width"], result["height"]
        )
        return result
