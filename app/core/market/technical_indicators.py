"""Classic technical indicator calculations for OHLCV bars."""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any, Optional


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


def calculate_technical_indicators(
    bars: list[Any],
    indicators: Optional[list[str]] = None,
    params: Optional[dict[str, Any]] = None,
    series_limit: int = 120,
) -> dict:
    """Calculate selected technical indicators from chronological OHLCV bars."""
    records = _normalize_bars(bars)
    requested = _normalize_indicators(indicators)
    resolved_params = _resolve_params(params)
    limit = _bounded_int(series_limit, default=120, minimum=1, maximum=1000)

    timestamps = [record["timestamp"] for record in records]
    closes = [record["close"] for record in records]
    highs = [record["high"] for record in records]
    lows = [record["low"] for record in records]
    volumes = [record["volume"] for record in records]

    calculators = {
        "VOL": lambda: _calc_vol(volumes, resolved_params["vol_periods"]),
        "MA": lambda: _calc_ma(closes, resolved_params["ma_periods"]),
        "EMA": lambda: _calc_ema_group(closes, resolved_params["ema_periods"]),
        "MACD": lambda: _calc_macd(
            closes,
            resolved_params["macd_fast"],
            resolved_params["macd_slow"],
            resolved_params["macd_signal"],
        ),
        "KDJ": lambda: _calc_kdj(highs, lows, closes, resolved_params["kdj_period"]),
        "RSI": lambda: _calc_rsi(closes, resolved_params["rsi_periods"]),
        "CCI": lambda: _calc_cci(highs, lows, closes, resolved_params["cci_period"]),
        "WR": lambda: _calc_wr(highs, lows, closes, resolved_params["wr_periods"]),
        "DMI": lambda: _calc_dmi(highs, lows, closes, resolved_params["dmi_period"]),
        "OSC": lambda: _calc_osc(
            closes,
            resolved_params["osc_period"],
            resolved_params["osc_signal_period"],
        ),
        "BOLL": lambda: _calc_boll(
            closes,
            resolved_params["boll_period"],
            resolved_params["boll_std"],
        ),
        "BBIBOLL": lambda: _calc_bbiboll(
            closes,
            resolved_params["bbiboll_ma_periods"],
            resolved_params["bbiboll_std_period"],
            resolved_params["bbiboll_std"],
        ),
    }

    series: dict[str, dict[str, list[Optional[float]]]] = {}
    latest: dict[str, dict[str, Optional[float]]] = {}
    for indicator in requested:
        full_series = calculators[indicator]()
        series[indicator] = {name: _round_series(values[-limit:]) for name, values in full_series.items()}
        latest[indicator] = {name: _round_value(values[-1]) if values else None for name, values in full_series.items()}

    return {
        "requested_indicators": requested,
        "available_indicators": list(SUPPORTED_INDICATORS),
        "params": _params_for_indicators(requested, resolved_params),
        "bars_count": len(records),
        "latest_timestamp": timestamps[-1] if timestamps else None,
        "series_limit": limit,
        "series_timestamps": timestamps[-limit:],
        "latest": latest,
        "series": series,
    }


def _normalize_bars(bars: list[Any]) -> list[dict[str, Any]]:
    records = []
    for bar in bars or []:
        close = _float_field(bar, "close")
        if close is None:
            continue
        high = _float_field(bar, "high")
        low = _float_field(bar, "low")
        open_price = _float_field(bar, "open")
        records.append(
            {
                "timestamp": _field(bar, "timestamp"),
                "open": open_price if open_price is not None else close,
                "high": high if high is not None else close,
                "low": low if low is not None else close,
                "close": close,
                "volume": _float_field(bar, "volume") or 0.0,
            }
        )
    return records


def _normalize_indicators(indicators: Optional[list[str]]) -> list[str]:
    if not indicators:
        return list(SUPPORTED_INDICATORS)
    normalized = []
    for raw in indicators:
        key = str(raw or "").strip()
        if not key:
            continue
        upper_key = key.upper()
        compact = upper_key.replace("_", "").replace("-", "").replace(" ", "")
        indicator = _INDICATOR_ALIASES.get(upper_key) or _INDICATOR_ALIASES.get(compact) or compact
        if indicator not in SUPPORTED_INDICATORS:
            raise ValueError(f"unsupported technical indicator: {key}")
        if indicator not in normalized:
            normalized.append(indicator)
    if not normalized:
        raise ValueError("indicators must include at least one supported technical indicator")
    return normalized


