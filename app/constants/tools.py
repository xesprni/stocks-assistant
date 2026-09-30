"""tools 领域常量的唯一定义。"""

MAX_LINES = 500

MAX_BYTES = 30 * 1024

MAX_IMAGE_BYTES = 20 * 1024 * 1024

MAX_IMAGE_PIXELS = 50_000_000

LONGBRIDGE_DOCS_URL = "https://open.longbridge.com/docs"

METADATA_GROUPS = ("evidence", "sources", "rendered_images")

ARTIFACT_FIELDS = ("artifact_id", "width", "height", "files")

PORTFOLIO_FIELDS = (
    "id",
    "market",
    "symbol",
    "name",
    "shares",
    "cost_price",
    "currency",
    "current_price",
    "change_value",
    "change_rate",
    "pe_ttm_ratio",
    "stock_value",
    "position_ratio",
    "pnl_ratio",
    "note",
    "created_at",
    "updated_at",
)

WATCHLIST_FIELDS = (
    "id",
    "category",
    "symbol",
    "name",
    "name_cn",
    "name_en",
    "name_hk",
    "exchange",
    "currency",
    "last_done",
    "change_value",
    "change_rate",
    "note",
    "created_at",
    "updated_at",
)

ITEM_PAYLOAD_FIELDS = (
    "category",
    "symbol",
    "name",
    "name_cn",
    "name_en",
    "name_hk",
    "exchange",
    "currency",
    "last_done",
    "change_value",
    "change_rate",
    "note",
)


WEB_REQUEST_TIMEOUT_SECONDS = 30
PORTFOLIO_ACTION_ALIASES = {
    "create": "upsert",
    "add": "upsert",
    "remove": "delete",
    "set_cash": "set_total_capital",
    "set_capital": "set_total_capital",
    "cash": "set_total_capital",
    "adjust": "adjust_shares",
}
WATCHLIST_ACTION_ALIASES = {"create": "add", "read": "list", "remove": "delete"}
WATCHLIST_CATEGORY_ALIASES = {"HK": "H", "HKG": "H", "CN": "A", "ASHARE": "A", "ALL": None}

PORTFOLIO_MARKET_ALIASES = {
    "美股": "US",
    "美国": "US",
    "USTOCK": "US",
    "USTOCKS": "US",
    "A股": "A",
    "沪深": "A",
    "中国": "A",
    "CN": "A",
    "CHINA": "A",
    "ASHARE": "A",
    "ASHARES": "A",
    "港股": "H",
    "香港": "H",
    "HK": "H",
    "HKSTOCK": "H",
}
