"""仅供 JSON、工具协议和存储适配边界使用的模型序列化。"""

from typing import Any

from pydantic import BaseModel


def to_payload(value: Any) -> Any:
    """递归输出 JSON 数据；不向领域模型添加字典兼容接口。"""
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, dict):
        return {key: to_payload(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_payload(item) for item in value]
    return value
