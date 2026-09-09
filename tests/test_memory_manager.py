import asyncio
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import httpx

from app.core.memory.config import MemoryConfig
from app.core.memory.embedding import OpenAIEmbeddingProvider
from app.core.memory.manager import MemoryManager


class FlakyEmbeddingProvider:
    fail = False

    @property
    def dimensions(self):
        return 2

    def embed(self, text):
        return [1.0, 0.0]

    def embed_batch(self, texts):
        if self.fail:
            raise RuntimeError("embedding unavailable")
        return [[1.0, 0.0] for _ in texts]


class MemoryManagerWriteTest(unittest.TestCase):
    def _manager(self, workspace: Path) -> MemoryManager:
        config = MemoryConfig(
            workspace_root=str(workspace),
            index_db_path=str(workspace / "memory" / "users" / "user-1" / "long-term" / "index.db"),
            owner_user_id="user-1",
        )
        return MemoryManager(config=config)

    def test_add_memory_appends_to_single_user_file(self):
        with (
            tempfile.TemporaryDirectory() as tmp,
            mock.patch.dict(
                os.environ,
                {"OPENAI_API_KEY": "", "EMBEDDING_API_KEY": ""},
            ),
        ):
            workspace = Path(tmp)
            manager = self._manager(workspace)
            try:
                asyncio.run(
                    manager.add_memory(
                        "first memory", user_id="user-1", scope="user", source="manual"
                    )
                )
                asyncio.run(
                    manager.add_memory(
                        "second memory", user_id="user-1", scope="user", source="manual"
                    )
                )

                memory_file = workspace / "memory" / "users" / "user-1" / "MEMORY.md"
                content = memory_file.read_text(encoding="utf-8")

                self.assertIn("first memory", content)
                self.assertIn("second memory", content)
                self.assertEqual([], list(memory_file.parent.glob("memory_*.md")))
                self.assertEqual(
                    ["memory/users/user-1/MEMORY.md"],
                    [row["path"] for row in manager.storage.list_indexed_files()],
                )
            finally:
                manager.close()

    def test_clear_user_memory_removes_files_and_index(self):
        with (
            tempfile.TemporaryDirectory() as tmp,
            mock.patch.dict(
                os.environ,
                {"OPENAI_API_KEY": "", "EMBEDDING_API_KEY": ""},
            ),
        ):
            workspace = Path(tmp)
            manager = self._manager(workspace)
            try:
                asyncio.run(
                    manager.add_memory(
                        "current memory", user_id="user-1", scope="user", source="manual"
                    )
                )
                asyncio.run(
                    manager.add_memory(
                        "legacy memory",
                        user_id="user-1",
                        scope="user",
                        source="manual",
                        path="memory/users/user-1/memory_legacy.md",
                    ),
                )

                result = manager.clear_user_memory("user-1")

                self.assertEqual(2, result["deleted_files"])
                self.assertGreaterEqual(result["deleted_chunks"], 1)
                self.assertEqual(2, result["deleted_index_files"])
                self.assertFalse((workspace / "memory" / "users" / "user-1" / "MEMORY.md").exists())
                self.assertFalse(
                    (workspace / "memory" / "users" / "user-1" / "memory_legacy.md").exists()
                )
                self.assertEqual({"chunks": 0, "files": 0}, manager.storage.get_stats())
            finally:
                manager.close()

    def test_concurrent_add_memory_does_not_lose_entries(self):
        with (
            tempfile.TemporaryDirectory() as tmp,
            mock.patch.dict(
                os.environ,
                {"OPENAI_API_KEY": "", "EMBEDDING_API_KEY": ""},
            ),
        ):
            workspace = Path(tmp)
            manager = self._manager(workspace)
            try:

                async def add_all():
                    await asyncio.gather(
                        *(
                            manager.add_memory(
                                f"concurrent memory {index}", user_id="user-1", scope="user"
                            )
                            for index in range(12)
                        )
                    )

                asyncio.run(add_all())
                content = (workspace / "memory" / "users" / "user-1" / "MEMORY.md").read_text(
                    encoding="utf-8"
                )
                for index in range(12):
                    self.assertIn(f"concurrent memory {index}", content)
            finally:
                manager.close()

    def test_failed_embedding_keeps_previous_file_index_atomically(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            config = MemoryConfig(
                workspace_root=str(workspace),
                index_db_path=str(
                    workspace / "memory" / "users" / "user-1" / "long-term" / "index.db"
                ),
                owner_user_id="user-1",
            )
            provider = FlakyEmbeddingProvider()
            manager = MemoryManager(config=config, embedding_provider=provider)
            document = workspace / "users" / "user-1" / "knowledge" / "report.md"
            document.parent.mkdir(parents=True, exist_ok=True)
            try:
                document.write_text("previous indexed evidence", encoding="utf-8")
                asyncio.run(manager.index_file(document, source="knowledge", user_id="user-1"))
                path = "users/user-1/knowledge/report.md"
                previous_rows = [dict(row) for row in manager.storage.get_chunks_by_path(path)]
                previous_hash = manager.storage.get_file_hash(path)

                document.write_text("replacement evidence", encoding="utf-8")
                provider.fail = True
                with self.assertRaisesRegex(RuntimeError, "embedding unavailable"):
                    asyncio.run(manager.index_file(document, source="knowledge", user_id="user-1"))

                self.assertEqual(
                    previous_rows, [dict(row) for row in manager.storage.get_chunks_by_path(path)]
                )
                self.assertEqual(previous_hash, manager.storage.get_file_hash(path))
            finally:
                manager.close()


class MemoryManagerEmbeddingFallbackTest(unittest.TestCase):
    def _manager(self, workspace: Path) -> MemoryManager:
        return MemoryManager(
            config=MemoryConfig(
                workspace_root=str(workspace),
                index_db_path=str(workspace / "index.db"),
                owner_user_id="user-1",
            ),
            embedding_provider=OpenAIEmbeddingProvider(api_key="test-key"),
        )

    def _response(self, status: int, **kwargs) -> httpx.Response:
        return httpx.Response(
            status,
            request=httpx.Request("POST", "https://embedding.example/embeddings"),
            **kwargs,
        )

    def _search(self, manager: MemoryManager, query: str = "长期投资"):
        return asyncio.run(
            manager.search(query, user_id="user-1", include_shared=False, min_score=0.4)
        )

    def test_first_search_indexes_all_files_without_repeating_unavailable_requests(self):
        for status in (403, 404, 429):
            with (
                self.subTest(status=status),
                tempfile.TemporaryDirectory() as tmp,
                mock.patch("app.core.memory.embedding.time.monotonic", return_value=100.0),
                mock.patch(
                    "app.core.memory.embedding.httpx.post", return_value=self._response(status)
                ) as post,
            ):
                workspace = Path(tmp)
                manager = self._manager(workspace)
                knowledge = workspace / "users" / "user-1" / "knowledge"
                knowledge.mkdir(parents=True)
                for name in ("first.md", "second.md"):
                    (knowledge / name).write_text("长期投资偏好", encoding="utf-8")
                other_user = workspace / "users" / "user-2" / "knowledge"
                other_user.mkdir(parents=True)
                (other_user / "private.md").write_text("长期投资隐私", encoding="utf-8")
                try:
                    for _ in range(2):
                        results = self._search(manager)
                        self.assertEqual(2, len(results))
                        self.assertTrue(all(result.user_id == "user-1" for result in results))
                        self.assertTrue(all(result.score >= 0.4 for result in results))
                    self.assertEqual(1, post.call_count)
                    self.assertFalse(manager.get_status()["dirty"])
                    self.assertEqual("keyword only (FTS5)", manager.get_status()["search_mode"])
                finally:
                    manager.close()

    def test_unavailable_embedding_still_saves_new_and_updated_memory(self):
        with (
            tempfile.TemporaryDirectory() as tmp,
            mock.patch("app.core.memory.embedding.time.monotonic", return_value=100.0),
            mock.patch(
                "app.core.memory.embedding.httpx.post", return_value=self._response(429)
            ) as post,
        ):
            manager = self._manager(Path(tmp))
            try:
                for content in ("长期投资偏好", "风险控制原则"):
                    asyncio.run(manager.add_memory(content, user_id="user-1", scope="user"))
                self.assertEqual(1, len(self._search(manager)))
                self.assertEqual(1, len(self._search(manager, "风险控制")))
                self.assertEqual(1, post.call_count)
            finally:
                manager.close()

    def test_recovery_backfills_vectors_without_file_changes(self):
        with (
            tempfile.TemporaryDirectory() as tmp,
            mock.patch("app.core.memory.embedding.time.monotonic", return_value=100.0) as monotonic,
            mock.patch(
                "app.core.memory.embedding.httpx.post", return_value=self._response(429)
            ) as post,
        ):
            manager = self._manager(Path(tmp))
            try:
                asyncio.run(manager.add_memory("长期投资偏好", user_id="user-1", scope="user"))
                self._search(manager)
                path = "memory/users/user-1/MEMORY.md"
                keyword_hash = manager.storage.get_file_hash(path)
                self.assertIsNone(manager.storage.get_chunks_by_path(path)[0]["embedding"])

                monotonic.return_value = 161.0
                post.return_value = self._response(
                    200, json={"data": [{"embedding": [1.0, 0.0], "index": 0}]}
                )
                self.assertEqual(1, len(self._search(manager)))
                self.assertIsNotNone(manager.storage.get_chunks_by_path(path)[0]["embedding"])
                self.assertNotEqual(keyword_hash, manager.storage.get_file_hash(path))
                self.assertFalse(manager._pending_embeddings)
                self.assertEqual("hybrid (vector + keyword)", manager.get_status()["search_mode"])
                self.assertEqual(3, post.call_count)
            finally:
                manager.close()

    def test_restart_rebuilds_keyword_only_index_with_working_provider(self):
        with (
            tempfile.TemporaryDirectory() as tmp,
            mock.patch("app.core.memory.embedding.time.monotonic", return_value=100.0),
            mock.patch(
                "app.core.memory.embedding.httpx.post", return_value=self._response(404)
            ) as post,
        ):
            workspace = Path(tmp)
            manager = self._manager(workspace)
            try:
                asyncio.run(manager.add_memory("长期投资偏好", user_id="user-1", scope="user"))
            finally:
                manager.close()
            post.return_value = self._response(
                200, json={"data": [{"embedding": [1.0, 0.0], "index": 0}]}
            )
            restarted = self._manager(workspace)
            try:
                self.assertEqual(1, len(self._search(restarted)))
                rows = restarted.storage.get_chunks_by_path("memory/users/user-1/MEMORY.md")
                self.assertIsNotNone(rows[0]["embedding"])
            finally:
                restarted.close()

    def test_recovery_preserves_document_source_and_metadata(self):
        with (
            tempfile.TemporaryDirectory() as tmp,
            mock.patch("app.core.memory.embedding.time.monotonic", return_value=100.0) as monotonic,
            mock.patch(
                "app.core.memory.embedding.httpx.post", return_value=self._response(429)
            ) as post,
        ):
            workspace = Path(tmp)
            manager = self._manager(workspace)
            document = workspace / "users" / "user-1" / "knowledge" / "report.md"
            document.parent.mkdir(parents=True)
            document.write_text("长期投资偏好", encoding="utf-8")
            metadata = {"research_document_id": "doc-1", "source_url": "https://example.org/report"}
            try:
                asyncio.run(manager.index_file(document, source="research", metadata=metadata))
                monotonic.return_value = 161.0
                post.return_value = self._response(
                    200, json={"data": [{"embedding": [1.0, 0.0], "index": 0}]}
                )
                results = self._search(manager)
                self.assertEqual("research", results[0].source)
                row = manager.storage.get_chunks_by_path("users/user-1/knowledge/report.md")[0]
                self.assertEqual(metadata, json.loads(row["metadata"]))
                self.assertEqual("research", manager.storage.list_indexed_files()[0]["source"])
            finally:
                manager.close()

    def test_query_failure_uses_existing_index_and_keyword_weight(self):
        with (
            tempfile.TemporaryDirectory() as tmp,
            mock.patch("app.core.memory.embedding.time.monotonic", return_value=100.0),
            mock.patch(
                "app.core.memory.embedding.httpx.post",
                return_value=self._response(
                    200, json={"data": [{"embedding": [1.0, 0.0], "index": 0}]}
                ),
            ) as post,
        ):
            manager = self._manager(Path(tmp))
            try:
                asyncio.run(manager.add_memory("长期投资偏好", user_id="user-1", scope="user"))
                asyncio.run(manager.sync())
                post.return_value = self._response(429)
                for _ in range(2):
                    self.assertEqual(1, len(self._search(manager)))
                self.assertEqual(2, post.call_count)
                rows = manager.storage.get_chunks_by_path("memory/users/user-1/MEMORY.md")
                self.assertIsNotNone(rows[0]["embedding"])
            finally:
                manager.close()


if __name__ == "__main__":
    unittest.main()
