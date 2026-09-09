"""技能系统 API Schema"""

from typing import Any

from pydantic import BaseModel, Field


class SkillInfo(BaseModel):
    """技能信息"""

    name: str  # 技能名称
    description: str  # 技能描述
    enabled: bool  # 是否启用
    file_path: str | None = None  # 技能文件路径
    source: str | None = None
    clawhub_slug: str | None = None
    clawhub_version: str | None = None
    clawhub_owner: str | None = None
    clawhub_url: str | None = None


class SkillListResponse(BaseModel):
    """技能列表响应"""

    skills: list[SkillInfo]  # 技能列表
    total: int  # 总数


class SkillToggleRequest(BaseModel):
    """技能启用/禁用请求"""

    enabled: bool  # 目标状态


class ClawHubSearchResult(BaseModel):
    slug: str
    name: str
    summary: str = ""
    description: str = ""
    owner: str | None = None
    version: str | None = None
    updated_at: str | None = None
    canonical_url: str | None = None
    scan_status: str | None = None
    moderation_status: str | None = None


class ClawHubSearchResponse(BaseModel):
    results: list[ClawHubSearchResult]
    total: int


class ClawHubSkillDetail(ClawHubSearchResult):
    scan: dict[str, Any] = Field(default_factory=dict)
    skill_md: str = ""
    preview_error: str | None = None
    scan_error: str | None = None


class ClawHubInstallRequest(BaseModel):
    version: str | None = None
    tag: str | None = None


class ClawHubInstallResponse(BaseModel):
    status: str
    message: str
    installed_path: str
    skill: SkillInfo