def _resolve_params(params: Optional[dict[str, Any]]) -> dict[str, Any]:
    resolved = {key: value[:] if isinstance(value, list) else value for key, value in DEFAULT_PARAMS.items()}
    if not params:
        return resolved

    period_list_keys = {
        "vol_periods",
        "ma_periods",
        "ema_periods",
        "rsi_periods",
        "wr_periods",
        "bbiboll_ma_periods",
    }
    period_keys = {
        "macd_fast",
        "macd_slow",
        "macd_signal",
        "kdj_period",
        "cci_period",
        "dmi_period",
        "osc_period",
        "osc_signal_period",
        "boll_period",
        "bbiboll_std_period",
    }
    float_keys = {"boll_std", "bbiboll_std"}

    for key, value in params.items():
        if key in period_list_keys:
            resolved[key] = _period_list(value, key)
        elif key in period_keys:
            resolved[key] = _bounded_int(value, default=resolved[key], minimum=1, maximum=1000)
        elif key in float_keys:
            resolved[key] = _positive_float(value, key)
    if resolved["macd_fast"] >= resolved["macd_slow"]:
        raise ValueError("macd_fast must be smaller than macd_slow")
    return resolved


def _params_for_indicators(indicators: list[str], params: dict[str, Any]) -> dict[str, Any]:
    keys = {
        "VOL": ["vol_periods"],
        "MA": ["ma_periods"],
        "EMA": ["ema_periods"],
        "MACD": ["macd_fast", "macd_slow", "macd_signal"],
        "KDJ": ["kdj_period"],
        "RSI": ["rsi_periods"],
        "CCI": ["cci_period"],
        "WR": ["wr_periods"],
        "DMI": ["dmi_period"],
        "OSC": ["osc_period", "osc_signal_period"],
        "BOLL": ["boll_period", "boll_std"],
        "BBIBOLL": ["bbiboll_ma_periods", "bbiboll_std_period", "bbiboll_std"],
    }
    used = {}
    for indicator in indicators:
        for key in keys[indicator]:
            used[key] = params[key]
    return used


def _calc_vol(volumes: list[float], periods: list[int]) -> dict[str, list[Optional[float]]]:
    result = {"volume": [float(value) for value in volumes]}
    for period in periods:
        result[f"volume_ma{period}"] = _sma(volumes, period)
    return result


def _calc_ma(closes: list[float], periods: list[int]) -> dict[str, list[Optional[float]]]:
    return {f"ma{period}": _sma(closes, period) for period in periods}


def _calc_ema_group(closes: list[float], periods: list[int]) -> dict[str, list[Optional[float]]]:
    return {f"ema{period}": _ema(closes, period) for period in periods}


def _calc_macd(closes: list[float], fast: int, slow: int, signal: int) -> dict[str, list[Optional[float]]]:
    ema_fast = _ema(closes, fast)
    ema_slow = _ema(closes, slow)
    dif = [_none_if_missing(a, b, lambda x, y: x - y) for a, b in zip(ema_fast, ema_slow)]
    dea = _ema([value or 0.0 for value in dif], signal)
    macd = [_none_if_missing(dif_value, dea_value, lambda x, y: (x - y) * 2) for dif_value, dea_value in zip(dif, dea)]
    return {"dif": dif, "dea": dea, "macd": macd}


def _calc_kdj(highs: list[float], lows: list[float], closes: list[float], period: int) -> dict[str, list[Optional[float]]]:
    k_values: list[Optional[float]] = [None] * len(closes)
    d_values: list[Optional[float]] = [None] * len(closes)
    j_values: list[Optional[float]] = [None] * len(closes)
    prev_k = 50.0
    prev_d = 50.0

    for index in range(len(closes)):
        if index < period - 1:
            continue
        high = max(highs[index - period + 1 : index + 1])
        low = min(lows[index - period + 1 : index + 1])
        rsv = 50.0 if high == low else (closes[index] - low) / (high - low) * 100
        k = prev_k * 2 / 3 + rsv / 3
        d = prev_d * 2 / 3 + k / 3
        j = 3 * k - 2 * d
        k_values[index] = k
        d_values[index] = d
        j_values[index] = j
        prev_k = k
        prev_d = d

    return {"k": k_values, "d": d_values, "j": j_values}


def _calc_rsi(closes: list[float], periods: list[int]) -> dict[str, list[Optional[float]]]:
    result = {}
    gains = [0.0]
    losses = [0.0]
    for index in range(1, len(closes)):
        change = closes[index] - closes[index - 1]
        gains.append(max(change, 0.0))
        losses.append(max(-change, 0.0))

    for period in periods:
        values: list[Optional[float]] = [None] * len(closes)
        if len(closes) <= period:
            result[f"rsi{period}"] = values
            continue
        avg_gain = sum(gains[1 : period + 1]) / period
        avg_loss = sum(losses[1 : period + 1]) / period
        values[period] = _rsi_value(avg_gain, avg_loss)
        for index in range(period + 1, len(closes)):
            avg_gain = (avg_gain * (period - 1) + gains[index]) / period
            avg_loss = (avg_loss * (period - 1) + losses[index]) / period
            values[index] = _rsi_value(avg_gain, avg_loss)
        result[f"rsi{period}"] = values
    return result


