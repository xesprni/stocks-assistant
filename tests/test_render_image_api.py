"""Rendered PNG access remains scoped to the authenticated user's workspace."""

from base64 import b64decode
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import tools as tools_api
from app.core.security import CurrentUser, get_current_user

ARTIFACT_ID = "a" * 32
PNG = b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aTXsAAAAASUVORK5CYII="
)


def _user(user_id: str, *permissions: str) -> CurrentUser:
    return CurrentUser(user_id, user_id, user_id, (), frozenset(permissions), True)


@pytest.fixture
def rendering_api(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    workspace = tmp_path / "workspace"
    monkeypatch.setattr(
        tools_api,
        "get_effective_settings",
        lambda user_id: SimpleNamespace(workspace_dir=workspace),
    )
    application = FastAPI()
    application.include_router(tools_api.router, prefix="/api/v1/tools")
    state = {"user": _user("alice", "chat:read")}
    application.dependency_overrides[get_current_user] = lambda: state["user"]
    with TestClient(application) as client:
        yield client, workspace, state, application


def _write_image(workspace: Path, user_id: str, filename: str = "image.png") -> Path:
    path = workspace / "users" / user_id / "artifacts" / "renderings" / ARTIFACT_ID / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(PNG)
    return path


@pytest.mark.parametrize(
    "filename", ["image.png", "top.png", "middle.png", "bottom.png", "mobile.png"]
)
def test_chat_reader_can_fetch_own_png(rendering_api, filename: str):
    client, workspace, _, _ = rendering_api
    _write_image(workspace, "alice", filename)
    response = client.get(f"/api/v1/tools/render-image/{ARTIFACT_ID}/{filename}")
    assert response.status_code == 200
    assert response.content == PNG
    assert response.headers["content-type"] == "image/png"
    assert response.headers["cache-control"] == "private, no-store"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_rendered_image_requires_authentication_and_chat_read(rendering_api):
    client, workspace, state, application = rendering_api
    _write_image(workspace, "alice")
    state["user"] = _user("alice", "tools:read")
    response = client.get(f"/api/v1/tools/render-image/{ARTIFACT_ID}/image.png")
    assert response.status_code == 403
    application.dependency_overrides.clear()
    response = client.get(f"/api/v1/tools/render-image/{ARTIFACT_ID}/image.png")
    assert response.status_code == 401


def test_rendered_image_cannot_be_read_by_another_user(rendering_api):
    client, workspace, state, _ = rendering_api
    _write_image(workspace, "alice")
    state["user"] = _user("bob", "chat:read")
    response = client.get(f"/api/v1/tools/render-image/{ARTIFACT_ID}/image.png")
    assert response.status_code == 404
    assert str(workspace) not in response.text


@pytest.mark.parametrize(
    ("artifact_id", "filename"),
    [
        (ARTIFACT_ID, "source.html"),
        (ARTIFACT_ID, "snapshot.json"),
        (ARTIFACT_ID, "IMAGE.PNG"),
        ("a" * 31, "image.png"),
        ("A" * 32, "image.png"),
        ("../bob", "image.png"),
        (ARTIFACT_ID, "..%2Fsource.html"),
    ],
)
def test_rendered_image_rejects_arbitrary_paths(rendering_api, artifact_id: str, filename: str):
    client, workspace, _, _ = rendering_api
    _write_image(workspace, "alice")
    response = client.get(f"/api/v1/tools/render-image/{artifact_id}/{filename}")
    assert response.status_code == 404


@pytest.mark.parametrize("level", ["users", "user", "artifacts", "renderings", "artifact", "file"])
def test_rendered_image_rejects_symbolic_links(rendering_api, level: str):
    client, workspace, _, _ = rendering_api
    source = _write_image(workspace, "alice")
    entries = {
        "users": workspace / "users",
        "user": workspace / "users" / "alice",
        "artifacts": source.parents[2],
        "renderings": source.parents[1],
        "artifact": source.parent,
        "file": source,
    }
    entry = entries[level]
    target = workspace.parent / f"private-{level}"
    entry.rename(target)
    entry.symlink_to(target, target_is_directory=target.is_dir())
    response = client.get(f"/api/v1/tools/render-image/{ARTIFACT_ID}/image.png")
    assert response.status_code == 404
    assert response.content != PNG


def test_rendered_image_missing_or_directory_returns_404(rendering_api):
    client, workspace, _, _ = rendering_api
    source = _write_image(workspace, "alice")
    source.unlink()
    assert client.get(f"/api/v1/tools/render-image/{ARTIFACT_ID}/image.png").status_code == 404
    source.mkdir()
    assert client.get(f"/api/v1/tools/render-image/{ARTIFACT_ID}/image.png").status_code == 404
