"""Model-facing delegation arguments; graph and policy checks run before any child starts."""

from typing import Any

from pydantic import ConfigDict, Field, field_validator

from app.constants.agent import (
    MAX_DEPENDS_ON_LENGTH,
    MAX_ID_LENGTH,
    MAX_MAX_STEPS,
    MAX_ROLE_LENGTH,
    MAX_SHARED_CONTEXT_LENGTH,
    MAX_SKILL_FILTER_LENGTH,
    MAX_TASK_LENGTH,
    MAX_TASKS_LENGTH,
    MAX_TOOLS_LENGTH,
)
from app.schemas.base import AppModel as BaseModel


class DelegatedTask(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    id: str | None = Field(default=None, min_length=1, max_length=MAX_ID_LENGTH)
    role: str = Field(min_length=1, max_length=MAX_ROLE_LENGTH)
    task: str = Field(min_length=1, max_length=MAX_TASK_LENGTH)
    tools: list[str] | None = Field(default=None, max_length=MAX_TOOLS_LENGTH)
    max_steps: int | None = Field(default=None, ge=1, le=MAX_MAX_STEPS)
    skill_filter: list[str] | None = Field(default=None, max_length=MAX_SKILL_FILTER_LENGTH)
    depends_on: list[str] = Field(default_factory=list, max_length=MAX_DEPENDS_ON_LENGTH)

    @field_validator("id", "role", "task")
    @classmethod
    def nonblank(cls, value: str | None) -> str | None:
        if value is not None:
            value = value.strip()
            if not value:
                raise ValueError("must not be blank")
        return value

    @field_validator("tools", "skill_filter", "depends_on")
    @classmethod
    def unique_names(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        normalized = [name.strip() for name in value]
        if any(not name or len(name) > 200 for name in normalized):
            raise ValueError("names must contain between 1 and 200 characters")
        if len(set(normalized)) != len(normalized):
            raise ValueError("names must not contain duplicates")
        return normalized


class DelegateAgentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    tasks: list[DelegatedTask] = Field(min_length=1, max_length=MAX_TASKS_LENGTH)
    shared_context: str = Field(
        default="",
        max_length=MAX_SHARED_CONTEXT_LENGTH,
        description="Shared facts, data snapshot, sources, constraints and objective for all tasks; no automatic conversation-history copying.",
    )


class SubAgentResult(BaseModel):
    task_id: str
    role: str
    status: str
    final_response: str
    duration_ms: float
    depends_on: list[str]
    error: str | None
    # 工具扩展元数据经过统一清洗，字段集合由不同工具协议决定。
    evidence: list[dict[str, Any]] = Field(default_factory=list)
    sources: list[dict[str, Any]] = Field(default_factory=list)
    rendered_images: list[dict[str, Any]] = Field(default_factory=list)


class SubAgentBatchResult(BaseModel):
    batch_id: str
    status: str
    duration_ms: float
    counts: dict[str, int]
    results: list[SubAgentResult]
