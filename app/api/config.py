"""应用配置管理 API。"""

import json
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

import app.config as config_module
from app.config import Settings, get_settings
from app.schemas.config import AppConfig, ConfigUpdate

router = APIRouter()

CONFIG_PATH = Path("config.json")


def _mask_secret(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}{'*' * 8}{value[-4:]}"


def _settings_to_response(settings: Settings) -> AppConfig:
    return AppConfig(
        llm_api_base=settings.llm_api_base,
        llm_model=settings.llm_model,
        llm_api_key_masked=_mask_secret(settings.llm_api_key),
        has_llm_api_key=bool(settings.llm_api_key),
        embedding_api_base=settings.embedding_api_base,
        embedding_model=settings.embedding_model,
        embedding_provider=settings.embedding_provider,
        embedding_api_key_masked=_mask_secret(settings.embedding_api_key),
        has_embedding_api_key=bool(settings.embedding_api_key),
        workspace_dir=settings.workspace_dir,
        agent_max_steps=settings.agent_max_steps,
        agent_max_context_tokens=settings.agent_max_context_tokens,
        agent_max_context_turns=settings.agent_max_context_turns,
        knowledge_enabled=settings.knowledge_enabled,
        memory_enabled=settings.memory_enabled,
        scheduler_enabled=settings.scheduler_enabled,
        debug=settings.debug,
        system_prompt=settings.system_prompt,
        mcp_servers=settings.mcp_servers,
    )


def _read_config_file() -> Dict[str, Any]:
    if not CONFIG_PATH.exists():
        return {}
    try:
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f"config.json 格式错误: {exc}") from exc


def _write_config_file(data: Dict[str, Any]) -> None:
    CONFIG_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


@router.get("", response_model=AppConfig)
async def get_config():
    """读取当前应用配置。"""
    return _settings_to_response(get_settings())


@router.put("", response_model=AppConfig)
async def update_config(update: ConfigUpdate):
    """更新并持久化应用配置。"""
    patch = update.model_dump(exclude_unset=True)
    current = _read_config_file()
    merged = {**current, **patch}

    try:
        validated = Settings(**{k: v for k, v in merged.items() if v != ""})
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc

    _write_config_file(merged)
    config_module._config_instance = validated
    return _settings_to_response(validated)
