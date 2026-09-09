"""本地制图输入协议；模型和直接工具调用共用同一校验。"""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


class RenderSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    as_of: str = Field(min_length=1, max_length=200)
    sources: list[str] = Field(min_length=1, max_length=30)
    data: dict[str, Any]


class RenderImageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    html: str | None = Field(default=None, min_length=1, max_length=2_000_000)
    html_path: str | None = Field(default=None, min_length=1, max_length=4096)
    logical_width: int = Field(default=800, ge=360, le=1200)
    scale: int = Field(default=3, ge=1, le=4)
    snapshot: RenderSnapshot | None = None

    @model_validator(mode="after")
    def one_source(self) -> "RenderImageRequest":
        if (self.html is None) == (self.html_path is None):
            raise ValueError("Provide exactly one of html or html_path")
        if self.html is not None and not self.html.strip():
            raise ValueError("html must not be blank")
        return self
