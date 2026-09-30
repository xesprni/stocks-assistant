"""market 领域常量的唯一定义。"""

DEFAULT_INDICES = [
    {"symbol": "HSI.HK", "name": "恒生指数", "enabled": True},
    {"symbol": "HSCEI.HK", "name": "国企指数", "enabled": True},
    {"symbol": ".SPX.US", "name": "S&P 500", "enabled": True},
    {"symbol": ".NDX.US", "name": "纳斯达克100", "enabled": True},
    {"symbol": ".DJI.US", "name": "道琼斯", "enabled": True},
    {"symbol": "000001.SH", "name": "上证综指", "enabled": True},
    {"symbol": "000300.SH", "name": "沪深300", "enabled": True},
]

DEFAULT_CONFIG = {
    "indices": DEFAULT_INDICES,
    "refresh_interval": 60,
}

SYMBOL_ALIASES = {
    # Longbridge 对部分指数会返回带前导点的 symbol，配置和结果统一归一成无前导点格式。
    ".HSI.HK": "HSI.HK",
    ".HSCEI.HK": "HSCEI.HK",
    ".HSTECH.HK": "HSTECH.HK",
    ".HSCFI.HK": "HSCFI.HK",
    ".HSHCI.HK": "HSHCI.HK",
}

SUPPORTED_INDICATORS = (
    "VOL",
    "MA",
    "EMA",
    "MACD",
    "KDJ",
    "RSI",
    "CCI",
    "WR",
    "DMI",
    "OSC",
    "BOLL",
    "BBIBOLL",
)

DEFAULT_PARAMS = {
    "vol_periods": [5, 10, 20],
    "ma_periods": [5, 10, 20, 30, 60],
    "ema_periods": [5, 10, 20, 30, 60],
    "macd_fast": 12,
    "macd_slow": 26,
    "macd_signal": 9,
    "kdj_period": 9,
    "rsi_periods": [6, 12, 24],
    "cci_period": 14,
    "wr_periods": [10, 14],
    "dmi_period": 14,
    "osc_period": 10,
    "osc_signal_period": 6,
    "boll_period": 20,
    "boll_std": 2.0,
    "bbiboll_ma_periods": [3, 6, 12, 24],
    "bbiboll_std_period": 11,
    "bbiboll_std": 6.0,
}

_INDICATOR_ALIASES = {
    "VOLUME": "VOL",
    "VOLMA": "VOL",
    "MOVINGAVERAGE": "MA",
    "SMA": "MA",
    "EXPONENTIALMOVINGAVERAGE": "EMA",
    "WILLIAMSR": "WR",
    "WILLIAMS": "WR",
    "W%R": "WR",
    "DIRECTIONALMOVEMENTINDEX": "DMI",
    "BOLLINGER": "BOLL",
    "BOLLINGERBANDS": "BOLL",
    "BBI_BOLL": "BBIBOLL",
    "BBI-BOLL": "BBIBOLL",
}

WATCHLIST_QUOTE_FIELDS = (
    "last_done",
    "prev_close",
    "open",
    "high",
    "low",
    "volume",
    "turnover",
    "change_value",
    "change_rate",
)


DEFAULT_CANDLESTICK_COUNT = 200
MAX_CANDLESTICK_COUNT = 1000
DEFAULT_TRADE_COUNT = 50
MAX_TRADE_COUNT = 500
DEFAULT_TECHNICAL_BAR_COUNT = 300
DEFAULT_TECHNICAL_SERIES_LIMIT = 120
TEMPERATURE_NEUTRAL = 50
TEMPERATURE_MAX = 100
TEMPERATURE_CHANGE_MULTIPLIER = 16.5
TEMPERATURE_HOT = 80
TEMPERATURE_WARM = 60
TEMPERATURE_STABLE = 40
TEMPERATURE_COOL = 20


FALLBACK_MARKET_INDICES = {
    "CN": [
        "000001.SH",  # 上证综指
        "000300.SH",  # 沪深300
        "399001.SZ",  # 深证成指
        "399006.SZ",  # 创业板指
    ],
    "HK": [
        "HSI.HK",  # 恒生指数
        "HSCEI.HK",  # 国企指数
    ],
    "US": [
        ".SPX.US",  # S&P 500
        ".NDX.US",  # 纳斯达克100
        ".DJI.US",  # 道琼斯
    ],
}


DEFAULT_REFRESH_INTERVAL = 60
MAX_REFRESH_INTERVAL = 3600


DEFAULT_SYMBOL_SEARCH_LIMIT = 10
MAX_SYMBOL_SEARCH_LIMIT = 20
