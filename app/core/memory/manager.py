import hashlib
import os
import re
import math
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.core.memory.config import MemoryConfig
from app.core.memory.storage import MemoryStorage, MemoryChunk, SearchResult
from app.core.memory.chunker import TextChunker
from app.core.memory.embedding import create_embedding_provider, EmbeddingProvider
from app.core.memory.summarizer import MemoryFlushManager, create_memory_files_if_needed

import logging

logger = logging.getLogger("stocks-assistant.memory")


class MemoryManager:
    """记忆管理器 - 长期记忆的高层接口

    核心功能：
    - 混合搜索：向量搜索（语义）+ 关键词搜索（FTS5），加权融合
    - 时序衰减：带有日期的每日记忆文件按指数衰减降低权重
    - 增量同步：基于文件哈希检测变更，仅重新索引有变化的文件
    - 记忆写入：支持添加新的记忆内容（自动分块和向量化）
    - 记忆刷新：上下文裁剪时异步摘要写入每日记忆文件
    """

    def __init__(
        self,
        config: Optional[MemoryConfig] = None,
        embedding_provider: Optional[EmbeddingProvider] = None,
        llm_provider=None,
    ):
        self.config = config or MemoryConfig()

        db_path = self.config.get_db_path()
        self.storage = MemoryStorage(db_path)

        self.chunker = TextChunker(
            max_tokens=self.config.chunk_max_tokens,
            overlap_tokens=self.config.chunk_overlap_tokens,
        )

        self.embedding_provider = None
        if embedding_provider:
            self.embedding_provider = embedding_provider
        else:
            try:
                api_key = os.environ.get('OPENAI_API_KEY') or os.environ.get('EMBEDDING_API_KEY')
                api_base = os.environ.get('OPENAI_API_BASE') or os.environ.get('EMBEDDING_API_BASE')
                if api_key:
                    self.embedding_provider = create_embedding_provider(
                        provider="openai",
                        model=self.config.embedding_model,
                        api_key=api_key,
                        api_base=api_base,
                    )
            except Exception as e:
                logger.warning(f"[MemoryManager] Embedding init failed: {e}")

            if self.embedding_provider is None:
                logger.info("[MemoryManager] Memory will work with keyword search only (no vector search)")

        workspace_dir = self.config.get_workspace()
        self.flush_manager = MemoryFlushManager(
            workspace_dir=workspace_dir,
            llm_provider=llm_provider,
        )

        self._init_workspace()
        self._dirty = False

    def _init_workspace(self):
        memory_dir = self.config.get_memory_dir()
        memory_dir.mkdir(parents=True, exist_ok=True)
        workspace_dir = self.config.get_workspace()
        create_memory_files_if_needed(workspace_dir)

    async def search(
        self,
        query: str,
        user_id: Optional[str] = None,
        max_results: Optional[int] = None,
        min_score: Optional[float] = None,
        include_shared: bool = True,
    ) -> List[SearchResult]:
        """混合搜索记忆（向量 + 关键词，加权融合 + 时序衰减）"""
        max_results = max_results or self.config.max_results
        min_score = min_score or self.config.min_score

        scopes = []
        if include_shared:
            scopes.append("shared")
        if user_id:
            scopes.append("user")
        if not scopes:
            return []

        if self.config.sync_on_search and self._dirty:
            await self.sync()

        vector_results = []
        if self.embedding_provider:
            try:
                query_embedding = self.embedding_provider.embed(query)
                vector_results = self.storage.search_vector(
                    query_embedding=query_embedding,
                    user_id=user_id,
                    scopes=scopes,
                    limit=max_results * 2,
                )
                logger.info(f"[MemoryManager] Vector search found {len(vector_results)} results")
            except Exception as e:
                logger.warning(f"[MemoryManager] Vector search failed: {e}")

        keyword_results = self.storage.search_keyword(
            query=query,
            user_id=user_id,
            scopes=scopes,
            limit=max_results * 2,
        )
        logger.info(f"[MemoryManager] Keyword search found {len(keyword_results)} results")

        merged = self._merge_results(
            vector_results, keyword_results,
            self.config.vector_weight, self.config.keyword_weight,
        )
        filtered = [r for r in merged if r.score >= min_score]
        return filtered[:max_results]

    async def add_memory(
        self,
        content: str,
        user_id: Optional[str] = None,
        scope: str = "shared",
        source: str = "memory",
        path: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ):
        """添加新的记忆内容（自动分块、向量化、存储）"""
        if not content.strip():
            return

        if not path:
            content_hash = hashlib.md5(content.encode('utf-8')).hexdigest()[:8]
            if user_id and scope == "user":
                path = f"memory/users/{user_id}/memory_{content_hash}.md"
            else:
                path = f"memory/shared/memory_{content_hash}.md"

        chunks = self.chunker.chunk_text(content)
        texts = [chunk.text for chunk in chunks]
        if self.embedding_provider:
            embeddings = self.embedding_provider.embed_batch(texts)
        else:
            embeddings = [None] * len(texts)

        memory_chunks = []
        for chunk, embedding in zip(chunks, embeddings):
            chunk_id = self._generate_chunk_id(path, chunk.start_line, chunk.end_line)
            chunk_hash = MemoryStorage.compute_hash(chunk.text)
            memory_chunks.append(MemoryChunk(
                id=chunk_id, user_id=user_id, scope=scope, source=source,
                path=path, start_line=chunk.start_line, end_line=chunk.end_line,
                text=chunk.text, embedding=embedding, hash=chunk_hash, metadata=metadata,
            ))

        self.storage.save_chunks_batch(memory_chunks)

        file_hash = MemoryStorage.compute_hash(content)
        self.storage.update_file_metadata(
            path=path, source=source, file_hash=file_hash,
            mtime=int(datetime.now().timestamp()), size=len(content),
        )

    async def sync(self, force: bool = False):
        """同步记忆文件到索引

        扫描工作空间中的 MEMORY.md、memory/、knowledge/ 目录，
        对有变化的文件重新分块、向量化并更新索引。
        """
        workspace_dir = self.config.get_workspace()

        memory_file = workspace_dir / "MEMORY.md"
        if memory_file.exists():
            await self._sync_file(memory_file, "memory", "shared", None)

        memory_dir = self.config.get_memory_dir()
        if memory_dir.exists():
            for file_path in memory_dir.rglob("*.md"):
                if any(part.startswith('.') for part in file_path.relative_to(workspace_dir).parts):
                    continue
                rel_path = file_path.relative_to(workspace_dir)
                parts = rel_path.parts

                if "daily" in parts:
                    if "users" in parts or len(parts) > 3:
                        user_idx = parts.index("daily") + 1
                        user_id = parts[user_idx] if user_idx < len(parts) else None
                        scope = "user"
                    else:
                        user_id = None
                        scope = "shared"
                elif "users" in parts:
                    user_idx = parts.index("users") + 1
                    user_id = parts[user_idx] if user_idx < len(parts) else None
                    scope = "user"
                else:
                    user_id = None
                    scope = "shared"

                await self._sync_file(file_path, "memory", scope, user_id)

        knowledge_dir = workspace_dir / "knowledge"
        if knowledge_dir.exists():
            for file_path in knowledge_dir.rglob("*.md"):
                await self._sync_file(file_path, "knowledge", "shared", None)

        self._dirty = False

    async def _sync_file(self, file_path: Path, source: str, scope: str, user_id: Optional[str]):
        """同步单个文件到索引（基于哈希的增量更新）"""
        content = file_path.read_text(encoding='utf-8')
        file_hash = MemoryStorage.compute_hash(content)
        workspace_dir = self.config.get_workspace()
        rel_path = str(file_path.relative_to(workspace_dir))

        stored_hash = self.storage.get_file_hash(rel_path)
        if stored_hash == file_hash:
            return

        self.storage.delete_by_path(rel_path)

        chunks = self.chunker.chunk_text(content)
        if not chunks:
            return

        texts = [chunk.text for chunk in chunks]
        if self.embedding_provider:
            embeddings = self.embedding_provider.embed_batch(texts)
        else:
            embeddings = [None] * len(texts)

        memory_chunks = []
        for chunk, embedding in zip(chunks, embeddings):
            chunk_id = self._generate_chunk_id(rel_path, chunk.start_line, chunk.end_line)
            chunk_hash = MemoryStorage.compute_hash(chunk.text)
            memory_chunks.append(MemoryChunk(
                id=chunk_id, user_id=user_id, scope=scope, source=source,
                path=rel_path, start_line=chunk.start_line, end_line=chunk.end_line,
                text=chunk.text, embedding=embedding, hash=chunk_hash, metadata=None,
            ))

        self.storage.save_chunks_batch(memory_chunks)

        stat = file_path.stat()
        self.storage.update_file_metadata(
            path=rel_path, source=source, file_hash=file_hash,
            mtime=int(stat.st_mtime), size=stat.st_size,
        )

    def flush_memory(
        self,
        messages: list,
        user_id: Optional[str] = None,
        reason: str = "threshold",
        max_messages: int = 10,
        context_summary_callback=None,
    ) -> bool:
        """刷新对话摘要到每日记忆文件（异步执行，不阻塞主流程）"""
        success = self.flush_manager.flush_from_messages(
            messages=messages,
            user_id=user_id,
            reason=reason,
            max_messages=max_messages,
            context_summary_callback=context_summary_callback,
        )
        if success:
            self._dirty = True
        return success

    def get_status(self) -> Dict[str, Any]:
        stats = self.storage.get_stats()
        return {
            'chunks': stats['chunks'],
            'files': stats['files'],
            'workspace': str(self.config.get_workspace()),
            'dirty': self._dirty,
            'embedding_enabled': self.embedding_provider is not None,
            'embedding_provider': self.config.embedding_provider if self.embedding_provider else 'disabled',
            'embedding_model': self.config.embedding_model if self.embedding_provider else 'N/A',
            'search_mode': 'hybrid (vector + keyword)' if self.embedding_provider else 'keyword only (FTS5)',
        }

    def mark_dirty(self):
        self._dirty = True

    def close(self):
        self.storage.close()

    def _generate_chunk_id(self, path: str, start_line: int, end_line: int) -> str:
        """生成块唯一标识（基于路径和行号的 MD5 哈希）"""
        content = f"{path}:{start_line}:{end_line}"
        return hashlib.md5(content.encode('utf-8')).hexdigest()

    @staticmethod
    def _compute_temporal_decay(path: str, half_life_days: float = 30.0) -> float:
        """计算时序衰减系数

        带有日期的每日记忆文件（如 2025-03-01.md）按指数衰减降低权重。
        MEMORY.md 和无日期文件为"常青"内容，不衰减（权重=1.0）。
        半衰期默认 30 天：30 天前的记忆权重减半。
        """
        match = re.search(r'(\d{4})-(\d{2})-(\d{2})\.md$', path)
        if not match:
            return 1.0
        try:
            file_date = datetime(int(match.group(1)), int(match.group(2)), int(match.group(3)))
            age_days = (datetime.now() - file_date).days
            if age_days <= 0:
                return 1.0
            decay_lambda = math.log(2) / half_life_days
            return math.exp(-decay_lambda * age_days)
        except (ValueError, OverflowError):
            return 1.0

    def _merge_results(
        self,
        vector_results: List[SearchResult],
        keyword_results: List[SearchResult],
        vector_weight: float,
        keyword_weight: float,
    ) -> List[SearchResult]:
        """融合向量搜索和关键词搜索结果

        对同一块在不同搜索中的得分进行加权平均，
        并应用时序衰减调整最终分数。
        """
        merged_map = {}
        for result in vector_results:
            key = (result.path, result.start_line, result.end_line)
            merged_map[key] = {'result': result, 'vector_score': result.score, 'keyword_score': 0.0}

        for result in keyword_results:
            key = (result.path, result.start_line, result.end_line)
            if key in merged_map:
                merged_map[key]['keyword_score'] = result.score
            else:
                merged_map[key] = {'result': result, 'vector_score': 0.0, 'keyword_score': result.score}

        merged_results = []
        for entry in merged_map.values():
            combined_score = vector_weight * entry['vector_score'] + keyword_weight * entry['keyword_score']
            result = entry['result']
            decay = self._compute_temporal_decay(result.path)
            combined_score *= decay
            merged_results.append(SearchResult(
                path=result.path, start_line=result.start_line, end_line=result.end_line,
                score=combined_score, snippet=result.snippet, source=result.source,
                user_id=result.user_id,
            ))

        merged_results.sort(key=lambda r: r.score, reverse=True)
        return merged_results