def _calc_cci(highs: list[float], lows: list[float], closes: list[float], period: int) -> dict[str, list[Optional[float]]]:
    typical_prices = [(high + low + close) / 3 for high, low, close in zip(highs, lows, closes)]
    values: list[Optional[float]] = [None] * len(closes)
    for index in range(period - 1, len(closes)):
        window = typical_prices[index - period + 1 : index + 1]
        mean = sum(window) / period
        mean_deviation = sum(abs(value - mean) for value in window) / period
        values[index] = 0.0 if mean_deviation == 0 else (typical_prices[index] - mean) / (0.015 * mean_deviation)
    return {f"cci{period}": values}


def _calc_wr(
    highs: list[float],
    lows: list[float],
    closes: list[float],
    periods: list[int],
) -> dict[str, list[Optional[float]]]:
    result = {}
    for period in periods:
        values: list[Optional[float]] = [None] * len(closes)
        for index in range(period - 1, len(closes)):
            high = max(highs[index - period + 1 : index + 1])
            low = min(lows[index - period + 1 : index + 1])
            values[index] = 0.0 if high == low else (high - closes[index]) / (high - low) * 100
        result[f"wr{period}"] = values
    return result


def _calc_dmi(highs: list[float], lows: list[float], closes: list[float], period: int) -> dict[str, list[Optional[float]]]:
    size = len(closes)
    tr = [0.0] * size
    plus_dm = [0.0] * size
    minus_dm = [0.0] * size

    for index in range(1, size):
        up_move = highs[index] - highs[index - 1]
        down_move = lows[index - 1] - lows[index]
        plus_dm[index] = up_move if up_move > down_move and up_move > 0 else 0.0
        minus_dm[index] = down_move if down_move > up_move and down_move > 0 else 0.0
        tr[index] = max(
            highs[index] - lows[index],
            abs(highs[index] - closes[index - 1]),
            abs(lows[index] - closes[index - 1]),
        )

    smooth_tr = _wilder_sum(tr, period)
    smooth_plus_dm = _wilder_sum(plus_dm, period)
    smooth_minus_dm = _wilder_sum(minus_dm, period)
    pdi: list[Optional[float]] = [None] * size
    mdi: list[Optional[float]] = [None] * size
    dx: list[Optional[float]] = [None] * size

    for index in range(size):
        if smooth_tr[index] is None or smooth_tr[index] == 0:
            continue
        pdi[index] = (smooth_plus_dm[index] or 0.0) / smooth_tr[index] * 100
        mdi[index] = (smooth_minus_dm[index] or 0.0) / smooth_tr[index] * 100
        total = pdi[index] + mdi[index]
        dx[index] = 0.0 if total == 0 else abs(pdi[index] - mdi[index]) / total * 100

    adx: list[Optional[float]] = [None] * size
    seed_index = period * 2 - 1
    if size > seed_index:
        seed_values = [value for value in dx[period : period + period] if value is not None]
        if len(seed_values) == period:
            adx[seed_index] = sum(seed_values) / period
            for index in range(seed_index + 1, size):
                adx[index] = ((adx[index - 1] or 0.0) * (period - 1) + (dx[index] or 0.0)) / period

    adxr: list[Optional[float]] = [None] * size
    for index in range(seed_index + period, size):
        if adx[index] is not None and adx[index - period] is not None:
            adxr[index] = (adx[index] + adx[index - period]) / 2

    return {"pdi": pdi, "mdi": mdi, "adx": adx, "adxr": adxr}


def _calc_osc(closes: list[float], period: int, signal_period: int) -> dict[str, list[Optional[float]]]:
    ma = _sma(closes, period)
    osc = [_none_if_missing(close, ma_value, lambda x, y: x - y) for close, ma_value in zip(closes, ma)]
    osc_pct = [
        None if value is None or ma_value in (None, 0) else value / ma_value * 100
        for value, ma_value in zip(osc, ma)
    ]
    maosc = _sma_optional(osc, signal_period)
    return {"osc": osc, "osc_pct": osc_pct, "maosc": maosc}


