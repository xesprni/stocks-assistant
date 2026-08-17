"""隐私优先的本地产品事件。"""

from typing import Any

from pydantic import BaseModel, Field, field_validator


class ProductEventRequest(BaseModel):
    event: str = Field(min_length=1, max_length=64, pattern=r"^[a-z][a-z0-9_]*$")
    properties: dict[str, Any] = Field(default_factory=dict)

    @field_validator("properties")
    @classmethod
    def sanitize_properties(cls, value: dict[str, Any]) -> dict[str, Any]:
        if len(value) > 20:
            raise ValueError("too many event properties")
        sanitized: dict[str, Any] = {}
        for key, item in value.items():
            normalized_key = str(key)[:48]
            lowered_key = normalized_key.lower()
            if any(token in lowered_key for token in ("prompt", "content", "response", "symbol", "ticker", "url", "query")):
                raise ValueError("event properties cannot contain research content or identifiers")
            if isinstance(item, (bool, int, float)) or item is None:
                sanitized[normalized_key] = item
            elif isinstance(item, str):
                sanitized[normalized_key] = item[:100]
            else:
                raise ValueError("event properties must be scalar values")
        return sanitized


class ProductEventResponse(BaseModel):
    accepted: bool
