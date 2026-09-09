"""主会话排队输入与运行中补充指令协议。"""

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class ChatInputRequest(BaseModel):
    request_id: str = Field(min_length=1, max_length=128)
    message: str = Field(min_length=1, max_length=20000)
    mode: Literal["queue", "steer"]
    target_run_id: str | None = Field(default=None, min_length=1, max_length=128)
    thinking_enabled: bool = False

    @field_validator("message")
    @classmethod
    def nonempty_message(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Message must not be blank")
        return value

    @model_validator(mode="after")
    def validate_target(self) -> "ChatInputRequest":
        if self.mode == "steer" and not self.target_run_id:
            raise ValueError("steer requires target_run_id")
        if self.mode == "queue" and self.target_run_id is not None:
            raise ValueError("queue must not specify target_run_id")
        return self


class ChatInput(BaseModel):
    id: str
    session_id: str
    request_id: str
    message: str
    mode: Literal["queue", "steer"]
    status: Literal["pending", "running", "applied", "completed", "cancelled", "failed"]
    target_run_id: str | None = None
    run_id: str | None = None
    created_at: str
    updated_at: str
    error: str | None = None


class ChatInputList(BaseModel):
    inputs: list[ChatInput] = Field(default_factory=list)
    input_queue_paused: bool = False
