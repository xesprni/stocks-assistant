"""Server font diagnostics preserve input and report bounded source evidence."""

from __future__ import annotations

import base64
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path
from types import ModuleType
from unittest.mock import Mock

import pytest

from app.core.rendering.document import prepare_document

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/diagnose_render_fonts.py"


@pytest.fixture
def diagnostics() -> ModuleType:
    spec = importlib.util.spec_from_file_location("render_font_diagnostics", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_font_sources_hash_decoded_bytes_without_returning_payload_or_resource_urls(
    diagnostics: ModuleType,
) -> None:
    raw = b"\x00\x01\x00\x00synthetic-font-evidence"
    encoded = base64.b64encode(raw).decode("ascii")
    # CSS data URI 可有百分号编码和 base64 空白，摘要应对应解码后的原始字节。
    escaped = f"{encoded[:12]}%20{encoded[12:]}".replace("=", "%3D")
    source = (
        f'url("data:font/ttf;base64,{escaped}") format("truetype"), '
        "url('https://private.invalid/fonts/secret.ttf'), url(file:///private/font.ttf)"
    )
    result = diagnostics.font_sources(
        [{"family": "EvidenceFont", "weight": "700", "style": "normal", "src": source}]
    )

    assert result == [
        {
            "family": "EvidenceFont",
            "weight": "700",
            "style": "normal",
            "formats": ['"truetype"'],
            "resources": [
                {
                    "inline": True,
                    "mime": "font/ttf",
                    "base64_valid": True,
                    "bytes": len(raw),
                    "sha256": hashlib.sha256(raw).hexdigest(),
                    "signature": "00010000",
                },
                {"inline": False},
                {"inline": False},
            ],
        }
    ]
    report = json.dumps(result)
    for private_value in (encoded, escaped, "data:", "private.invalid", "file:", "secret.ttf"):
        assert private_value not in report


@pytest.mark.parametrize(
    "url",
    [
        "data:font/ttf;base64,%%%",
        "data:font/ttf;base64,YQ",
        "data:font/ttf;base64,非ASCII",
        "data:font/ttf,plain-text",
        "data:font/ttf;base64",
    ],
    ids=["invalid-alphabet", "invalid-padding", "non-ascii", "not-base64", "missing-comma"],
)
def test_font_sources_report_invalid_base64_without_raising_or_hashing(
    diagnostics: ModuleType, url: str
) -> None:
    result = diagnostics.font_sources([{"family": "Broken", "src": f'url("{url}")'}])
    resource = result[0]["resources"][0]

    assert resource == {"inline": True, "mime": "font/ttf", "base64_valid": False}
    assert url not in json.dumps(result)


def test_repeat_starts_a_separate_probe_process_for_each_input_and_run(
    diagnostics: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    paths = [tmp_path / "original.html", tmp_path / "candidate.html"]
    for path in paths:
        path.write_text("<p>Unchanged input</p>", encoding="utf-8")
    processes = [Mock() for _ in range(4)]
    for index, process in enumerate(processes):
        process.communicate.return_value = (
            json.dumps({"passed": True, "probe": index}).encode(),
            b"",
        )
    popen = Mock(side_effect=processes)
    monkeypatch.setattr(diagnostics.subprocess, "Popen", popen)
    monkeypatch.setattr(
        diagnostics, "probe", Mock(side_effect=AssertionError("Must isolate probe"))
    )
    monkeypatch.setattr(
        sys,
        "argv",
        [str(SCRIPT), *(str(path) for path in paths), "--repeat", "2", "--full-document"],
    )

    assert diagnostics.main() == 0

    reports = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert [(report["path"], report["run"]) for report in reports] == [
        (str(path), run) for run in (1, 2) for path in paths
    ]
    assert [report["probe"] for report in reports] == list(range(4))
    assert popen.call_count == 4
    for call, path, process in zip(popen.call_args_list, paths * 2, processes, strict=True):
        command = call.args[0]
        assert command[:3] == [sys.executable, str(SCRIPT), str(path.resolve())]
        assert "--probe" in command
        assert "--full-document" in command
        assert "--repeat" not in command
        assert call.kwargs["start_new_session"] is (sys.platform != "win32")
        process.communicate.assert_called_once_with(timeout=60)
    for path in paths:
        assert path.read_text(encoding="utf-8") == "<p>Unchanged input</p>"


@pytest.mark.skipif(
    os.environ.get("RUN_RENDERING_BROWSER_TESTS") != "1",
    reason="Set RUN_RENDERING_BROWSER_TESTS=1 after installing rendering extras and Chromium",
)
def test_full_document_cli_repeats_failed_weight_and_ots_without_font_payload(
    tmp_path: Path,
) -> None:
    font = (Path(__file__).with_name("fixtures") / "rendering-font.ttf").read_bytes()
    valid = base64.b64encode(font).decode("ascii")
    invalid = base64.b64encode(b"deliberately-invalid-font").decode("ascii")
    faces = "".join(
        f"@font-face{{font-family:ServerFont;font-weight:{weight};"
        f'src:url("data:font/ttf;base64,{invalid if weight == 700 else valid}") '
        'format("truetype")}'
        for weight in (400, 500, 700)
    )
    text = "".join(
        f'<p style="font-family:ServerFont;font-weight:{weight}">A</p>'
        for weight in (400, 500, 700)
    )
    document, _ = prepare_document(f"<style>{faces}</style>{text}", None)
    source = tmp_path / "source.html"
    source.write_text(document, encoding="utf-8")
    output = tmp_path / "evidence.json"
    completed = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            str(source),
            "--full-document",
            "--repeat",
            "2",
            "--output",
            str(output),
        ],
        capture_output=True,
        text=True,
        timeout=150,
        check=False,
    )

    assert completed.returncode == 1, completed.stderr
    reports = json.loads(output.read_text(encoding="utf-8"))
    assert reports == [json.loads(line) for line in completed.stdout.splitlines()]
    assert [report["run"] for report in reports] == [1, 2]
    for report in reports:
        assert report["passed"] is False
        assert report["all_fonts_loaded"] is False
        assert report["blocked_requests"] == report["csp_violations"] == 0
        assert report["font_count"] == 3
        assert {face["weight"]: face["status"] for face in report["fonts"]} == {
            "400": "loaded",
            "500": "loaded",
            "700": "error",
        }
        assert '"weight":"700"' in report["error"]
        assert any(line.startswith("OTS parsing error:") for line in report["font_console"])
        assert (
            report["input_sha256"]
            == report["document_sha256"]
            == hashlib.sha256(document.encode("utf-8")).hexdigest()
        )
        assert report["chromium"]
        assert report["playwright"]
        assert report["python"]
    for payload in (valid, invalid, "data:"):
        assert payload not in completed.stdout
        assert payload not in output.read_text(encoding="utf-8")
    assert source.read_text(encoding="utf-8") == document
