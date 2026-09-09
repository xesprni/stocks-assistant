"""向量嵌入服务

提供文本向量化的抽象接口和 OpenAI 实现。
支持单条和批量嵌入，以及内存缓存。
"""

import hashlib
import logging
from abc import ABC, abstractmethod

import httpx

logger = logging.getLogger("stocks-assistant.memory")


class EmbeddingProvider(ABC):
    """向量化抽象基类"""

    @abstractmethod
    def embed(self, text: str) -> list[float]:
        pass

    @abstractmethod
    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        pass

    @property
    @abstractmethod
    def dimensions(self) -> int:
        pass


class OpenAIEmbeddingProvider(EmbeddingProvider):
    """OpenAI 兼容向量化提供商"""

    def __init__(
        self,
        model: str = "text-embedding-3-small",
        api_key: str | None = None,
        api_base: str | None = None,
        extra_headers: dict[str, str] | None = None,
    ):
        self.model = model
        self.api_key = api_key
        self.api_base = api_base or "https://api.openai.com/v1"
        self.extra_headers = extra_headers or {}
        self._dimensions = 1536 if "small" in model else 3072
        if not self.api_key:
            raise ValueError("Embedding API key not configured")

    def _call(self, input_data):
        resp = httpx.post(
            f"{self.api_base}/embeddings",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
                **self.extra_headers,
            },
            json={"input": input_data, "model": self.model},
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json()

    def embed(self, text: str) -> list[float]:
        return self._call(text)["data"][0]["embedding"]

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        return [item["embedding"] for item in self._call(texts)["data"]]

    @property
    def dimensions(self) -> int:
        return self._dimensions


class EmbeddingCache:
    """内存嵌入缓存（避免重复调用 API）"""

    def __init__(self):
        self.cache = {}

    def get(self, text: str, provider: str, model: str) -> list[float] | None:
        return self.cache.get(hashlib.md5(f"{provider}:{model}:{text}".encode()).hexdigest())

    def put(self, text: str, provider: str, model: str, embedding: list[float]):
        self.cache[hashlib.md5(f"{provider}:{model}:{text}".encode()).hexdigest()] = embedding


def create_embedding_provider(
    provider: str = "openai",
    model: str | None = None,
    api_key: str | None = None,
    api_base: str | None = None,
    extra_headers: dict[str, str] | None = None,
) -> EmbeddingProvider:
    """创建向量化提供商实例（工厂函数）"""
    model = model or "text-embedding-3-small"
    return OpenAIEmbeddingProvider(
        model=model, api_key=api_key, api_base=api_base, extra_headers=extra_headers
    )
