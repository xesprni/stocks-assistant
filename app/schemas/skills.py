"""技能系统 API Schema"""

from typing import List, Optional

from pydantic import BaseModel


class SkillInfo(BaseModel):
    """技能信息"""
    name: str  # 技能名称
    description: str  # 技能描述
    enabled: bool  # 是否启用
    file_path: Optional[str] = None  # 技能文件路径


class SkillListResponse(BaseModel):
    """技能列表响应"""
    skills: List[SkillInfo]  # 技能列表
    total: int  # 总数


class SkillToggleRequest(BaseModel):
    """技能启用/禁用请求"""
    enabled: bool  # 目标状态
