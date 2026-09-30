"""Longbridge security news schemas."""

from pydantic import BaseModel


class SecurityNewsItem(BaseModel):
    id: str
    title: str
    description: str = ""
    url: str = ""
    published_at: str | None = None
    published_at_ts: int | None = None
    likes_count: int | None = None
    comments_count: int | None = None
    shares_count: int | None = None


class SecurityNewsResponse(BaseModel):
    symbol: str
    news: list[SecurityNewsItem]
    total: int
