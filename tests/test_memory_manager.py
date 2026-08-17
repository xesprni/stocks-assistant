import asyncio
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app.core.memory.config import MemoryConfig
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
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(
            os.environ,
            {"OPENAI_API_KEY": "", "EMBEDDING_API_KEY": ""},
        ):
            workspace = Path(tmp)
            manager = self._manager(workspace)
            try:
                asyncio.run(manager.add_memory("first memory", user_id="user-1", scope="user", source="manual"))
                asyncio.run(manager.add_memory("second memory", user_id="user-1", scope="user", source="manual"))

                memory_file = workspace / "memory" / "users" / "user-1" / "MEMORY.md"
                content = memory_file.read_text(encoding="utf-8")

                self.assertIn("first memory", content)
                self.assertIn("second memory", content)
                self.assertEqual([], list(memory_file.parent.glob("memory_*.md")))
                self.assertEqual(["memory/users/user-1/MEMORY.md"], [row["path"] for row in manager.storage.list_indexed_files()])
            finally:
                manager.close()

    def test_clear_user_memory_removes_files_and_index(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(
            os.environ,
            {"OPENAI_API_KEY": "", "EMBEDDING_API_KEY": ""},
        ):
            workspace = Path(tmp)
            manager = self._manager(workspace)
            try:
                asyncio.run(manager.add_memory("current memory", user_id="user-1", scope="user", source="manual"))
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
                self.assertFalse((workspace / "memory" / "users" / "user-1" / "memory_legacy.md").exists())
                self.assertEqual({"chunks": 0, "files": 0}, manager.storage.get_stats())
            finally:
                manager.close()

    def test_concurrent_add_memory_does_not_lose_entries(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(
            os.environ,
            {"OPENAI_API_KEY": "", "EMBEDDING_API_KEY": ""},
        ):
            workspace = Path(tmp)
            manager = self._manager(workspace)
            try:
                async def add_all():
                    await asyncio.gather(*(
                        manager.add_memory(f"concurrent memory {index}", user_id="user-1", scope="user")
                        for index in range(12)
                    ))

                asyncio.run(add_all())
                content = (workspace / "memory" / "users" / "user-1" / "MEMORY.md").read_text(encoding="utf-8")
                for index in range(12):
                    self.assertIn(f"concurrent memory {index}", content)
            finally:
                manager.close()

    def test_failed_embedding_keeps_previous_file_index_atomically(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            config = MemoryConfig(
                workspace_root=str(workspace),
                index_db_path=str(workspace / "memory" / "users" / "user-1" / "long-term" / "index.db"),
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

                self.assertEqual(previous_rows, [dict(row) for row in manager.storage.get_chunks_by_path(path)])
                self.assertEqual(previous_hash, manager.storage.get_file_hash(path))
            finally:
                manager.close()


if __name__ == "__main__":
    unittest.main()
