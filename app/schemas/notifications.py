"""通知附件的共享参数约束。"""

from typing import Annotated, Any

from pydantic import Field, StringConstraints, TypeAdapter

from app.constants.notifications import (
    TELEGRAM_PHOTO_LIMIT,
    TELEGRAM_PHOTO_SOURCE_MAX_LENGTH,
)
from app.schemas.base import AppModel as BaseModel

TelegramPhotoSource = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, min_length=1, max_length=TELEGRAM_PHOTO_SOURCE_MAX_LENGTH
    ),
]
TelegramPhotos = Annotated[list[TelegramPhotoSource], Field(max_length=TELEGRAM_PHOTO_LIMIT)]
_photos_adapter = TypeAdapter(TelegramPhotos)


def validate_telegram_photos(value: Any) -> list[str]:
    """元数据与显式参数共用约束；本地文件在执行时检查，允许任务先生成图片。"""
    return _photos_adapter.validate_python(value)


class TelegramDelivery(BaseModel):
    ok: bool
    chunks: int = 0
    photos: int = 0
    responses: list[dict[str, Any]] = Field(default_factory=list)
    skipped: bool = False
    reason: str | None = None
