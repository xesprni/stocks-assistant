"""longbridge 领域常量的唯一定义。"""

import re

AUTH_TIMEOUT = 300

REGISTER_URL = "https://openapi.longbridge.com/oauth2/register"

_CLIENT_ID = re.compile(r"[A-Za-z0-9_-]{8,128}\Z")


_CONTEXT_CLASSES = {
    "QuoteContext",
    "MarketContext",
    "FundamentalContext",
    "ContentContext",
}
