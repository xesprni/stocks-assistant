"""Market dashboard API — index quotes, watchlist quotes, and config."""

from typing import Optional

from fastapi import APIRouter, HTTPException

from app.core.watchlist.service import LongbridgeUnavailableError
from app.deps import get_market_service, get_watchlist_service
from app.schemas.market import (
    CandlesticksResponse,
    IntradayResponse,
    MarketDashboardConfig,
    MarketQuotesResponse,
    QuoteItem,
)

router = APIRouter()


@router.get("/config", response_model=MarketDashboardConfig)
async def get_market_config():
    """获取行情监控仪表盘配置。"""
    service = get_market_service()
    return MarketDashboardConfig(**service.get_config())


@router.put("/config", response_model=MarketDashboardConfig)
async def update_market_config(config: MarketDashboardConfig):
    """保存行情监控仪表盘配置。"""
    service = get_market_service()
    return MarketDashboardConfig(**service.save_config(config.model_dump()))


@router.get("/index-quotes", response_model=MarketQuotesResponse)
async def get_index_quotes():
    """拉取所有启用指数的实时报价。"""
    service = get_market_service()
    try:
        quotes = [QuoteItem(**q) for q in service.get_index_quotes()]
    except LongbridgeUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    return MarketQuotesResponse(quotes=quotes, total=len(quotes))


@router.get("/stock-quotes", response_model=MarketQuotesResponse)
async def get_stock_quotes(category: Optional[str] = None):
    """拉取自选股列表的实时报价，可按市场分类过滤。"""
    market_svc = get_market_service()
    watchlist_svc = get_watchlist_service()
    try:
        items = watchlist_svc.list_items(category=category)
        raw = market_svc.get_watchlist_quotes(items)
        quotes = [QuoteItem(**q) for q in raw]
    except LongbridgeUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    return MarketQuotesResponse(quotes=quotes, total=len(quotes))


@router.get("/candlesticks", response_model=CandlesticksResponse)
async def get_candlesticks(symbol: str, period: str = "1D", count: int = 200):
    """拉取指定标的 K 线数据。period: 1D | 1W | 1M。"""
    service = get_market_service()
    try:
        data = service.get_candlesticks(symbol, period, count)
    except LongbridgeUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    return CandlesticksResponse(**data)


@router.get("/intraday", response_model=IntradayResponse)
async def get_intraday(symbol: str, since: Optional[int] = None):
    """拉取今日分时数据。since 可用于增量返回指定时间戳后的数据。"""
    service = get_market_service()
    try:
        data = service.get_intraday(symbol, since=since)
    except LongbridgeUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    return IntradayResponse(**data)
