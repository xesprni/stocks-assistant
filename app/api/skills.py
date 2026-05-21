"""技能系统 API

提供技能列表、启用/禁用切换、刷新和 ClawHub 浏览安装接口。
"""

from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from app.config import get_settings
from app.core.skills.clawhub import ClawHubError, ClawHubService
from app.deps import get_skill_manager
from app.schemas.skills import (
    ClawHubInstallRequest,
    ClawHubInstallResponse,
    ClawHubSearchResponse,
    ClawHubSkillDetail,
    SkillListResponse,
    SkillToggleRequest,
)

router = APIRouter()


def get_clawhub_service() -> ClawHubService:
    settings = get_settings()
    skills_dir = Path(settings.workspace_dir).expanduser() / "skills"
    return ClawHubService(
        registry_url=settings.clawhub_registry_url,
        skills_dir=skills_dir,
        skill_manager=get_skill_manager(),
    )


@router.get("", response_model=SkillListResponse)
async def list_skills():
    mgr = get_skill_manager()
    skills = mgr.list_skills()
    skills_config = mgr.get_skills_config()
    return SkillListResponse(
        skills=[
            {
                "name": s.skill.name,
                "description": s.skill.description,
                "enabled": mgr.is_skill_enabled(s.skill.name),
                "file_path": s.skill.file_path,
                "source": skills_config.get(s.skill.name, {}).get("source") or s.skill.source,
                "clawhub_slug": skills_config.get(s.skill.name, {}).get("clawhub_slug"),
                "clawhub_version": skills_config.get(s.skill.name, {}).get("clawhub_version"),
                "clawhub_owner": skills_config.get(s.skill.name, {}).get("clawhub_owner"),
                "clawhub_url": skills_config.get(s.skill.name, {}).get("clawhub_url"),
            }
            for s in skills
        ],
        total=len(skills),
    )


@router.get("/clawhub/search", response_model=ClawHubSearchResponse)
async def search_clawhub_skills(q: str = Query(default=""), limit: int = Query(default=20, ge=1, le=50)):
    try:
        return get_clawhub_service().search(q, limit=limit)
    except ClawHubError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


@router.get("/clawhub/{slug}", response_model=ClawHubSkillDetail)
async def get_clawhub_skill(slug: str):
    try:
        return get_clawhub_service().get_detail(slug)
    except ClawHubError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


@router.post("/clawhub/{slug}/install", response_model=ClawHubInstallResponse)
async def install_clawhub_skill(slug: str, request: ClawHubInstallRequest):
    try:
        return get_clawhub_service().install(slug, version=request.version, tag=request.tag)
    except ClawHubError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


@router.post("/{name}/toggle")
async def toggle_skill(name: str, request: SkillToggleRequest):
    mgr = get_skill_manager()
    try:
        mgr.set_skill_enabled(name, request.enabled)
        return {"status": "ok", "name": name, "enabled": request.enabled}
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/{name}")
async def delete_skill(name: str):
    mgr = get_skill_manager()
    try:
        deleted_path = mgr.delete_skill(name)
        return {"status": "ok", "name": name, "deleted_path": deleted_path}
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/refresh")
async def refresh_skills():
    mgr = get_skill_manager()
    mgr.refresh_skills()
    return {"status": "ok", "total": len(mgr.skills)}
