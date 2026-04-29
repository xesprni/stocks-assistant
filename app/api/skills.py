"""技能系统 API

提供技能列表、启用/禁用切换和刷新接口。
"""

from fastapi import APIRouter, Depends, HTTPException

from app.schemas.skills import SkillListResponse, SkillToggleRequest
from app.deps import get_skill_manager

router = APIRouter()


@router.get("", response_model=SkillListResponse)
async def list_skills():
    mgr = get_skill_manager()
    skills = mgr.list_skills()
    return SkillListResponse(
        skills=[
            {
                "name": s.skill.name,
                "description": s.skill.description,
                "enabled": s.enabled,
                "file_path": s.skill.file_path,
            }
            for s in skills
        ],
        total=len(skills),
    )


@router.post("/{name}/toggle")
async def toggle_skill(name: str, request: SkillToggleRequest):
    mgr = get_skill_manager()
    try:
        mgr.toggle_skill(name, request.enabled)
        return {"status": "ok", "name": name, "enabled": request.enabled}
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/refresh")
async def refresh_skills():
    mgr = get_skill_manager()
    mgr.refresh_skills()
    return {"status": "ok", "total": len(mgr.skills)}
