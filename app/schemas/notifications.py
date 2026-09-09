"""通知附件的共享参数约束。"""

from typing import Annotated, Any

from pydantic import Field, StringConstraints, TypeAdapter

TelegramPhotoSource = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4096)
]
TelegramPhotos = Annotated[list[TelegramPhotoSource], Field(max_length=10)]
_photos_adapter = TypeAdapter(TelegramPhotos)


def validate_telegram_photos(value: Any) -> list[str]:
    """元数据与显式参数共用约束；本地文件在执行时检查，允许任务先生成图片。"""
    return _photos_adapter.validate_python(value)
