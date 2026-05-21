import base64
import json
import tempfile
import unittest
from pathlib import Path

from app.core.llm.codex_auth import CodexAuthError, inspect_codex_oauth, resolve_codex_oauth


def write_auth(root: Path, payload: dict) -> Path:
    path = root / "auth.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def fake_jwt(claims: dict) -> str:
    header = base64.urlsafe_b64encode(json.dumps({"alg": "none"}).encode()).decode().rstrip("=")
    payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=")
    return f"{header}.{payload}."


class CodexAuthTest(unittest.TestCase):
    def test_resolves_current_codex_nested_tokens_shape(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = write_auth(
                Path(tmp),
                {
                    "auth_mode": "chatgpt",
                    "tokens": {
                        "access_token": "oauth-access",
                        "account_id": "workspace-123",
                        "refresh_token": "refresh",
                    },
                },
            )

            credentials = resolve_codex_oauth(str(path))

        self.assertEqual(credentials.access_token, "oauth-access")
        self.assertEqual(credentials.account_id, "workspace-123")

    def test_extracts_account_id_from_access_token_when_missing(self):
        token = fake_jwt({"https://api.openai.com/auth.chatgpt_account_id": "workspace-from-jwt"})
        with tempfile.TemporaryDirectory() as tmp:
            path = write_auth(Path(tmp), {"tokens": {"access_token": token}})

            credentials = resolve_codex_oauth(str(path))

        self.assertEqual(credentials.account_id, "workspace-from-jwt")

    def test_inspect_codex_oauth_does_not_expose_secret_token(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = write_auth(Path(tmp), {"tokens": {"access_token": "secret-token", "account_id": "workspace-123"}})

            status = inspect_codex_oauth(str(path))

        self.assertTrue(status["available"])
        self.assertEqual(status["account_id"], "workspace-123")
        self.assertNotIn("secret-token", json.dumps(status))

    def test_missing_auth_file_raises_clear_error(self):
        with self.assertRaisesRegex(CodexAuthError, "Run `codex login` first"):
            resolve_codex_oauth("/tmp/not-a-real-codex-auth.json")


if __name__ == "__main__":
    unittest.main()
