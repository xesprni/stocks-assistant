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
RADAR_SOURCE = "Longbridge CalendarContext + QuoteContext"
RADAR_REFERENCE_URL = "https://longbridge.cn/zh-CN/topics/44253984"
RADAR_SYMBOL_PATTERN = re.compile(r"[A-Z][A-Z0-9.-]*\.US\Z")
RADAR_MISSING_VALUES = frozenset({"", "-", "--", "待公布", "待公佈", "n/a", "none", "pending"})
RADAR_BEFORE_LABELS = ("盘前", "盤前", "before market", "before open", "pre-market", "bmo")
RADAR_AFTER_LABELS = ("盘后", "盤後", "after market", "after close", "post-market", "amc")
