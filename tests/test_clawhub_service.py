import io
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

from app.core.skills.clawhub import (
    ClawHubArchiveError,
    ClawHubConflictError,
    ClawHubService,
    ClawHubUpstreamError,
    ClawHubValidationError,
)
from app.core.skills.manager import SkillManager


def make_zip(entries: dict[str, str]) -> bytes:
    buffer = io.BytesIO()
    with ZipFile(buffer, "w") as archive:
        for name, content in entries.items():
            archive.writestr(name, content)
    return buffer.getvalue()


def make_skill_manager(root: Path) -> SkillManager:
    builtin_dir = root / "builtin"
    custom_dir = root / "skills"
    builtin_dir.mkdir(parents=True)
    custom_dir.mkdir(parents=True)
    return SkillManager(builtin_dir=str(builtin_dir), custom_dir=str(custom_dir))


class TestableClawHubService(ClawHubService):
    def __init__(
        self,
        skills_dir: Path,
        skill_manager: SkillManager,
        json_payloads: dict[str, object] | None = None,
        text_payloads: dict[str, str] | None = None,
        archive_bytes: bytes = b"",
    ):
        super().__init__("https://clawhub.example", skills_dir, skill_manager)
        self.json_payloads = json_payloads or {}
        self.text_payloads = text_payloads or {}
        self.archive_bytes = archive_bytes
        self.json_requests: list[tuple[str, dict[str, str] | None]] = []

    def _get_json(self, path: str, params: dict[str, str] | None = None):
        self.json_requests.append((path, params))
        if path not in self.json_payloads:
            raise ClawHubUpstreamError("missing fixture")
        return self.json_payloads[path]

    def _get_text(self, path: str, params: dict[str, str] | None = None) -> str:
        return self.text_payloads[path]

    def _download_archive(self, slug: str, version: str | None = None, tag: str | None = None) -> bytes:
        return self.archive_bytes


class ClawHubServiceTest(unittest.TestCase):
    def test_search_sends_non_suspicious_filter_and_normalizes_results(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manager = make_skill_manager(root)
            service = TestableClawHubService(
                root / "skills",
                manager,
                json_payloads={
                    "/api/v1/search": {
                        "results": [
                            {
                                "slug": "market-research",
                                "displayName": "Market Research",
                                "summary": "Research helper",
                                "owner": {"username": "openclaw"},
                                "latestVersion": "1.0.0",
                            }
                        ]
                    }
                },
            )

            response = service.search("market", limit=99)

        self.assertEqual(service.json_requests[0][0], "/api/v1/search")
        self.assertEqual(service.json_requests[0][1]["nonSuspiciousOnly"], "true")
        self.assertEqual(service.json_requests[0][1]["limit"], "50")
        self.assertEqual(response["total"], 1)
        self.assertEqual(response["results"][0]["slug"], "market-research")
        self.assertEqual(response["results"][0]["owner"], "openclaw")
        self.assertEqual(response["results"][0]["version"], "1.0.0")

    def test_detail_aggregates_scan_and_skill_preview(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manager = make_skill_manager(root)
            service = TestableClawHubService(
                root / "skills",
                manager,
                json_payloads={
                    "/api/v1/skills/research": {
                        "slug": "research",
                        "name": "Research",
                        "description": "Research skill",
                        "owner": "openclaw",
                    },
                    "/api/v1/skills/research/scan": {"status": "passed", "riskLevel": "low"},
                },
                text_payloads={"/api/v1/skills/research/file": "---\nname: research\n---\n"},
            )

            detail = service.get_detail("research")

        self.assertEqual(detail["slug"], "research")
        self.assertEqual(detail["scan_status"], "passed")
        self.assertEqual(detail["scan"]["riskLevel"], "low")
        self.assertIn("name: research", detail["skill_md"])

    def test_detail_reads_nested_scan_and_moderation_status(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manager = make_skill_manager(root)
            service = TestableClawHubService(
                root / "skills",
                manager,
                json_payloads={
                    "/api/v1/skills/browser": {"slug": "browser", "name": "Browser"},
                    "/api/v1/skills/browser/scan": {
                        "security": {"status": "suspicious"},
                        "moderation": {
                            "isPendingScan": False,
                            "isMalwareBlocked": False,
                            "isHiddenByMod": False,
                            "isRemoved": False,
                            "isSuspicious": False,
                        },
                    },
                },
                text_payloads={"/api/v1/skills/browser/file": "---\nname: browser\n---\n"},
            )

            detail = service.get_detail("browser")

        self.assertEqual(detail["scan_status"], "suspicious")
        self.assertEqual(detail["moderation_status"], "clear")

    def test_install_rejects_invalid_slug(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manager = make_skill_manager(root)
            service = TestableClawHubService(root / "skills", manager)

            with self.assertRaises(ClawHubValidationError):
                service.install("../bad")

    def test_install_rejects_existing_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manager = make_skill_manager(root)
            (root / "skills" / "research").mkdir()
            service = TestableClawHubService(root / "skills", manager)

            with self.assertRaises(ClawHubConflictError):
                service.install("research")

    def test_install_rejects_path_traversal_zip(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manager = make_skill_manager(root)
            service = TestableClawHubService(
                root / "skills",
                manager,
                archive_bytes=make_zip({"../bad/SKILL.md": "---\nname: bad\ndescription: bad\n---\n"}),
            )

            with self.assertRaises(ClawHubArchiveError):
                service.install("research")

        self.assertFalse((root / "skills" / "research").exists())

    def test_install_rejects_archive_without_skill_md(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manager = make_skill_manager(root)
            service = TestableClawHubService(
                root / "skills",
                manager,
                archive_bytes=make_zip({"README.md": "missing skill"}),
            )

            with self.assertRaises(ClawHubArchiveError):
                service.install("research")

    def test_install_success_refreshes_skill_and_keeps_it_disabled(self):
        skill_md = """---
name: research-skill
description: Research skill from ClawHub
---

# Research Skill
"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manager = make_skill_manager(root)
            service = TestableClawHubService(
                root / "skills",
                manager,
                json_payloads={
                    "/api/v1/skills/research": {
                        "slug": "research",
                        "name": "Research",
                        "description": "Research skill",
                        "owner": {"username": "openclaw"},
                        "version": "1.2.3",
                        "canonicalUrl": "https://clawhub.example/skills/research",
                    }
                },
                archive_bytes=make_zip({"research-1.2.3/SKILL.md": skill_md}),
            )

            result = service.install("research", version="1.2.3")
            config = manager.get_skills_config()["research-skill"]

            self.assertTrue((root / "skills" / "research" / "SKILL.md").is_file())
            self.assertEqual(result["skill"]["name"], "research-skill")
            self.assertFalse(result["skill"]["enabled"])
            self.assertFalse(config["enabled"])
            self.assertEqual(config["source"], "clawhub")
            self.assertEqual(config["clawhub_slug"], "research")
            self.assertEqual(config["clawhub_version"], "1.2.3")
            self.assertEqual(config["clawhub_owner"], "openclaw")
            self.assertEqual(config["clawhub_url"], "https://clawhub.example/skills/research")


if __name__ == "__main__":
    unittest.main()
