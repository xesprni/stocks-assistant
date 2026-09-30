"""交易所本地收盘时间；ZoneInfo 自动处理美国夏令时。"""

from datetime import date, datetime
from zoneinfo import ZoneInfo

from app.constants.portfolio import (
    SNAPSHOT_CLOSE_TIMES,
    SNAPSHOT_HALF_DAY_CLOSE_TIMES,
    SNAPSHOT_MARKET_TIMEZONES,
)
from app.schemas.portfolio import PortfolioMarket


def market_close_at(market: PortfolioMarket, day: date, *, half_day: bool) -> datetime:
    times = SNAPSHOT_HALF_DAY_CLOSE_TIMES if half_day else SNAPSHOT_CLOSE_TIMES
    return datetime.combine(day, times[market], ZoneInfo(SNAPSHOT_MARKET_TIMEZONES[market]))
