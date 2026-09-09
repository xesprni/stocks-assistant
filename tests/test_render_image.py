import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.config import DEFAULT_AGENT_TOOL_ALLOWLIST, Settings
from app.core.rendering import service
from app.core.rendering.document import prepare_document
from app.core.tools.render_image import RenderImageTool
from app.core.tools.tool_manager import ToolManager
from app.schemas.rendering import RenderImageRequest, RenderSnapshot


@pytest.mark.parametrize(
    "arguments",
    [
        {},
        {"html": "x", "html_path": "x.html"},
        {"html": " "},
        {"html": "x", "scale": True},
        {"html": "x", "scale": 1.5},
        {"html": "x", "logical_width": 0},
        {"html": "x", "output_path": "../outside.png"},
    ],
)
def test_render_input_is_strict(arguments):
    with pytest.raises(ValidationError):
        RenderImageRequest.model_validate(arguments)


@pytest.mark.parametrize(
    "html",
    [
        "<script>alert(1)</script>",
        '<iframe src="file:///etc/passwd"></iframe>',
        '<img src="https://example.com/image.png">',
        '<img src="file:///etc/passwd">',
        '<svg><image href="../secret.png" /></svg>',
        '<img srcset="https://example.com/a.png 1x">',
        '<svg onload="fetch(1)"></svg>',
        '<meta http-equiv="refresh" content="0;url=http://localhost">',
        "<svg><foreignObject><p>x</p></foreignObject></svg>",
        '<svg><animate attributeName="x" values="0;200" /></svg>',
        "<canvas></canvas>",
        "<html><body>full document</body></html>",
    ],
)
def test_active_content_and_resource_escapes_rejected(html):
    with pytest.raises(ValueError):
        prepare_document(html, None)


def test_snapshot_is_canonical_and_source_text_is_escaped():
    snapshot = RenderSnapshot(as_of="2026-09-09", sources=["<script>bad</script>"], data={"值": 12})
    document, digest = prepare_document('<h1>标题</h1><svg><use href="#local" /></svg>', snapshot)
    assert "&lt;script&gt;bad&lt;/script&gt;" in document
    assert "<h1>标题</h1>" in document
    assert digest and len(digest) == 64
    assert digest == prepare_document("<p>排版改变不应改变数据摘要</p>", snapshot)[1]
    with pytest.raises(ValueError, match="JSON compliant"):
        prepare_document("<p>x</p>", snapshot.model_copy(update={"data": {"value": float("nan")}}))


def test_render_rejects_oversized_and_excessive_html():
    for html in ["中" * 700_000, "<span>x</span>" * 5001]:
        with pytest.raises(ValueError):
            prepare_document(html, None)


