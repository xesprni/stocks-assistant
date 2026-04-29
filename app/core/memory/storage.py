"""记忆存储层 - 基于 SQLite + FTS5 的混合搜索引擎

存储结构：
- chunks 表：存储所有记忆块（含向量嵌入和元数据）
- files 表：追踪已索引的文件（用于增量同步）
- chunks_fts 虚拟表：FTS5 全文索引（自动通过触发器同步）

搜索能力：
- 向量搜索：基于余弦相似度的语义搜索
- 关键词搜索：FTS5 全文搜索 + CJK 词汇 LIKE 搜索
"""

import hashlib
import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional


@dataclass
class MemoryChunk:
    """记忆块数据结构"""
    id: str  # 块唯一标识（MD5 哈希）
    user_id: Optional[str]  # 用户 ID（为空表示共享）
    scope: str  # 作用域：shared / user / session
    source: str  # 来源：memory / knowledge / session
    path: str  # 文件相对路径
    start_line: int  # 起始行号
    end_line: int  # 结束行号
    text: str  # 块文本内容
    embedding: Optional[List[float]]  # 向量嵌入
    hash: str  # 内容哈希（用于变更检测）
    metadata: Optional[Dict[str, Any]] = None  # 额外元数据


@dataclass
class SearchResult:
    """搜索结果"""
    path: str  # 文件路径
    start_line: int  # 起始行号
    end_line: int  # 结束行号
    score: float  # 相关度分数（0-1）
    snippet: str  # 内容摘要
    source: str  # 来源标识
    user_id: Optional[str] = None  # 用户 ID


