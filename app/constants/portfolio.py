"""持仓领域常量。"""

from datetime import time, timedelta
from typing import Literal

DEFAULT_TRANSACTION_LIMIT = 100
MAX_TRANSACTION_LIMIT = 200

MAX_ASSET_SNAPSHOTS = 2200
SNAPSHOT_POLL_SECONDS = 60
SNAPSHOT_SHUTDOWN_SECONDS = 5
SNAPSHOT_SETTLEMENT_DELAY = timedelta(minutes=5)
SNAPSHOT_MARKET_TIMEZONES = {"US": "America/New_York", "A": "Asia/Shanghai", "H": "Asia/Hong_Kong"}
SNAPSHOT_QUOTE_MARKETS = {"US": "US", "A": "CN", "H": "HK"}
# 港股等待收市竞价的最晚结束时间，半日市由长桥交易日历判断。
SNAPSHOT_CLOSE_TIMES = {"US": time(16), "A": time(15), "H": time(16, 10)}
SNAPSHOT_HALF_DAY_CLOSE_TIMES = {"US": time(13), "A": time(15), "H": time(12, 10)}
SNAPSHOT_PRICE_SOURCE = "Longbridge unadjusted regular-session daily close"


_SUFFIX_MARKETS: dict[str, Literal["US", "A", "H"]] = {"US": "US", "SH": "A", "SZ": "A", "HK": "H"}
