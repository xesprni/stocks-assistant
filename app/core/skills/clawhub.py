"""ClawHub read-only browsing and safe skill installation."""

from __future__ import annotations

import io
import re
import shutil
import stat
import tempfile
from pathlib import Path, PurePosixPath
from typing import Any, Dict, Iterable, List, Optional, Tuple
from zipfile import BadZipFile, ZipFile, ZipInfo

import httpx

from app.core.skills.manager import SkillManager


CLAW_HUB_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
MAX_ARCHIVE_BYTES = 50 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024


class ClawHubError(Exception):
    status_code = 500


class ClawHubValidationError(ClawHubError):
    status_code = 400


class ClawHubConflictError(ClawHubError):
    status_code = 409


class ClawHubUpstreamError(ClawHubError):
    status_code = 502


class ClawHubArchiveError(ClawHubError):
    status_code = 422


def _first_string(data: Dict[str, Any], keys: Iterable[str]) -> Optional[str]:
    for key in keys:
        value = data.get(key)
        if value is None:
            continue
        if isinstance(value, str):
            stripped = value.strip()
            if stripped:
                return stripped
        elif isinstance(value, (int, float, bool)):
            return str(value)
    return None


def _normalize_owner(value: Any) -> Optional[str]:
    if isinstance(value, str):
        return value.strip() or None
    if isinstance(value, dict):
        return _first_string(value, ("username", "login", "handle", "slug", "name", "id"))
    return None


def _nested_version(value: Any) -> Optional[str]:
    if isinstance(value, dict):
        return _first_string(value, ("version", "tag", "name"))
    if isinstance(value, str):
        return value.strip() or None
    return None


