"""Pure valuation calculators selected by model type; no storage or market dependencies."""

from __future__ import annotations

import math
from typing import Any, Protocol


def number(value: Any, default: float | None = None) -> float | None:
    if value is None:
        return default
    try:
        text = str(value).replace(",", "").strip()
        is_percent = text.endswith("%")
        number = float(text[:-1] if is_percent else text)
        if not math.isfinite(number):
            return default
        return number / 100 if is_percent else number
    except (TypeError, ValueError):
        return default


class ValuationCalculator(Protocol):
    def calculate(self, assumptions: dict[str, Any]) -> dict[str, Any]: ...


class RelativeCalculator:
    def calculate(self, assumptions: dict[str, Any]) -> dict[str, Any]:
        metric = str(assumptions.get("metric") or "pe_ttm_ratio")
        peer_median = number(assumptions.get("peer_median"))
        target_metric = number(assumptions.get("target_metric"))
        if peer_median is None or target_metric is None:
            raise ValueError("relative valuation requires peer_median and target_metric")
        return {
            "metric": metric,
            "peer_median": peer_median,
            "target_metric": target_metric,
            "implied_equity_value": round(peer_median * target_metric, 4),
            "formula": "peer_median × target_metric",
        }


class ReverseDCFCalculator:
    def calculate(self, assumptions: dict[str, Any]) -> dict[str, Any]:
        target_price = number(assumptions.get("target_price"))
        if target_price is None or target_price <= 0:
            raise ValueError("reverse DCF requires a finite positive target_price")
        low, high = -0.5, 1.0
        low_price = calculate_dcf({**assumptions, "revenue_growth": low})["value_per_share"]
        high_price = calculate_dcf({**assumptions, "revenue_growth": high})["value_per_share"]
        lower_price, upper_price = sorted((low_price, high_price))
        if target_price < lower_price or target_price > upper_price:
            raise ValueError(
                "reverse DCF target is outside the solvable growth range "
                f"[-50%, 100%] ({lower_price:.4f} to {upper_price:.4f} per share)"
            )
        increasing = high_price >= low_price
        for _ in range(80):
            growth = (low + high) / 2
            trial = {**assumptions, "revenue_growth": growth}
            price = calculate_dcf(trial)["value_per_share"]
            if (price < target_price) == increasing:
                low = growth
            else:
                high = growth
        result = calculate_dcf({**assumptions, "revenue_growth": (low + high) / 2})
        return {
            **result,
            "target_price": target_price,
            "implied_revenue_growth": round((low + high) / 2, 6),
        }


class DCFCalculator:
    def calculate(self, assumptions: dict[str, Any]) -> dict[str, Any]:
        return calculate_dcf(assumptions)


def calculate_dcf(assumptions: dict[str, Any]) -> dict[str, Any]:
    revenue = number(assumptions.get("revenue"))
    fcf_margin = number(assumptions.get("fcf_margin"))
    growth = number(assumptions.get("revenue_growth"))
    wacc = number(assumptions.get("wacc"))
    terminal_growth = number(assumptions.get("terminal_growth"))
    shares = number(assumptions.get("shares_outstanding"))
    if None in {revenue, fcf_margin, growth, wacc, terminal_growth, shares}:
        raise ValueError(
            "DCF requires revenue, fcf_margin, revenue_growth, wacc, terminal_growth and shares_outstanding"
        )
    assert revenue is not None and fcf_margin is not None and growth is not None
    assert wacc is not None and terminal_growth is not None and shares is not None
    years_value = number(assumptions.get("years")) if "years" in assumptions else 5.0
    if years_value is None or not years_value.is_integer():
        raise ValueError("DCF years must be a whole number")
    years = int(years_value)
    if (
        years < 1
        or years > 20
        or revenue < 0
        or growth <= -1
        or wacc <= -1
        or terminal_growth <= -1
        or wacc <= terminal_growth
        or shares <= 0
    ):
        raise ValueError("invalid DCF horizon, discount rate, terminal growth or share count")
    cash = number(assumptions.get("cash")) if "cash" in assumptions else 0.0
    debt = number(assumptions.get("debt")) if "debt" in assumptions else 0.0
    if cash is None or debt is None or cash < 0 or debt < 0:
        raise ValueError("cash and debt must be finite non-negative numbers")
    forecasts, present_value = [], 0.0
    raw_forecasts: list[tuple[int, float]] = []
    current_revenue = revenue
    for year in range(1, years + 1):
        current_revenue *= 1 + growth
        fcf = current_revenue * fcf_margin
        pv = fcf / ((1 + wacc) ** year)
        present_value += pv
        raw_forecasts.append((year, fcf))
        forecasts.append(
            {
                "year": year,
                "revenue": round(current_revenue, 4),
                "fcf": round(fcf, 4),
                "present_value": round(pv, 4),
            }
        )
    terminal_value = raw_forecasts[-1][1] * (1 + terminal_growth) / (wacc - terminal_growth)
    terminal_pv = terminal_value / ((1 + wacc) ** years)
    enterprise_value = present_value + terminal_pv
    equity_value = enterprise_value + cash - debt
    value_per_share = equity_value / shares
    sensitivity = []
    for wacc_delta in (-0.01, 0, 0.01):
        row = []
        for terminal_delta in (-0.005, 0, 0.005):
            test_wacc, test_terminal = wacc + wacc_delta, terminal_growth + terminal_delta
            if test_wacc <= test_terminal:
                value = None
            else:
                tv = raw_forecasts[-1][1] * (1 + test_terminal) / (test_wacc - test_terminal)
                ev = sum(fcf / ((1 + test_wacc) ** year) for year, fcf in raw_forecasts) + tv / (
                    (1 + test_wacc) ** years
                )
                value = round((ev + cash - debt) / shares, 4)
            row.append(
                {
                    "wacc": round(test_wacc, 4),
                    "terminal_growth": round(test_terminal, 4),
                    "value_per_share": value,
                }
            )
        sensitivity.extend(row)
    return {
        "enterprise_value": round(enterprise_value, 4),
        "equity_value": round(equity_value, 4),
        "value_per_share": round(value_per_share, 4),
        "terminal_value_share": round(terminal_pv / enterprise_value, 6)
        if enterprise_value
        else None,
        "forecast": forecasts,
        "sensitivity": sensitivity,
    }


CALCULATORS: dict[str, ValuationCalculator] = {
    "dcf": DCFCalculator(),
    "reverse_dcf": ReverseDCFCalculator(),
    "relative": RelativeCalculator(),
}


def calculate_valuation(model_type: str, assumptions: dict[str, Any]) -> dict[str, Any]:
    try:
        calculator = CALCULATORS[model_type]
    except KeyError as exc:
        raise ValueError(f"unsupported valuation model: {model_type}") from exc
    return calculator.calculate(assumptions)
