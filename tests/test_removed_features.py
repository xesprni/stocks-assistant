"""退役功能的接口、配置和旧配置兼容回归。"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import router
from app.api.config import _settings_to_response
from app.config import Settings
from app.schemas.config import AppConfig, ConfigUpdate


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/research/quick-prompts"),
        ("GET", "/research/security/AAPL.US/summary"),
        ("POST", "/research/security/AAPL.US/theses"),
        ("POST", "/research/security/AAPL.US/documents/upload"),
        ("GET", "/alerts/events"),
        ("POST", "/alerts/evaluate-live"),
        ("GET", "/labs/valuation/models"),
        ("POST", "/labs/portfolio/analyze"),
        ("POST", "/labs/ai/stream"),
        ("GET", "/news/guardian/feed"),
        ("GET", "/news/guardian/article"),
        ("POST", "/news/guardian/translate"),
    ],
)
def test_removed_endpoints_are_not_registered(method, path):
    application = FastAPI()
    application.include_router(router)
    with TestClient(application) as client:
        assert client.request(method, f"/api/v1{path}").status_code == 404


def test_old_feature_settings_are_ignored_without_removing_general_chat_settings():
    # 旧数据库中的字段不再进入有效配置、API 响应或新的配置写入。
    obsolete = {"guardian_api_key": "legacy-secret", "research_quick_prompts_refresh_seconds": 600}
    settings = Settings(**obsolete, llm_model="retained-model")
    assert settings.llm_model == "retained-model"
    assert not obsolete.keys() & settings.model_dump().keys()
    assert not obsolete.keys() & AppConfig.model_fields.keys()
    assert not {"guardian_api_key_masked", "has_guardian_api_key"} & AppConfig.model_fields.keys()
    assert ConfigUpdate(**obsolete).model_dump(exclude_unset=True) == {}
    response = _settings_to_response(
        settings, personal_keys={*obsolete, "llm_model"}, hide_inherited_personal=True
    )
    assert response.personal_config_keys == ["llm_model"]
    assert "legacy-secret" not in response.model_dump_json()


def test_general_chat_knowledge_news_and_scheduler_routes_remain():
    application = FastAPI()
    application.include_router(router)
    paths = set(application.openapi()["paths"])
    assert {
        "/api/v1/agent/stream",
        "/api/v1/knowledge/tree",
        "/api/v1/news",
        "/api/v1/scheduler/tasks",
        "/api/v1/watchlist/groups",
        "/api/v1/portfolio",
    } <= paths