class MemoryStorage:
    """记忆存储引擎

    基于 SQLite 的混合搜索引擎，支持：
    - 向量搜索（余弦相似度）
    - 关键词搜索（FTS5 全文 + CJK 词汇匹配）
    - 增量文件同步（基于内容哈希）
    - 自动数据库完整性检查和恢复
    """
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.conn: Optional[sqlite3.Connection] = None
        self.fts5_available = False
        self._init_db()

    def _check_fts5(self) -> bool:
        """检测 SQLite 是否支持 FTS5 全文搜索扩展"""
        try:
            self.conn.execute("CREATE VIRTUAL TABLE IF NOT EXISTS fts5_test USING fts5(test)")
            self.conn.execute("DROP TABLE IF EXISTS fts5_test")
            return True
        except sqlite3.OperationalError:
            return False

    def _init_db(self):
        """初始化数据库：创建表、索引、FTS5 虚拟表和触发器"""
        try:
            self.conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
            self.conn.row_factory = sqlite3.Row
            self.fts5_available = self._check_fts5()
            try:
                result = self.conn.execute("PRAGMA integrity_check").fetchone()
                if result[0] != 'ok':
                    self.conn.close()
                    self.db_path.unlink(missing_ok=True)
                    self.conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
                    self.conn.row_factory = sqlite3.Row
            except sqlite3.DatabaseError:
                if self.conn:
                    self.conn.close()
                self.db_path.unlink(missing_ok=True)
                self.conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
                self.conn.row_factory = sqlite3.Row
            self.conn.execute("PRAGMA journal_mode=WAL")
            self.conn.execute("PRAGMA busy_timeout=5000")
        except Exception as e:
            raise RuntimeError(f"Database init failed: {e}")

        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS chunks (
                id TEXT PRIMARY KEY, user_id TEXT, scope TEXT NOT NULL DEFAULT 'shared',
                source TEXT NOT NULL DEFAULT 'memory', path TEXT NOT NULL,
                start_line INTEGER NOT NULL, end_line INTEGER NOT NULL, text TEXT NOT NULL,
                embedding TEXT, hash TEXT NOT NULL, metadata TEXT,
                created_at INTEGER DEFAULT (strftime('%s','now')),
                updated_at INTEGER DEFAULT (strftime('%s','now')))
        """)
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_chunks_user ON chunks(user_id)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_chunks_scope ON chunks(scope)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_chunks_hash ON chunks(path, hash)")

        if self.fts5_available:
            self.conn.execute("""
                CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
                    text, id UNINDEXED, user_id UNINDEXED, path UNINDEXED,
                    source UNINDEXED, scope UNINDEXED, content='chunks', content_rowid='rowid')
            """)
            self.conn.execute("CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN INSERT INTO chunks_fts(rowid,text,id,user_id,path,source,scope) VALUES(new.rowid,new.text,new.id,new.user_id,new.path,new.source,new.scope); END")
            self.conn.execute("CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN DELETE FROM chunks_fts WHERE rowid=old.rowid; END")
            self.conn.execute("CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN UPDATE chunks_fts SET text=new.text,id=new.id,user_id=new.user_id,path=new.path,source=new.source,scope=new.scope WHERE rowid=new.rowid; END")

        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS files (
                path TEXT PRIMARY KEY, source TEXT NOT NULL DEFAULT 'memory',
                hash TEXT NOT NULL, mtime INTEGER NOT NULL, size INTEGER NOT NULL,
                updated_at INTEGER DEFAULT (strftime('%s','now')))
        """)
        self.conn.commit()

    def save_chunks_batch(self, chunks: List[MemoryChunk]):
        """批量保存记忆块（INSERT OR REPLACE）"""
        self.conn.executemany(
            "INSERT OR REPLACE INTO chunks (id,user_id,scope,source,path,start_line,end_line,text,embedding,hash,metadata,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,strftime('%s','now'))",
            [(c.id, c.user_id, c.scope, c.source, c.path, c.start_line, c.end_line, c.text,
              json.dumps(c.embedding) if c.embedding else None, c.hash,
              json.dumps(c.metadata) if c.metadata else None) for c in chunks])
        self.conn.commit()

    def delete_by_path(self, path: str):
        """按文件路径删除所有关联的记忆块"""
        self.conn.execute("DELETE FROM chunks WHERE path = ?", (path,))
        self.conn.commit()

    def get_file_hash(self, path: str) -> Optional[str]:
        """获取已存储的文件内容哈希（用于增量同步）"""
        row = self.conn.execute("SELECT hash FROM files WHERE path = ?", (path,)).fetchone()
        return row['hash'] if row else None

    def update_file_metadata(self, path: str, source: str, file_hash: str, mtime: int, size: int):
        self.conn.execute(
            "INSERT OR REPLACE INTO files (path,source,hash,mtime,size,updated_at) VALUES (?,?,?,?,?,strftime('%s','now'))",
            (path, source, file_hash, mtime, size))
        self.conn.commit()

    def search_vector(self, query_embedding: List[float], user_id: Optional[str] = None,
                      scopes: List[str] = None, limit: int = 10) -> List[SearchResult]:
        """向量搜索：基于余弦相似度的语义搜索

        先从数据库加载所有有嵌入的块，再在 Python 中计算相似度排序。
        （适合中小规模数据，大规模场景可替换为专用向量数据库）
        """
        if scopes is None:
            scopes = ["shared"]
            if user_id:
                scopes.append("user")
        scope_ph = ','.join('?' * len(scopes))
        params = list(scopes)
        if user_id:
            q = f"SELECT * FROM chunks WHERE scope IN ({scope_ph}) AND (scope='shared' OR user_id=?) AND embedding IS NOT NULL"
            params.append(user_id)
        else:
            q = f"SELECT * FROM chunks WHERE scope IN ({scope_ph}) AND embedding IS NOT NULL"
        rows = self.conn.execute(q, params).fetchall()
        results = []
        for row in rows:
            emb = json.loads(row['embedding'])
            sim = self._cosine_sim(query_embedding, emb)
            if sim > 0:
                results.append((sim, row))
        results.sort(key=lambda x: x[0], reverse=True)
        return [SearchResult(path=r['path'], start_line=r['start_line'], end_line=r['end_line'],
                             score=s, snippet=self._truncate(r['text'], 500), source=r['source'],
                             user_id=r['user_id']) for s, r in results[:limit]]

    def search_keyword(self, query: str, user_id: Optional[str] = None,
                       scopes: List[str] = None, limit: int = 10) -> List[SearchResult]:
        """关键词搜索：FTS5 全文搜索 + CJK 词汇 LIKE 匹配

        优先使用 FTS5（支持英文和分词），回退到 CJK 词汇 LIKE 匹配。
        """
        if scopes is None:
            scopes = ["shared"]
            if user_id:
                scopes.append("user")
        if self.fts5_available:
            fts_results = self._search_fts5(query, user_id, scopes, limit)
            if fts_results:
                return fts_results
        import re
        cjk_words = re.findall(r'[一-鿿]{2,}', query)
        if not cjk_words:
            return []
        scope_ph = ','.join('?' * len(scopes))
        like_parts = ["text LIKE ?" for _ in cjk_words]
        params = [f'%{w}%' for w in cjk_words] + list(scopes)
        where = ' OR '.join(like_parts)
        if user_id:
            q = f"SELECT * FROM chunks WHERE ({where}) AND scope IN ({scope_ph}) AND (scope='shared' OR user_id=?) LIMIT ?"
            params += [user_id, limit]
        else:
            q = f"SELECT * FROM chunks WHERE ({where}) AND scope IN ({scope_ph}) LIMIT ?"
            params.append(limit)
        try:
            rows = self.conn.execute(q, params).fetchall()
            return [SearchResult(path=r['path'], start_line=r['start_line'], end_line=r['end_line'],
                                 score=0.5, snippet=self._truncate(r['text'], 500), source=r['source'],
                                 user_id=r['user_id']) for r in rows]
        except Exception:
            return []

    def _search_fts5(self, query: str, user_id, scopes, limit):
        import re
        tokens = re.findall(r'[A-Za-z0-9_]+', query)
        if not tokens:
            return []
        fts_query = ' OR '.join(f'"{t}"' for t in tokens)
        scope_ph = ','.join('?' * len(scopes))
        params = [fts_query] + list(scopes)
        if user_id:
            sql = f"SELECT chunks.*, bm25(chunks_fts) as rank FROM chunks_fts JOIN chunks ON chunks.id=chunks_fts.id WHERE chunks_fts MATCH ? AND chunks.scope IN ({scope_ph}) AND (chunks.scope='shared' OR chunks.user_id=?) ORDER BY rank LIMIT ?"
            params += [user_id, limit]
        else:
            sql = f"SELECT chunks.*, bm25(chunks_fts) as rank FROM chunks_fts JOIN chunks ON chunks.id=chunks_fts.id WHERE chunks_fts MATCH ? AND chunks.scope IN ({scope_ph}) ORDER BY rank LIMIT ?"
            params.append(limit)
        try:
            rows = self.conn.execute(sql, params).fetchall()
            return [SearchResult(path=r['path'], start_line=r['start_line'], end_line=r['end_line'],
                                 score=1 / (1 + max(0, r['rank'])), snippet=self._truncate(r['text'], 500),
                                 source=r['source'], user_id=r['user_id']) for r in rows]
        except Exception:
            return []

    def get_stats(self) -> Dict[str, int]:
        """获取存储统计信息"""
        return {
            'chunks': self.conn.execute("SELECT COUNT(*) as c FROM chunks").fetchone()['c'],
            'files': self.conn.execute("SELECT COUNT(*) as c FROM files").fetchone()['c'],
        }

    def close(self):
        if self.conn:
            try:
                self.conn.commit()
                self.conn.close()
                self.conn = None
            except Exception:
                pass

    @staticmethod
    def _cosine_sim(v1: List[float], v2: List[float]) -> float:
        if len(v1) != len(v2):
            return 0.0
        dot = sum(a * b for a, b in zip(v1, v2))
        n1 = sum(a * a for a in v1) ** 0.5
        n2 = sum(b * b for b in v2) ** 0.5
        return dot / (n1 * n2) if n1 and n2 else 0.0

    @staticmethod
    def _truncate(text: str, max_chars: int) -> str:
        return text if len(text) <= max_chars else text[:max_chars] + "..."

    @staticmethod
    def compute_hash(content: str) -> str:
        return hashlib.sha256(content.encode('utf-8')).hexdigest()
