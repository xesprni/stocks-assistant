import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import skills as skills_api
from app.core.skills.clawhub import ClawHubConflictError
from app.core.security import CurrentUser, get_current_user


class FakeClawHubService:
    def __init__(self):
        self.search_args = None
        self.install_args = None

    def search(self, q: str, limit: int):
        self.search_args = (q, limit)
        return {
            "results": [
                {
                    "slug": "research",
                    "name": "Research",
                    "summary": "Research helper",
                    "description": "Research helper",
                }
            ],
            "total": 1,
        }

    def get_detail(self, slug: str):
        return {
            "slug": slug,
            "name": "Research",
            "summary": "Research helper",
            "description": "Research helper",
            "scan": {"status": "passed"},
            "skill_md": "---\nname: research\n---\n",
        }

    def install(self, slug: str, version: str | None = None, tag: str | None = None):
        self.install_args = (slug, version, tag)
        return {
            "status": "ok",
            "message": "installed",
            "installed_path": "/tmp/skills/research",
            "skill": {
                "name": "research",
                "description": "Research helper",
                "enabled": False,
                "file_path": "/tmp/skills/research/SKILL.md",
                "source": "clawhub",
                "clawhub_slug": slug,
                "clawhub_version": version,
            },
        }


class ClawHubApiTest(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(skills_api.router, prefix="/api/v1/skills")
        app.dependency_overrides[get_current_user] = lambda: CurrentUser(
            id="admin",
            username="admin",
            display_name="Admin",
            roles=("admin",),
            permissions=frozenset({"*"}),
            is_active=True,
        )
        self.client = TestClient(app)

    def test_search_route_uses_clawhub_service(self):
        service = FakeClawHubService()
        with patch.object(skills_api, "get_clawhub_service", return_value=service):
            response = self.client.get("/api/v1/skills/clawhub/search?q=research&limit=3")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(service.search_args, ("research", 3))
        self.assertEqual(response.json()["results"][0]["slug"], "research")

    def test_install_route_maps_conflict_errors(self):
        class ConflictService(FakeClawHubService):
            def install(self, slug: str, version: str | None = None, tag: str | None = None):
                raise ClawHubConflictError("already installed")

        with patch.object(skills_api, "get_clawhub_service", return_value=ConflictService()):
            response = self.client.post("/api/v1/skills/clawhub/research/install", json={})

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["detail"], "already installed")


if __name__ == "__main__":
    unittest.main()
