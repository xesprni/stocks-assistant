"""本地制图输入协议；模型和直接工具调用共用同一校验。"""

from typing import Any

from pydantic import ConfigDict, Field, model_validator

from app.constants.rendering import (
    DEFAULT_LOGICAL_WIDTH,
    DEFAULT_SCALE,
    MAX_AS_OF_LENGTH,
    MAX_HTML_PATH_LENGTH,
    MAX_LOGICAL_WIDTH,
    MAX_SCALE,
    MAX_SOURCE_BYTES,
    MAX_SOURCES_LENGTH,
    MIN_LOGICAL_WIDTH,
)
from app.schemas.base import AppModel as BaseModel


class RenderSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    as_of: str = Field(min_length=1, max_length=MAX_AS_OF_LENGTH)
    sources: list[str] = Field(min_length=1, max_length=MAX_SOURCES_LENGTH)
    data: dict[str, Any]


class RenderImageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    html: str | None = Field(default=None, min_length=1, max_length=MAX_SOURCE_BYTES)
    html_path: str | None = Field(default=None, min_length=1, max_length=MAX_HTML_PATH_LENGTH)
    logical_width: int = Field(
        default=DEFAULT_LOGICAL_WIDTH, ge=MIN_LOGICAL_WIDTH, le=MAX_LOGICAL_WIDTH
    )
    scale: int = Field(default=DEFAULT_SCALE, ge=1, le=MAX_SCALE)
    snapshot: RenderSnapshot | None = None

    @model_validator(mode="after")
    def one_source(self) -> "RenderImageRequest":
        if (self.html is None) == (self.html_path is None):
            raise ValueError("Provide exactly one of html or html_path")
        if self.html is not None and not self.html.strip():
            raise ValueError("html must not be blank")
        return self


class RenderChecks(BaseModel):
    fonts_ready: bool
    images_decoded: bool
    native_resolution: bool
    network_requests_blocked: bool
    scripts_disabled: bool
    visual_inspection_completed: bool


class RenderWorkerResult(BaseModel):
    width: int
    height: int
    logical_height: int
    layout: dict[str, Any]
    render_checks: RenderChecks


class VisualReview(BaseModel):
    status: str
    checklist: list[str]
    fix_order: list[str]
    instruction: str


class RenderImageResult(RenderWorkerResult):
    artifact_id: str
    image_path: str
    files: dict[str, str]
    source_path: str
    manifest_path: str
    snapshot_path: str | None
    snapshot_sha256: str | None
    document_sha256: str
    created_at: str
    format: str
    logical_width: int
    scale: int
    visual_review: VisualReview
    snapshot_consistency: str
