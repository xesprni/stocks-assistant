"""技能系统 API

提供技能列表、启用/禁用切换、刷新和 ClawHub 浏览安装接口。
"""

from http import HTTPStatus
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query

from app.config import get_settings
from app.constants.security import Permission
from app.constants.skills import CLAW_HUB_MAX_SEARCH_LIMIT, CLAW_HUB_SEARCH_LIMIT
from app.core.security import CurrentUser, require_permissions
from app.core.skills.clawhub import ClawHubError, ClawHubService
from app.deps import get_skill_manager
from app.schemas.common import RefreshResponse
from app.schemas.skills import (
    ClawHubInstallRequest,
    ClawHubInstallResponse,
    ClawHubSearchResponse,
    ClawHubSkillDetail,
    SkillDeleteResponse,
    SkillInfo,
    SkillListResponse,
    SkillToggleRequest,
    SkillToggleResponse,
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
def list_skills(
    _: CurrentUser = Depends(require_permissions(Permission.SKILLS_READ)),
) -> SkillListResponse:
    mgr = get_skill_manager()
    skills = mgr.list_skills()
    skills_config = mgr.get_skills_config()
    return SkillListResponse(
        skills=[
            SkillInfo(
                name=s.skill.name,
                description=s.skill.description,
                enabled=mgr.is_skill_enabled(s.skill.name),
                file_path=s.skill.file_path,
                source=skills_config.get(s.skill.name, {}).get("source") or s.skill.source,
                clawhub_slug=skills_config.get(s.skill.name, {}).get("clawhub_slug"),
                clawhub_version=skills_config.get(s.skill.name, {}).get("clawhub_version"),
                clawhub_owner=skills_config.get(s.skill.name, {}).get("clawhub_owner"),
                clawhub_url=skills_config.get(s.skill.name, {}).get("clawhub_url"),
            )
            for s in skills
        ],
        total=len(skills),
    )


@router.get("/clawhub/search", response_model=ClawHubSearchResponse)
def search_clawhub_skills(
    q: str = Query(default=""),
    limit: int = Query(default=CLAW_HUB_SEARCH_LIMIT, ge=1, le=CLAW_HUB_MAX_SEARCH_LIMIT),
    _: CurrentUser = Depends(require_permissions(Permission.SKILLS_READ)),
) -> ClawHubSearchResponse:
    try:
        return get_clawhub_service().search(q, limit=limit)
    except ClawHubError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e)) from e


@router.get("/clawhub/{slug}", response_model=ClawHubSkillDetail)
def get_clawhub_skill(
    slug: str, _: CurrentUser = Depends(require_permissions(Permission.SKILLS_READ))
) -> ClawHubSkillDetail:
    try:
        return get_clawhub_service().get_detail(slug)
    except ClawHubError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e)) from e


@router.post("/clawhub/{slug}/install", response_model=ClawHubInstallResponse)
def install_clawhub_skill(
    slug: str,
    request: ClawHubInstallRequest,
    _: CurrentUser = Depends(require_permissions(Permission.SKILLS_WRITE)),
) -> ClawHubInstallResponse:
    try:
        return get_clawhub_service().install(slug, version=request.version, tag=request.tag)
    except ClawHubError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e)) from e


@router.post("/{name}/toggle")
def toggle_skill(
    name: str,
    request: SkillToggleRequest,
    _: CurrentUser = Depends(require_permissions(Permission.SKILLS_WRITE)),
) -> SkillToggleResponse:
    mgr = get_skill_manager()
    try:
        mgr.set_skill_enabled(name, request.enabled)
        return SkillToggleResponse(name=name, enabled=request.enabled)
    except Exception as e:
        raise HTTPException(status_code=HTTPStatus.NOT_FOUND, detail=str(e)) from e


@router.delete("/{name}")
def delete_skill(
    name: str, _: CurrentUser = Depends(require_permissions(Permission.SKILLS_WRITE))
) -> SkillDeleteResponse:
    mgr = get_skill_manager()
    try:
        deleted_path = mgr.delete_skill(name)
        return SkillDeleteResponse(name=name, deleted_path=deleted_path)
    except PermissionError as e:
        raise HTTPException(status_code=HTTPStatus.FORBIDDEN, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=HTTPStatus.NOT_FOUND, detail=str(e)) from e


@router.post("/refresh")
def refresh_skills(
    _: CurrentUser = Depends(require_permissions(Permission.SKILLS_WRITE)),
) -> RefreshResponse:
    mgr = get_skill_manager()
    mgr.refresh_skills()
    return RefreshResponse(total=len(mgr.skills))
