"""Longbridge security news schemas."""

from pydantic import BaseModel, Field


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


class GuardianFeedItem(BaseModel):
    id: str
    title: str
    description: str = ""
    url: str = ""
    published_at: str | None = None
    published_at_ts: int | None = None
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
    published_at: str | None = None
    published_at_ts: int | None = None
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
