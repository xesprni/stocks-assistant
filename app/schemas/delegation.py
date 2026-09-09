"""Model-facing delegation arguments; graph and policy checks run before any child starts."""

from pydantic import BaseModel, ConfigDict, Field, field_validator


class DelegatedTask(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    id: str | None = Field(default=None, min_length=1, max_length=80)
    role: str = Field(min_length=1, max_length=100)
    task: str = Field(min_length=1, max_length=16000)
    tools: list[str] | None = Field(default=None, max_length=100)
    max_steps: int | None = Field(default=None, ge=1, le=100)
    skill_filter: list[str] | None = Field(default=None, max_length=100)
    depends_on: list[str] = Field(default_factory=list, max_length=31)

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

    tasks: list[DelegatedTask] = Field(min_length=1, max_length=32)
    shared_context: str = Field(
        default="",
        max_length=24000,
        description="Shared facts, data snapshot, sources, constraints and objective for all tasks; no automatic conversation-history copying.",
    )
