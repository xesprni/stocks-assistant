"""Longbridge security news schemas."""

from typing import Optional

from pydantic import BaseModel, Field


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


class GuardianFeedItem(BaseModel):
    id: str
    title: str
    description: str = ""
    url: str = ""
    published_at: Optional[str] = None
    published_at_ts: Optional[int] = None
    author: str = ""
    categories: list[str] = Field(default_factory=list)


class GuardianFeedResponse(BaseModel):
    url: str
    feed_url: str
    title: str = ""
    items: list[GuardianFeedItem]
    total: int


class GuardianArticleResponse(BaseModel):
    id: str
    title: str
    description: str = ""
    url: str = ""
    api_url: str = ""
    published_at: Optional[str] = None
    published_at_ts: Optional[int] = None
    author: str = ""
    thumbnail: str = ""
    body_html: str = ""
    body_text: str = ""


class GuardianTranslateRequest(BaseModel):
    text: str
    target_language: str = "zh-CN"


class GuardianTranslateResponse(BaseModel):
    target_language: str = "zh-CN"
    translation: str
    source_length: int
    model: str = ""
