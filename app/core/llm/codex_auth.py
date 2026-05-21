"""Resolve local Codex ChatGPT OAuth credentials.

Codex CLI stores ChatGPT-managed OAuth credentials in ``$CODEX_HOME/auth.json``
after ``codex login``. This module reads that local login state and returns only
the bearer material needed for an upstream request; callers must never expose
the token contents to the frontend.
"""

from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULT_CODEX_HOME = "~/.codex"
DEFAULT_CODEX_AUTH_PATH = "auth.json"


class CodexAuthError(RuntimeError):
    """Raised when usable Codex OAuth credentials cannot be resolved."""


@dataclass(frozen=True)
class CodexOAuthCredentials:
    access_token: str
    account_id: str
    auth_path: Path


def default_codex_auth_path() -> Path:
    codex_home = os.getenv("CODEX_HOME") or DEFAULT_CODEX_HOME
    return Path(codex_home).expanduser() / DEFAULT_CODEX_AUTH_PATH


def resolve_codex_oauth(auth_file: str | None = None) -> CodexOAuthCredentials:
    """Load Codex ChatGPT OAuth credentials from the local auth file."""
    path = Path(auth_file).expanduser() if auth_file else default_codex_auth_path()
    if not path.is_file():
        raise CodexAuthError(f"Codex OAuth credentials not found at {path}. Run `codex login` first.")

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise CodexAuthError(f"Codex auth file is not valid JSON: {path}") from exc

    tokens = data.get("tokens") if isinstance(data.get("tokens"), dict) else {}
    access_token = _first_str(tokens.get("access_token"), data.get("access_token"))
    if not access_token:
        raise CodexAuthError(f"Codex auth file does not contain a ChatGPT OAuth access token: {path}")

    account_id = _first_str(tokens.get("account_id"), data.get("account_id"))
    if not account_id:
        account_id = _extract_account_id_from_jwt(access_token)
    if not account_id:
        raise CodexAuthError(f"Codex auth file does not contain a ChatGPT account id: {path}")

    return CodexOAuthCredentials(access_token=access_token, account_id=account_id, auth_path=path)


def inspect_codex_oauth(auth_file: str | None = None) -> dict[str, str | bool]:
    """Return non-secret Codex OAuth status for configuration UI."""
    try:
        credentials = resolve_codex_oauth(auth_file)
    except CodexAuthError as exc:
        return {
            "available": False,
            "account_id": "",
            "auth_path": str(Path(auth_file).expanduser() if auth_file else default_codex_auth_path()),
            "error": str(exc),
        }
    return {
        "available": True,
        "account_id": credentials.account_id,
        "auth_path": str(credentials.auth_path),
        "error": "",
    }


def _first_str(*values: Any) -> str:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _extract_account_id_from_jwt(token: str) -> str:
    parts = token.split(".")
    if len(parts) < 2:
        return ""
    payload = parts[1]
    padding = "=" * (-len(payload) % 4)
    try:
        decoded = base64.urlsafe_b64decode((payload + padding).encode("ascii"))
        claims = json.loads(decoded.decode("utf-8"))
    except Exception:
        return ""

    candidate_keys = (
        "https://api.openai.com/auth.chatgpt_account_id",
        "chatgpt_account_id",
        "account_id",
        "workspace_id",
    )
    for key in candidate_keys:
        value = claims.get(key)
        if isinstance(value, str) and value:
            return value
    return ""