def _collection_from_response(payload: Any) -> List[Dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ("results", "items", "skills", "data"):
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
        if isinstance(value, dict):
            nested = _collection_from_response(value)
            if nested:
                return nested
    return []


def _object_from_response(payload: Any) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    for key in ("skill", "item", "data"):
        value = payload.get(key)
        if isinstance(value, dict):
            return value
    return payload


def _safe_relative_zip_path(name: str) -> PurePosixPath:
    normalized = name.replace("\\", "/")
    path = PurePosixPath(normalized)
    if path.is_absolute():
        raise ClawHubArchiveError("Archive contains an absolute path")
    if not path.parts:
        raise ClawHubArchiveError("Archive contains an empty path")
    if any(part in {"", ".", ".."} for part in path.parts):
        raise ClawHubArchiveError("Archive contains an unsafe path")
    return path


def _is_zip_symlink(info: ZipInfo) -> bool:
    mode = info.external_attr >> 16
    return stat.S_IFMT(mode) == stat.S_IFLNK


class ClawHubService:
    def __init__(
        self,
        registry_url: str,
        skills_dir: Path,
        skill_manager: SkillManager,
        timeout: float = 20.0,
    ):
        self.registry_url = registry_url.rstrip("/") or "https://clawhub.ai"
        self.skills_dir = skills_dir.expanduser()
        self.skill_manager = skill_manager
        self.timeout = timeout

    def search(self, query: str, limit: int = 20) -> Dict[str, Any]:
        query = query.strip()
        if not query:
            return {"results": [], "total": 0}

        safe_limit = max(1, min(limit, 50))
        payload = self._get_json(
            "/api/v1/search",
            params={
                "q": query,
                "limit": str(safe_limit),
                "nonSuspiciousOnly": "true",
            },
        )
        results = [self._normalize_skill_item(item) for item in _collection_from_response(payload)]
        results = [item for item in results if item.get("slug")]
        return {"results": results, "total": len(results)}

    def get_detail(self, slug: str) -> Dict[str, Any]:
        self._validate_slug(slug)
        raw_payload = self._get_json(f"/api/v1/skills/{slug}")
        raw_detail = _object_from_response(raw_payload)
        detail = self._normalize_skill_item(raw_detail)
        detail["slug"] = detail.get("slug") or slug

        scan: Dict[str, Any] = {}
        scan_error: Optional[str] = None
        try:
            raw_scan = self._get_json(f"/api/v1/skills/{slug}/scan")
            if isinstance(raw_scan, dict):
                scan = raw_scan
        except ClawHubError as exc:
            scan_error = str(exc)

        skill_md = ""
        preview_error: Optional[str] = None
        try:
            skill_md = self._get_text(f"/api/v1/skills/{slug}/file", params={"path": "SKILL.md"})
        except ClawHubError as exc:
            preview_error = str(exc)

        detail.update(
            {
                "scan": scan,
                "scan_status": self._scan_status(scan),
                "moderation_status": self._moderation_status(raw_detail, scan),
                "skill_md": skill_md,
                "preview_error": preview_error,
                "scan_error": scan_error,
            }
        )
        return detail

    def install(self, slug: str, version: Optional[str] = None, tag: Optional[str] = None) -> Dict[str, Any]:
        self._validate_slug(slug)
        target = self.skills_dir / slug
        if target.exists():
            raise ClawHubConflictError(f"Skill '{slug}' is already installed")

        metadata = self._fetch_install_metadata(slug)
        archive_bytes = self._download_archive(slug=slug, version=version, tag=tag)
        self._extract_archive(archive_bytes, target)

        self.skill_manager.refresh_skills()
        entry = self._find_installed_entry(target)
        if entry is None:
            shutil.rmtree(target, ignore_errors=True)
            self.skill_manager.refresh_skills()
            raise ClawHubArchiveError("Archive did not contain a valid skill definition")

        installed_version = version or tag or metadata.get("version")
        canonical_url = metadata.get("canonical_url")
        owner = metadata.get("owner")

        self.skill_manager.update_skill_config(
            entry.skill.name,
            {
                "enabled": False,
                "source": "clawhub",
                "clawhub_slug": slug,
                "clawhub_version": installed_version,
                "clawhub_owner": owner,
                "clawhub_url": canonical_url,
            },
        )
        config_entry = self.skill_manager.get_skills_config().get(entry.skill.name, {})

        return {
            "status": "ok",
            "message": "Installed. The skill is disabled until you enable it manually.",
            "installed_path": str(target),
            "skill": {
                "name": entry.skill.name,
                "description": entry.skill.description,
                "enabled": False,
                "file_path": entry.skill.file_path,
                "source": config_entry.get("source"),
                "clawhub_slug": config_entry.get("clawhub_slug"),
                "clawhub_version": config_entry.get("clawhub_version"),
                "clawhub_owner": config_entry.get("clawhub_owner"),
                "clawhub_url": config_entry.get("clawhub_url"),
            },
        }

    def _normalize_skill_item(self, raw: Dict[str, Any]) -> Dict[str, Any]:
        slug = _first_string(raw, ("slug", "skillSlug", "packageSlug", "id", "name"))
        owner = _normalize_owner(raw.get("owner") or raw.get("author") or raw.get("publisher"))
        version = (
            _nested_version(raw.get("version"))
            or _first_string(raw, ("latestVersion", "latest_version", "tag"))
        )
        canonical_url = _first_string(raw, ("canonicalUrl", "canonical_url", "url", "homepage"))
        if not canonical_url and slug:
            canonical_url = f"{self.registry_url}/skills/{slug}"

        return {
            "slug": slug,
            "name": _first_string(raw, ("displayName", "display_name", "title", "name")) or slug or "",
            "summary": _first_string(raw, ("summary", "description", "shortDescription", "short_description")) or "",
            "description": _first_string(raw, ("description", "summary", "readme")) or "",
            "owner": owner,
            "version": version,
            "updated_at": _first_string(raw, ("updatedAt", "updated_at", "publishedAt", "published_at", "createdAt", "created_at")),
            "canonical_url": canonical_url,
            "scan_status": self._scan_status(raw),
            "moderation_status": self._moderation_status(raw),
        }

    def _fetch_install_metadata(self, slug: str) -> Dict[str, Any]:
        try:
            raw_detail = self._get_json(f"/api/v1/skills/{slug}")
            if isinstance(raw_detail, dict):
                return self._normalize_skill_item(_object_from_response(raw_detail))
        except ClawHubError:
            return {}
        return {}

    def _download_archive(self, slug: str, version: Optional[str] = None, tag: Optional[str] = None) -> bytes:
        params = {"slug": slug}
        if version:
            params["version"] = version
        if tag:
            params["tag"] = tag

        with httpx.Client(timeout=self.timeout, follow_redirects=True) as client:
            try:
                response = client.get(self._api_url("/api/v1/download"), params=params)
                response.raise_for_status()
                content_type = response.headers.get("content-type", "")
                if "application/json" in content_type:
                    payload = response.json()
                    download_url = _first_string(payload, ("downloadUrl", "download_url", "url", "href"))
                    if download_url:
                        response = client.get(self._absolute_url(download_url))
                        response.raise_for_status()
                content = response.content
            except httpx.HTTPStatusError as exc:
                raise ClawHubUpstreamError(f"ClawHub download failed with HTTP {exc.response.status_code}") from exc
            except httpx.HTTPError as exc:
                raise ClawHubUpstreamError(f"ClawHub download failed: {exc}") from exc

        if len(content) > MAX_ARCHIVE_BYTES:
            raise ClawHubArchiveError("Archive is too large")
        return content

    def _extract_archive(self, archive_bytes: bytes, target: Path):
        self.skills_dir.mkdir(parents=True, exist_ok=True)
        if target.exists():
            raise ClawHubConflictError(f"Skill '{target.name}' is already installed")

        try:
            with ZipFile(io.BytesIO(archive_bytes)) as archive:
                members = self._validated_members(archive)
                strip_prefix = self._skill_root_prefix(members)
                temp_root = Path(tempfile.mkdtemp(prefix=f".{target.name}-", dir=self.skills_dir))
                try:
                    for info, path in members:
                        rel_parts = path.parts[len(strip_prefix):] if strip_prefix else path.parts
                        if not rel_parts:
                            continue
                        destination = temp_root.joinpath(*rel_parts)
                        self._ensure_within(destination, temp_root)
                        if info.is_dir():
                            destination.mkdir(parents=True, exist_ok=True)
                            continue
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        with archive.open(info) as source, open(destination, "wb") as output:
                            shutil.copyfileobj(source, output)

                    if not (temp_root / "SKILL.md").is_file():
                        raise ClawHubArchiveError("Archive does not contain SKILL.md")
                    temp_root.replace(target)
                except Exception:
                    shutil.rmtree(temp_root, ignore_errors=True)
                    raise
        except BadZipFile as exc:
            raise ClawHubArchiveError("Downloaded file is not a valid zip archive") from exc

    def _validated_members(self, archive: ZipFile) -> List[Tuple[ZipInfo, PurePosixPath]]:
        members: List[Tuple[ZipInfo, PurePosixPath]] = []
        total_size = 0
        for info in archive.infolist():
            if _is_zip_symlink(info):
                raise ClawHubArchiveError("Archive contains a symbolic link")
            path = _safe_relative_zip_path(info.filename)
            total_size += info.file_size
            if total_size > MAX_UNCOMPRESSED_BYTES:
                raise ClawHubArchiveError("Archive expands to too much data")
            members.append((info, path))
        if not members:
            raise ClawHubArchiveError("Archive is empty")
        return members

    def _skill_root_prefix(self, members: List[Tuple[ZipInfo, PurePosixPath]]) -> Tuple[str, ...]:
        skill_files = [path for info, path in members if not info.is_dir() and path.name == "SKILL.md"]
        if not skill_files:
            raise ClawHubArchiveError("Archive does not contain SKILL.md")
        root_skill_files = [path for path in skill_files if len(path.parts) == 1]
        if root_skill_files:
            return ()
        if len(skill_files) != 1:
            raise ClawHubArchiveError("Archive contains multiple nested SKILL.md files")
        return skill_files[0].parent.parts

    def _find_installed_entry(self, target: Path):
        target_resolved = target.resolve()
        for entry in self.skill_manager.list_skills():
            if not entry.skill.file_path:
                continue
            try:
                skill_path = Path(entry.skill.file_path).resolve()
            except OSError:
                continue
            if skill_path == target_resolved / "SKILL.md" or target_resolved in skill_path.parents:
                return entry
        return None

    def _get_json(self, path: str, params: Optional[Dict[str, str]] = None) -> Any:
        with httpx.Client(timeout=self.timeout, follow_redirects=True) as client:
            try:
                response = client.get(self._api_url(path), params=params)
                response.raise_for_status()
                return response.json()
            except httpx.HTTPStatusError as exc:
                raise ClawHubUpstreamError(f"ClawHub request failed with HTTP {exc.response.status_code}") from exc
            except httpx.HTTPError as exc:
                raise ClawHubUpstreamError(f"ClawHub request failed: {exc}") from exc
            except ValueError as exc:
                raise ClawHubUpstreamError("ClawHub returned invalid JSON") from exc

    def _get_text(self, path: str, params: Optional[Dict[str, str]] = None) -> str:
        with httpx.Client(timeout=self.timeout, follow_redirects=True) as client:
            try:
                response = client.get(self._api_url(path), params=params)
                response.raise_for_status()
                content_type = response.headers.get("content-type", "")
                if "application/json" in content_type:
                    payload = response.json()
                    if isinstance(payload, dict):
                        content = payload.get("content") or payload.get("text")
                        if isinstance(content, str):
                            return content
                        data = payload.get("data")
                        if isinstance(data, dict):
                            nested = data.get("content") or data.get("text")
                            if isinstance(nested, str):
                                return nested
                return response.text
            except httpx.HTTPStatusError as exc:
                raise ClawHubUpstreamError(f"ClawHub file preview failed with HTTP {exc.response.status_code}") from exc
            except httpx.HTTPError as exc:
                raise ClawHubUpstreamError(f"ClawHub file preview failed: {exc}") from exc
            except ValueError as exc:
                raise ClawHubUpstreamError("ClawHub returned invalid file preview JSON") from exc

    def _api_url(self, path: str) -> str:
        return f"{self.registry_url}{path if path.startswith('/') else f'/{path}'}"

    def _absolute_url(self, url: str) -> str:
        if url.startswith("http://") or url.startswith("https://"):
            return url
        return self._api_url(url)

    def _scan_status(self, data: Any) -> Optional[str]:
        if not isinstance(data, dict):
            return None
        direct = _first_string(data, ("scanStatus", "scan_status", "status", "verdict", "risk", "riskLevel", "risk_level"))
        if direct:
            return direct
        scan = data.get("scan")
        if isinstance(scan, dict):
            return self._scan_status(scan)
        security = data.get("security")
        if isinstance(security, dict):
            return self._scan_status(security)
        return None

    def _moderation_status(self, *sources: Any) -> Optional[str]:
        for source in sources:
            if not isinstance(source, dict):
                continue
            direct = _first_string(source, ("moderationStatus", "moderation_status", "moderation", "reviewStatus", "review_status"))
            if direct:
                return direct
            moderation = source.get("moderation")
            if isinstance(moderation, dict):
                nested = _first_string(moderation, ("status", "verdict", "risk", "riskLevel", "risk_level"))
                if nested:
                    return nested
                if moderation.get("isPendingScan"):
                    return "pending"
                if moderation.get("isMalwareBlocked") or moderation.get("isHiddenByMod") or moderation.get("isRemoved"):
                    return "blocked"
                if moderation.get("isSuspicious"):
                    return "suspicious"
                if any(key in moderation for key in ("isPendingScan", "isMalwareBlocked", "isHiddenByMod", "isRemoved", "isSuspicious")):
                    return "clear"
        return None

    def _validate_slug(self, slug: str):
        if not CLAW_HUB_SLUG_RE.fullmatch(slug):
            raise ClawHubValidationError("Invalid ClawHub skill slug")

    def _ensure_within(self, path: Path, root: Path):
        try:
            path.resolve().relative_to(root.resolve())
        except ValueError as exc:
            raise ClawHubArchiveError("Archive writes outside the target directory") from exc
