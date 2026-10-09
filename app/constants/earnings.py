"""财报雷达查询边界与计算口径。"""

import re

MAX_RADAR_SYMBOLS = 20
MAX_RADAR_SYMBOL_LENGTH = 24
DEFAULT_RADAR_DAYS = 45
MAX_RADAR_DAYS = 90
RADAR_HISTORY_DAYS = 3 * 366
RADAR_HISTORY_SAMPLES = 12
RADAR_CALENDAR_CHUNK_DAYS = 30
RADAR_CALENDAR_FAILURE_LIMIT = 3
RADAR_CALENDAR_PAGE_SIZE = 100
RADAR_CALENDAR_MAX_PAGES = 100
RADAR_CALENDAR_PATH = "/v1/quote/finance_calendar"
RADAR_EXPIRY_PROBES = 4
RADAR_MAX_SESSION_GAP_DAYS = 7
RADAR_STALE_QUOTE_DAYS = 3
RADAR_HV_RETURNS = 30
RADAR_TRADING_DAYS = 252
RADAR_PERCENT = 100
RADAR_RATIO_HIGH = 1.5
RADAR_RATIO_ABOVE = 1.15
RADAR_RATIO_NORMAL = 0.85
RADAR_TIMEZONE = "America/New_York"
RADAR_SOURCE = "Longbridge finance_calendar + QuoteContext"
RADAR_REFERENCE_URL = "https://longbridge.cn/zh-CN/topics/44253984"
RADAR_SYMBOL_PATTERN = re.compile(r"[A-Z][A-Z0-9.-]*\.US\Z")
RADAR_EVENT_DATE_PATTERN = re.compile(r"(?<!\d)(\d{4})[.-](\d{2})[.-](\d{2})(?!\d)")
RADAR_MISSING_VALUES = frozenset(
    {"", "-", "--", "待公布", "待公佈", "n/a", "none", "pending", "tba", "tbd"}
)
RADAR_BEFORE_CODES = frozenset({"before", "pre", "bmo"})
RADAR_AFTER_CODES = frozenset({"after", "post", "amc"})
RADAR_BEFORE_LABELS = ("盘前", "盤前", "before market", "before open", "pre market", "premarket")
RADAR_AFTER_LABELS = (
    "盘后",
    "盤後",
    "after market",
    "after close",
    "post market",
    "postmarket",
    "after hours",
)