def test_workspace_input_and_output_symlinks_cannot_escape(tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    outside = tmp_path / "secret.html"
    outside.write_text("<p>secret</p>")
    (workspace / "linked.html").symlink_to(outside)
    tool = RenderImageTool(str(workspace))
    for html_path in ["../secret.html", str(outside), "linked.html"]:
        result = tool.execute({"html_path": html_path})
        assert result.status == "error"
        assert "outside workspace" in result.result


def test_missing_dependencies_are_actionable_without_creating_outputs(tmp_path, monkeypatch):
    monkeypatch.setattr(service.importlib.util, "find_spec", lambda name: None)
    result = RenderImageTool(str(tmp_path)).execute({"html": "<p>报告</p>"})
    assert result.status == "error"
    assert "uv sync --extra rendering" in result.result
    assert not (tmp_path / "artifacts").exists()


def test_artifacts_are_unique_and_manifest_records_review_required(tmp_path, monkeypatch):
    monkeypatch.setattr(service.importlib.util, "find_spec", lambda name: True)

    def worker(job_path: Path):
        job = json.loads(job_path.read_text())
        assert job == {"logical_width": 800, "scale": 3}
        assert "<h1>同一数据快照</h1>" in (job_path.parent / "source.html").read_text()
        for name in ("image", "top", "middle", "bottom", "mobile"):
            (job_path.parent / f"{name}.png").write_bytes(b"fake tested separately in browser")
        return {"width": 2400, "height": 3000, "layout": {"issues": []}}

    monkeypatch.setattr(service, "_run_worker", worker)
    tool = RenderImageTool(str(tmp_path))
    arguments = {
        "html": "<h1>同一数据快照</h1>",
        "snapshot": {"as_of": "2026-09-09", "sources": ["模拟数据"], "data": {"revenue": 128}},
    }
    result = tool.execute(arguments)
    assert result.status == "success"
    artifact = result.result
    assert artifact["width"] == 2400
    assert artifact["visual_review"]["status"] == "required"
    assert artifact["snapshot_consistency"] == "requires_review"
    assert json.loads((tmp_path / artifact["manifest_path"]).read_text()) == artifact
    assert json.loads((tmp_path / artifact["snapshot_path"]).read_text())["data"]["revenue"] == 128
    assert tool.execute(arguments).result["artifact_id"] != artifact["artifact_id"]
    assert not list((tmp_path / "artifacts/renderings").glob(".render-*"))


def test_failure_removes_partial_artifacts_and_releases_capacity(tmp_path, monkeypatch):
    monkeypatch.setattr(service.importlib.util, "find_spec", lambda name: True)

    def fail(job_path):
        (job_path.parent / "image.png").write_bytes(b"partial")
        raise RuntimeError("render failed")

    monkeypatch.setattr(service, "_run_worker", fail)
    for _ in range(3):
        result = RenderImageTool(str(tmp_path)).execute({"html": "<p>test</p>"})
        assert result.status == "error"
        assert result.result == "render failed"
    assert list((tmp_path / "artifacts/renderings").iterdir()) == []


def test_output_root_cannot_be_symlinked_outside_workspace(tmp_path, monkeypatch):
    monkeypatch.setattr(service.importlib.util, "find_spec", lambda name: True)
    workspace = tmp_path / "workspace"
    outside = tmp_path / "outside"
    workspace.mkdir()
    outside.mkdir()
    (workspace / "artifacts").symlink_to(outside, target_is_directory=True)
    result = RenderImageTool(str(workspace)).execute({"html": "<p>test</p>"})
    assert result.status == "error"
    assert "outside workspace" in result.result
    assert list(outside.iterdir()) == []


def test_output_root_cannot_be_symlinked_inside_workspace(tmp_path, monkeypatch):
    monkeypatch.setattr(service.importlib.util, "find_spec", lambda name: True)
    (tmp_path / "real-artifacts").mkdir()
    (tmp_path / "artifacts").symlink_to(tmp_path / "real-artifacts", target_is_directory=True)
    result = RenderImageTool(str(tmp_path)).execute({"html": "<p>test</p>"})
    assert result.status == "error"
    assert "symbolic links" in result.result
    assert list((tmp_path / "real-artifacts").iterdir()) == []


def test_tools_register_lazily_with_user_workspace(tmp_path, monkeypatch):
    monkeypatch.setattr(service.importlib.util, "find_spec", lambda name: None)
    manager = ToolManager(workspace_dir=str(tmp_path), user_id="u1")
    manager.load_builtin_tools(settings=Settings())
    schemas = manager.get_tool_schemas_for_llm()
    assert {"render_image", "view_image"} <= {schema["function"]["name"] for schema in schemas}
    assert {"render_image", "view_image"} <= set(DEFAULT_AGENT_TOOL_ALLOWLIST)
    assert manager.get_tool("render_image").service.workspace == tmp_path
    settings = Settings()
    assert "render_image" in settings.multi_agent_dangerous_tools
    assert "render_image" not in settings.multi_agent_roles["researcher"]["tool_allowlist"]
