import unittest

from app.config import CODEX_DEFAULT_MODEL, CODEX_OAUTH_API_BASE, EMBEDDING_DEFAULT_MODEL, Settings


class LLMModeConfigTest(unittest.TestCase):
    def test_codex_auth_mode_forces_responses_provider_and_codex_base(self):
        settings = Settings(
            llm_auth_mode="codex",
            llm_provider="openai_compatible",
            llm_api_base="https://api.openai.com/v1",
            llm_model="",
            llm_codex_model="",
        )

        self.assertEqual(settings.llm_provider, "openai_responses")
        self.assertEqual(settings.llm_auth_mode, "codex")
        self.assertEqual(settings.llm_codex_api_base, CODEX_OAUTH_API_BASE)
        self.assertEqual(settings.llm_codex_model, CODEX_DEFAULT_MODEL)

    def test_codex_backend_base_implies_codex_auth_mode(self):
        settings = Settings(
            llm_provider="openai_responses",
            llm_auth_mode="api_key",
            llm_api_base=CODEX_OAUTH_API_BASE,
        )

        self.assertEqual(settings.llm_auth_mode, "codex")

    def test_legacy_codex_base_is_moved_off_compatible_base(self):
        settings = Settings(
            llm_provider="openai_responses",
            llm_auth_mode="codex",
            llm_api_base=CODEX_OAUTH_API_BASE,
            embedding_api_base="https://api.z.ai/api/coding/paas/v4",
        )

        self.assertEqual(settings.llm_codex_api_base, CODEX_OAUTH_API_BASE)
        self.assertEqual(settings.llm_api_base, "https://api.z.ai/api/coding/paas/v4")

    def test_embedding_codex_mode_uses_independent_default_model(self):
        settings = Settings(
            embedding_auth_mode="codex",
            embedding_api_base="https://api.openai.com/v1",
            llm_api_base="https://api.z.ai/api/coding/paas/v4",
            embedding_codex_model="",
            embedding_model="text-embedding-3-large",
        )

        self.assertEqual(settings.embedding_auth_mode, "codex")
        self.assertEqual(settings.embedding_codex_api_base, CODEX_OAUTH_API_BASE)
        self.assertEqual(settings.embedding_codex_model, EMBEDDING_DEFAULT_MODEL)

    def test_legacy_embedding_codex_base_moves_to_independent_codex_fields(self):
        settings = Settings(
            embedding_auth_mode="api_key",
            embedding_api_base=CODEX_OAUTH_API_BASE,
            llm_api_base="https://api.z.ai/api/coding/paas/v4",
            embedding_codex_model="",
            embedding_model="text-embedding-3-large",
        )

        self.assertEqual(settings.embedding_auth_mode, "codex")
        self.assertEqual(settings.embedding_codex_api_base, CODEX_OAUTH_API_BASE)
        self.assertEqual(settings.embedding_codex_model, "text-embedding-3-large")
        self.assertEqual(settings.embedding_api_base, "https://api.z.ai/api/coding/paas/v4")


if __name__ == "__main__":
    unittest.main()
