"""技能系统 API Schema"""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class SkillInfo(BaseModel):
    """技能信息"""
    name: str  # 技能名称
    description: str  # 技能描述
    enabled: bool  # 是否启用
    file_path: Optional[str] = None  # 技能文件路径
    source: Optional[str] = None
    clawhub_slug: Optional[str] = None
    clawhub_version: Optional[str] = None
    clawhub_owner: Optional[str] = None
    clawhub_url: Optional[str] = None


class SkillListResponse(BaseModel):
    """技能列表响应"""
    skills: List[SkillInfo]  # 技能列表
    total: int  # 总数


class SkillToggleRequest(BaseModel):
    """技能启用/禁用请求"""
    enabled: bool  # 目标状态


class ClawHubSearchResult(BaseModel):
    slug: str
    name: str
    summary: str = ""
    description: str = ""
    owner: Optional[str] = None
    version: Optional[str] = None
    updated_at: Optional[str] = None
    canonical_url: Optional[str] = None
    scan_status: Optional[str] = None
    moderation_status: Optional[str] = None


class ClawHubSearchResponse(BaseModel):
    results: List[ClawHubSearchResult]
    total: int


class ClawHubSkillDetail(ClawHubSearchResult):
    scan: Dict[str, Any] = Field(default_factory=dict)
    skill_md: str = ""
    preview_error: Optional[str] = None
    scan_error: Optional[str] = None


class ClawHubInstallRequest(BaseModel):
    version: Optional[str] = None
    tag: Optional[str] = None


class ClawHubInstallResponse(BaseModel):
    status: str
    message: str
    installed_path: str
    skill: SkillInfo
