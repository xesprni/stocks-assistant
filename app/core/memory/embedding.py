"""向量嵌入服务

提供文本向量化的抽象接口和 OpenAI 实现。
支持单条和批量嵌入，以及内存缓存。
"""

import hashlib
import logging
import math
import threading
import time
from abc import ABC, abstractmethod
from datetime import UTC
from email.utils import parsedate_to_datetime

import httpx

logger = logging.getLogger("stocks-assistant.memory")


class EmbeddingUnavailableError(RuntimeError):
    """向量服务暂不可用；错误信息只包含可安全展示的诊断。"""


def _retry_after_seconds(value: str | None) -> float:
    """将服务端重试时间转换为冷却秒数，非法或过期值使用默认窗口。"""
    if value:
        try:
            seconds = float(value)
        except ValueError:
            try:
                retry_at = parsedate_to_datetime(value)
                if retry_at.tzinfo is None:
                    retry_at = retry_at.replace(tzinfo=UTC)
                seconds = retry_at.timestamp() - time.time()
            except (TypeError, ValueError, OverflowError):
                return 60.0
        if math.isfinite(seconds) and seconds > 0:
            return seconds
    return 60.0


class EmbeddingProvider(ABC):
    """向量化抽象基类"""

    @property
    def in_cooldown(self) -> bool:
        return False

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
        self._request_lock = threading.Lock()
        self._unavailable_until = 0.0
        self._unavailable_message = "Embedding service unavailable"
        if not self.api_key:
            raise ValueError("Embedding API key not configured")

    @property
    def in_cooldown(self) -> bool:
        # 异步搜索也会读取此属性；只读截止时间，避免等待其他线程的网络请求。
        return time.monotonic() < self._unavailable_until

    @staticmethod
    def _validate_embeddings(payload: object, count: int) -> list[list[float]]:
        data = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(data, list) or len(data) != count:
            raise ValueError("Invalid embedding response")
        if any(not isinstance(item, dict) for item in data):
            raise ValueError("Invalid embedding response")
        if any("index" in item for item in data):
            indexes = [item.get("index") for item in data]
            if any(type(index) is not int for index in indexes) or set(indexes) != set(
                range(count)
            ):
                raise ValueError("Invalid embedding response")
            data = sorted(data, key=lambda item: item["index"])

        embeddings = [item.get("embedding") for item in data]
        for vector in embeddings:
            if not isinstance(vector, list) or not vector:
                raise ValueError("Invalid embedding response")
            if any(type(value) not in {int, float} or not math.isfinite(value) for value in vector):
                raise ValueError("Invalid embedding response")
        if len({len(vector) for vector in embeddings}) != 1:
            raise ValueError("Invalid embedding response")
        return embeddings

    def _call(self, input_data):
        # 查询、批量索引共享冷却状态；锁内检查可避免并发请求重复触发限流。
        with self._request_lock:
            if time.monotonic() < self._unavailable_until:
                raise EmbeddingUnavailableError(self._unavailable_message)
            try:
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
                # 第三方返回必须与输入逐项对应，防止批量索引静默漏块或向量错配。
                return self._validate_embeddings(
                    resp.json(), len(input_data) if isinstance(input_data, list) else 1
                )
            except httpx.HTTPStatusError as exc:
                status = exc.response.status_code
                if status == 429:
                    cooldown = _retry_after_seconds(exc.response.headers.get("Retry-After"))
                elif status in {401, 403, 404, 405, 501}:
                    cooldown = 300.0
                else:
                    cooldown = 15.0
                message = f"Embedding service unavailable (HTTP {status})"
            except httpx.HTTPError:
                cooldown = 15.0
                message = "Embedding service unavailable (connection failed)"
            except httpx.InvalidURL:
                cooldown = 300.0
                message = "Embedding service unavailable (invalid endpoint)"
            except (ValueError, OverflowError):
                cooldown = 15.0
                message = "Embedding service unavailable (invalid response)"

            # 不转发响应正文、完整 URL 或底层异常，避免第三方错误携带凭据。
            self._unavailable_message = (
                f"{message}; check embedding configuration, API access, and quota."
            )
            self._unavailable_until = time.monotonic() + cooldown
            raise EmbeddingUnavailableError(self._unavailable_message) from None

    def embed(self, text: str) -> list[float]:
        return self._call(text)[0]

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        return self._call(texts)

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
