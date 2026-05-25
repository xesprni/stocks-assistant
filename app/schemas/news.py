"""Longbridge security news schemas."""

from typing import Optional

from pydantic import BaseModel


class SecurityNewsItem(BaseModel):
    id: str
    title: str
    description: str = ""
    url: str = ""
    published_at: Optional[str] = None
    published_at_ts: Optional[int] = None
    likes_count: Optional[int] = None
    comments_count: Optional[int] = None
    shares_count: Optional[int] = None


class SecurityNewsResponse(BaseModel):
    symbol: str
    news: list[SecurityNewsItem]
    total: int