def _calc_boll(closes: list[float], period: int, multiplier: float) -> dict[str, list[Optional[float]]]:
    mid = _sma(closes, period)
    std = _rolling_std(closes, period)
    upper = [_none_if_missing(mean, dev, lambda x, y: x + multiplier * y) for mean, dev in zip(mid, std)]
    lower = [_none_if_missing(mean, dev, lambda x, y: x - multiplier * y) for mean, dev in zip(mid, std)]
    return {"mid": mid, "upper": upper, "lower": lower}


def _calc_bbiboll(
    closes: list[float],
    ma_periods: list[int],
    std_period: int,
    multiplier: float,
) -> dict[str, list[Optional[float]]]:
    ma_series = [_sma(closes, period) for period in ma_periods]
    bbi: list[Optional[float]] = [None] * len(closes)
    for index in range(len(closes)):
        values = [series[index] for series in ma_series]
        if all(value is not None for value in values):
            bbi[index] = sum(value or 0.0 for value in values) / len(values)
    std = _rolling_std(closes, std_period)
    upper = [_none_if_missing(mean, dev, lambda x, y: x + multiplier * y) for mean, dev in zip(bbi, std)]
    lower = [_none_if_missing(mean, dev, lambda x, y: x - multiplier * y) for mean, dev in zip(bbi, std)]
    return {"bbi": bbi, "upper": upper, "lower": lower}


def _sma(values: list[float], period: int) -> list[Optional[float]]:
    result: list[Optional[float]] = [None] * len(values)
    if period <= 0:
        return result
    running = 0.0
    for index, value in enumerate(values):
        running += value
        if index >= period:
            running -= values[index - period]
        if index >= period - 1:
            result[index] = running / period
    return result


def _sma_optional(values: list[Optional[float]], period: int) -> list[Optional[float]]:
    result: list[Optional[float]] = [None] * len(values)
    for index in range(period - 1, len(values)):
        window = values[index - period + 1 : index + 1]
        if all(value is not None for value in window):
            result[index] = sum(value or 0.0 for value in window) / period
    return result


def _ema(values: list[float], period: int) -> list[Optional[float]]:
    result: list[Optional[float]] = []
    if not values:
        return result
    alpha = 2 / (period + 1)
    previous: Optional[float] = None
    for value in values:
        previous = value if previous is None else (value - previous) * alpha + previous
        result.append(previous)
    return result


def _rolling_std(values: list[float], period: int) -> list[Optional[float]]:
    result: list[Optional[float]] = [None] * len(values)
    for index in range(period - 1, len(values)):
        window = values[index - period + 1 : index + 1]
        mean = sum(window) / period
        result[index] = math.sqrt(sum((value - mean) ** 2 for value in window) / period)
    return result


def _wilder_sum(values: list[float], period: int) -> list[Optional[float]]:
    result: list[Optional[float]] = [None] * len(values)
    if len(values) <= period:
        return result
    result[period] = sum(values[1 : period + 1])
    for index in range(period + 1, len(values)):
        result[index] = (result[index - 1] or 0.0) - (result[index - 1] or 0.0) / period + values[index]
    return result


def _rsi_value(avg_gain: float, avg_loss: float) -> float:
    if avg_loss == 0 and avg_gain == 0:
        return 50.0
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - 100 / (1 + rs)


def _none_if_missing(a: Optional[float], b: Optional[float], func) -> Optional[float]:
    if a is None or b is None:
        return None
    return func(a, b)


def _field(item: Any, name: str) -> Any:
    if isinstance(item, Mapping):
        return item.get(name)
    return getattr(item, name, None)


def _float_field(item: Any, name: str) -> Optional[float]:
    value = _field(item, name)
    if value is None or value == "":
        return None
    try:
        return float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None


def _period_list(value: Any, name: str) -> list[int]:
    if isinstance(value, str):
        raw_values = [item.strip() for item in value.split(",") if item.strip()]
    elif isinstance(value, list):
        raw_values = value
    else:
        raw_values = [value]
    periods = []
    for raw in raw_values:
        if raw is None or raw == "":
            continue
        periods.append(_bounded_int(raw, default=1, minimum=1, maximum=1000))
    if not periods:
        raise ValueError(f"{name} must include at least one period")
    return sorted(set(periods))


def _bounded_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    if value is None or value == "":
        return default
    try:
        number = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("value must be an integer") from exc
    if number < minimum or number > maximum:
        raise ValueError(f"value must be between {minimum} and {maximum}")
    return number


def _positive_float(value: Any, name: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be a number") from exc
    if number <= 0:
        raise ValueError(f"{name} must be greater than 0")
    return number


def _round_series(values: list[Optional[float]]) -> list[Optional[float]]:
    return [_round_value(value) for value in values]


def _round_value(value: Optional[float]) -> Optional[float]:
    if value is None:
        return None
    rounded = round(float(value), 6)
    return 0.0 if rounded == -0.0 else rounded
