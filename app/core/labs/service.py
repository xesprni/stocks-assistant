"""可复跑的 Portfolio、估值/同业与大中华市场实验室。"""

from __future__ import annotations

import json
import math
import sqlite3
import statistics
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Optional
from zoneinfo import ZoneInfo

from app.schemas.labs import GreaterChinaRequest, PeerComparisonRequest, PortfolioLabRequest, ValuationModelCreate


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _number(value: Any, default: Optional[float] = None) -> Optional[float]:
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


_MARKET_CURRENCIES = {"US": "USD", "A": "CNY", "H": "HKD"}
_MARKET_TIMEZONES = {"US": "America/New_York", "A": "Asia/Shanghai", "H": "Asia/Hong_Kong"}
_LONGBRIDGE_MAX_CONCURRENCY = 5


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _loads(value: Any, fallback: Any) -> Any:
    try:
        return json.loads(value) if value else fallback
    except (TypeError, ValueError):
        return fallback


class InvestmentLabService:
    """实验室计算与模型版本存储；写入范围独立于持仓和研究数据库。"""

    def __init__(self, workspace_dir: str, *, portfolio_service, market_service, fundamental_service, research_service):
        root = Path(workspace_dir).expanduser()
        self.db_path = root / "labs" / "labs.db"
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.portfolio = portfolio_service
        self.market = market_service
        self.fundamentals = fundamental_service
        self.research = research_service
        self._write_lock = threading.RLock()
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout=15000")
        return connection

    def _init_schema(self) -> None:
        with self._connect() as connection:
            # journal_mode 是数据库级持久设置，只在初始化时协商，避免每次查询
            # 都触发额外锁竞争。
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA synchronous=NORMAL")
            connection.execute(
                """CREATE TABLE IF NOT EXISTS valuation_models (
                    id TEXT PRIMARY KEY, model_key TEXT NOT NULL, user_id TEXT NOT NULL, symbol TEXT NOT NULL,
                    version INTEGER NOT NULL, model_type TEXT NOT NULL, title TEXT NOT NULL,
                    assumptions_json TEXT NOT NULL, peer_symbols_json TEXT NOT NULL, result_json TEXT NOT NULL,
                    source_ids_json TEXT NOT NULL, thesis_snapshot_id TEXT, reason TEXT NOT NULL, created_at TEXT NOT NULL,
                    UNIQUE(user_id, model_key, version)
                )"""
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_valuation_user_symbol ON valuation_models(user_id,symbol,created_at DESC)"
            )

    def analyze_portfolio(self, user_id: str, request: PortfolioLabRequest, *, settings=None) -> dict[str, Any]:
        warnings: list[str] = []
        holdings: list[dict[str, Any]] = []
        cash_by_market: dict[str, float] = {}
        payloads: dict[str, dict[str, Any]] = {}

        # 各市场持仓估值相互独立；并发数不超过 Longbridge 的账户级限制。
        with ThreadPoolExecutor(max_workers=min(len(request.markets), _LONGBRIDGE_MAX_CONCURRENCY)) as executor:
            futures = {
                executor.submit(self.portfolio.list_items, market, user_id=user_id, settings=settings): market
                for market in request.markets
            }
            for future in as_completed(futures):
                market = futures[future]
                try:
                    payloads[market] = future.result()
                except Exception as exc:
                    warnings.append(f"{market} portfolio unavailable: {exc}")
                    payloads[market] = {"market": market, "total_capital": "0", "items": []}

        base_currency = request.base_currency
        fx_rates = {base_currency: 1.0, **request.fx_rates}
        missing_fx: set[str] = set()
        excluded_fx_holdings = 0
        total_holdings = sum(len(payloads[market].get("items", [])) for market in request.markets)
        for market in request.markets:
            payload = payloads[market]
            market_currency = _MARKET_CURRENCIES[market]
            market_rate = fx_rates.get(market_currency)
            native_cash = _number(payload.get("total_capital"), 0.0) or 0.0
            if market_rate is None:
                if native_cash:
                    missing_fx.add(market_currency)
            else:
                cash_by_market[market] = native_cash * market_rate
            if payload.get("quote_error"):
                warnings.append(f"{market} live valuation unavailable: {payload['quote_error']}")
            for item in payload.get("items", []):
                shares = _number(item.get("shares"), 0.0) or 0.0
                price = _number(item.get("current_price")) or _number(item.get("cost_price"), 0.0) or 0.0
                native_value = _number(item.get("stock_value"))
                if native_value is None:
                    native_value = shares * price
                currency = str(item.get("currency") or market_currency).rsplit(".", 1)[-1].upper()
                rate = fx_rates.get(currency)
                if rate is None:
                    if native_value:
                        missing_fx.add(currency)
                    excluded_fx_holdings += 1
                    continue
                holdings.append(
                    {
                        **item,
                        "market": market,
                        "currency": currency,
                        "analysis_value_native": native_value,
                        "fx_rate": rate,
                        "analysis_value": native_value * rate,
                    }
                )

        if missing_fx:
            raise ValueError(
                "Missing FX rates for " + ", ".join(sorted(missing_fx))
                + f"; provide units of {base_currency} per one unit of each currency"
            )

        equity_value = sum(item["analysis_value"] for item in holdings)
        cash_value = sum(cash_by_market.values())
        total_value = equity_value + cash_value
        if total_value <= 0:
            return self._empty_portfolio_result(
                request,
                warnings + ["No FX-normalized holdings or cash were available."],
                holdings=total_holdings,
                excluded_fx_holdings=excluded_fx_holdings,
            )

        for item in holdings:
            item["weight"] = item["analysis_value"] / total_value

        return_series: dict[str, dict[int, float]] = {}
        history_errors: list[str] = []
        history_symbols = list(dict.fromkeys([str(item.get("symbol") or "") for item in holdings] + [request.benchmark_symbol]))

        def load_history(symbol: str) -> dict[int, float]:
            bars = self.market.get_candlesticks(
                symbol, "1D", request.lookback_days + 1, settings=settings
            ).get("bars", [])
            return self._returns_from_bars(bars, symbol)

        with ThreadPoolExecutor(max_workers=min(len(history_symbols), _LONGBRIDGE_MAX_CONCURRENCY)) as executor:
            futures = {executor.submit(load_history, symbol): symbol for symbol in history_symbols if symbol}
            for future in as_completed(futures):
                symbol = futures[future]
                try:
                    series = future.result()
                    if series:
                        return_series[symbol] = series
                    else:
                        history_errors.append(f"{symbol}: insufficient history")
                except Exception as exc:
                    history_errors.append(f"{symbol}: {exc}")
        warnings.extend(history_errors)

        available_holdings = [item for item in holdings if item.get("symbol") in return_series]
        available_weight = sum(item["weight"] for item in available_holdings)
        portfolio_returns = self._weighted_returns(available_holdings, return_series)
        benchmark_returns = return_series.get(request.benchmark_symbol, {})

        metrics = self._risk_metrics(portfolio_returns, benchmark_returns)
        metrics["simulated_twr"] = metrics.get("period_return")
        normalized_cash_flows = []
        for cash_flow in request.cash_flows:
            currency = cash_flow.currency or base_currency
            rate = fx_rates.get(currency)
            if rate is None:
                raise ValueError(f"Missing FX rate for cash-flow currency {currency}")
            normalized_cash_flows.append({"date": cash_flow.date, "amount": cash_flow.amount * rate})
        metrics["money_weighted_irr"] = self._cash_flow_irr(normalized_cash_flows, total_value)
        metrics.update({"concentration_hhi": round(sum(item["weight"] ** 2 for item in holdings), 6), "cash_weight": round(cash_value / total_value, 6)})
        common_dates = set(portfolio_returns)
        arithmetic_contributions = {
            item["symbol"]: sum(item["weight"] * return_series[item["symbol"]][date] for date in common_dates)
            for item in available_holdings
        }
        arithmetic_total = sum(arithmetic_contributions.values())
        period_return = metrics.get("period_return")
        attribution_scale = (
            float(period_return) / arithmetic_total
            if period_return is not None and abs(arithmetic_total) > 1e-15
            else 0.0
        )
        contribution = []
        for item in holdings:
            series = return_series.get(item.get("symbol"), {})
            holding_period_return = self._compound(series[date] for date in sorted(common_dates)) if series and common_dates else None
            return_contribution = (
                arithmetic_contributions[item["symbol"]] * attribution_scale
                if item["symbol"] in arithmetic_contributions
                else None
            )
            contribution.append({
                "symbol": item.get("symbol"), "market": item["market"], "weight": round(item["weight"], 6),
                "period_return": round(holding_period_return, 6) if holding_period_return is not None else None,
                "return_contribution": round(return_contribution, 6) if return_contribution is not None else None,
                "data_available": bool(series),
            })
        contribution.sort(key=lambda row: abs(row.get("return_contribution") or 0), reverse=True)
        attributed_return = sum(item.get("return_contribution") or 0 for item in contribution)
        metrics["contribution_residual"] = (
            round(float(period_return) - attributed_return, 6) if period_return is not None else None
        )

        exposures = self._exposures(holdings, cash_by_market, total_value)
        scenario = self._scenario(holdings, cash_value / total_value, request.scenario_shocks)
        rebalance = self._rebalance(holdings, request.target_weights)
        thesis_links = self._thesis_links(user_id, holdings)
        thesis_risks: dict[str, float] = {}
        for link in thesis_links:
            for risk in link["risks"]:
                thesis_risks[str(risk)] = thesis_risks.get(str(risk), 0) + link["weight"]
        exposures["thesis_risk"] = {key: round(value, 6) for key, value in sorted(thesis_risks.items(), key=lambda item: item[1], reverse=True)}
        return {
            "as_of": _now(), "methodology": "current_weight_historical_replay", "lookback_days": request.lookback_days,
            "base_currency": base_currency, "fx_rates_used": fx_rates,
            "benchmark_symbol": request.benchmark_symbol, "total_value": round(total_value, 2), "equity_value": round(equity_value, 2),
            "cash_value": round(cash_value, 2), "metrics": metrics, "contribution": contribution,
            "exposures": exposures, "scenario": scenario, "rebalance": rebalance, "thesis_links": thesis_links,
            "coverage": {"holdings": total_holdings, "valued_holdings": len(holdings), "excluded_fx_holdings": excluded_fx_holdings,
                         "history_available": len(available_holdings), "history_weight": round(available_weight, 6)},
            "warnings": warnings,
            "limitations": [
                "Returns replay current weights over history; they are not transaction-aware TWR or IRR.",
                "Money-weighted IRR is only calculated when complete user-supplied cash flows are provided.",
                "FX rates are user-supplied spot assumptions; historical currency movements are not replayed.",
                "Missing histories are excluded and reported in coverage.",
                "Return contribution uses scaled daily arithmetic attribution so contributions reconcile to simulated return.",
            ],
        }

    def _empty_portfolio_result(
        self,
        request: PortfolioLabRequest,
        warnings: list[str],
        *,
        holdings: int = 0,
        excluded_fx_holdings: int = 0,
    ) -> dict[str, Any]:
        return {"as_of": _now(), "methodology": "current_weight_historical_replay", "lookback_days": request.lookback_days,
                "base_currency": request.base_currency, "fx_rates_used": {request.base_currency: 1.0, **request.fx_rates},
                "benchmark_symbol": request.benchmark_symbol, "total_value": 0, "equity_value": 0, "cash_value": 0,
                "metrics": {}, "contribution": [], "exposures": {}, "scenario": {}, "rebalance": [],
                "thesis_links": [], "coverage": {"holdings": holdings, "valued_holdings": 0,
                                                    "excluded_fx_holdings": excluded_fx_holdings,
                                                    "history_available": 0, "history_weight": 0},
                "warnings": warnings, "limitations": ["No analyzable portfolio data."]}

    @staticmethod
    def _returns_from_bars(bars: list[dict[str, Any]], symbol: str = "") -> dict[int, float]:
        suffix = symbol.rsplit(".", 1)[-1].upper() if "." in symbol else ""
        market = "US" if suffix == "US" else "H" if suffix == "HK" else "A" if suffix in {"SH", "SZ"} else "US"
        market_timezone = ZoneInfo(_MARKET_TIMEZONES[market])

        def trading_day(timestamp: int) -> int:
            return datetime.fromtimestamp(timestamp, timezone.utc).astimezone(market_timezone).date().toordinal()

        ordered = sorted(
            ((int(bar.get("timestamp") or 0), _number(bar.get("close"))) for bar in bars), key=lambda item: item[0]
        )
        result = {}
        for index in range(1, len(ordered)):
            timestamp, close = ordered[index]
            previous = ordered[index - 1][1]
            if timestamp > 0 and close is not None and previous not in (None, 0):
                # 日 K 以各交易所本地日期对齐，避免 US/HK/A 同一交易日因
                # epoch 时刻不同而没有交集。
                result[trading_day(timestamp)] = close / previous - 1
        return result

    @staticmethod
    def _weighted_returns(holdings: list[dict[str, Any]], series: dict[str, dict[int, float]]) -> dict[int, float]:
        if not holdings:
            return {}
        dates = set.intersection(*(set(series[item["symbol"]]) for item in holdings))
        return {
            # 权重以含现金的总资产为分母；现金隐含零收益，不应把股票重新
            # 归一到 100%，否则组合收益会系统性虚高。
            timestamp: sum(item["weight"] * series[item["symbol"]][timestamp] for item in holdings)
            for timestamp in sorted(dates)
        }

    @staticmethod
    def _compound(values: Iterable[float]) -> float:
        result = 1.0
        for value in values:
            result *= 1 + value
        return result - 1

    def _risk_metrics(self, portfolio: dict[int, float], benchmark: dict[int, float]) -> dict[str, Any]:
        values = list(portfolio.values())
        if not values:
            return {"period_return": None, "annualized_volatility": None, "max_drawdown": None, "beta": None, "benchmark_correlation": None, "observations": 0}
        period_return = self._compound(values)
        volatility = statistics.stdev(values) * math.sqrt(252) if len(values) > 1 else 0.0
        wealth, peak, max_drawdown = 1.0, 1.0, 0.0
        for value in values:
            wealth *= 1 + value
            peak = max(peak, wealth)
            max_drawdown = min(max_drawdown, wealth / peak - 1)
        common = sorted(set(portfolio) & set(benchmark))
        beta = correlation = None
        if len(common) > 2:
            left = [portfolio[key] for key in common]
            right = [benchmark[key] for key in common]
            variance = statistics.variance(right)
            left_mean = statistics.mean(left)
            right_mean = statistics.mean(right)
            covariance = sum((a - left_mean) * (b - right_mean) for a, b in zip(left, right)) / (len(common) - 1)
            beta = covariance / variance if variance else None
            stdev_product = statistics.stdev(left) * statistics.stdev(right)
            correlation = covariance / stdev_product if stdev_product else None
        return {"period_return": round(period_return, 6), "annualized_volatility": round(volatility, 6),
                "max_drawdown": round(max_drawdown, 6), "beta": round(beta, 6) if beta is not None else None,
                "benchmark_correlation": round(correlation, 6) if correlation is not None else None, "observations": len(values)}

    @staticmethod
    def _exposures(holdings: list[dict[str, Any]], cash_by_market: dict[str, float], total: float) -> dict[str, Any]:
        markets: dict[str, float] = {}
        currencies: dict[str, float] = {}
        countries: dict[str, float] = {}
        defaults = {"US": "USD", "A": "CNY", "H": "HKD"}
        for item in holdings:
            weight = item["weight"]
            market = item["market"]
            currency = item.get("currency") or defaults.get(market, "UNKNOWN")
            markets[market] = markets.get(market, 0) + weight
            currencies[currency] = currencies.get(currency, 0) + weight
            country = {"US": "United States listing", "A": "Mainland China listing", "H": "Hong Kong listing"}.get(market, "Other")
            countries[country] = countries.get(country, 0) + weight
        for market, cash in cash_by_market.items():
            currencies[defaults.get(market, "UNKNOWN")] = currencies.get(defaults.get(market, "UNKNOWN"), 0) + cash / total
        return {"market": {key: round(value, 6) for key, value in markets.items()},
                "currency": {key: round(value, 6) for key, value in currencies.items()},
                "country_listing": {key: round(value, 6) for key, value in countries.items()}}

    @staticmethod
    def _cash_flow_irr(cash_flows: list[dict[str, Any]], terminal_value: float) -> Optional[float]:
        if not cash_flows:
            return None
        parsed = []
        for item in cash_flows:
            amount = _number(item.get("amount"))
            raw_date = item.get("date") or item.get("occurred_at")
            if isinstance(raw_date, datetime):
                date = raw_date
            else:
                occurred_at = str(raw_date or "")
                try:
                    date = datetime.fromisoformat(occurred_at.replace("Z", "+00:00"))
                except ValueError as exc:
                    raise ValueError(f"Invalid cash-flow date: {occurred_at}") from exc
            if date.tzinfo is None:
                date = date.replace(tzinfo=timezone.utc)
            else:
                date = date.astimezone(timezone.utc)
            if amount is not None:
                parsed.append((date, amount))
        valuation_time = datetime.now(timezone.utc)
        if any(date > valuation_time for date, _ in parsed):
            raise ValueError("Cash flows cannot occur after the valuation time")
        parsed.append((valuation_time, terminal_value))
        if len(parsed) < 2 or not any(amount < 0 for _, amount in parsed) or not any(amount > 0 for _, amount in parsed):
            return None
        parsed.sort(key=lambda item: item[0])
        start = parsed[0][0]

        def npv(rate: float) -> float:
            return sum(amount / ((1 + rate) ** max((date - start).total_seconds() / 31_557_600, 0)) for date, amount in parsed)

        low, high = -0.9999, 10.0
        low_npv = npv(low)
        high_npv = npv(high)
        if low_npv * high_npv > 0:
            return None
        for _ in range(100):
            middle = (low + high) / 2
            middle_npv = npv(middle)
            if low_npv * middle_npv <= 0:
                high = middle
                high_npv = middle_npv
            else:
                low = middle
                low_npv = middle_npv
        return round((low + high) / 2, 6)

    @staticmethod
    def _scenario(holdings: list[dict[str, Any]], cash_weight: float, shocks: dict[str, float]) -> dict[str, Any]:
        impacts = []
        total = 0.0
        for item in holdings:
            symbol = item.get("symbol")
            market = item.get("market")
            currency = item.get("currency") or {"US": "USD", "A": "CNY", "H": "HKD"}.get(market)
            shock = shocks.get(symbol, shocks.get(f"market:{market}", shocks.get(f"currency:{currency}", shocks.get("default", 0.0))))
            impact = item["weight"] * float(shock)
            total += impact
            impacts.append({"symbol": symbol, "weight": round(item["weight"], 6), "shock": shock, "portfolio_impact": round(impact, 6)})
        return {"estimated_return": round(total, 6), "cash_weight": round(cash_weight, 6), "holding_impacts": impacts,
                "method": "linear_weighted_shock_no_second_order_effects"}

    @staticmethod
    def _rebalance(holdings: list[dict[str, Any]], targets: dict[str, float]) -> list[dict[str, Any]]:
        if not targets:
            return []
        current = {item["symbol"]: item["weight"] for item in holdings}
        return [{"symbol": symbol, "current_weight": round(current.get(symbol, 0), 6), "target_weight": target,
                 "delta_weight": round(float(target) - current.get(symbol, 0), 6)} for symbol, target in targets.items()]

    def _thesis_links(self, user_id: str, holdings: list[dict[str, Any]]) -> list[dict[str, Any]]:
        latest_by_symbol = self.research.latest_theses(user_id, [item["symbol"] for item in holdings])
        links = []
        for item in holdings:
            thesis = latest_by_symbol.get(item["symbol"])
            links.append({"symbol": item["symbol"], "weight": round(item["weight"], 6), "thesis_snapshot_id": thesis["id"] if thesis else None,
                          "confidence": thesis["payload"].get("confidence") if thesis else None,
                          "risks": thesis["payload"].get("risks", []) if thesis else [],
                          "invalidation_conditions": thesis["payload"].get("invalidation_conditions", []) if thesis else []})
        return links

    def create_valuation_model(self, user_id: str, symbol: str, request: ValuationModelCreate) -> dict[str, Any]:
        symbol = self.research.normalize_symbol(symbol)
        if request.thesis_snapshot_id:
            self.research.validate_thesis_symbol(user_id, request.thesis_snapshot_id, symbol)
        if request.model_id:
            previous = self.get_valuation_model(user_id, request.model_id)
            if previous["symbol"] != symbol:
                raise ValueError("model symbol cannot change")
            model_key = previous["model_key"]
        else:
            model_key = f"valuation_{uuid.uuid4().hex[:16]}"
        result = self._calculate_valuation(request.model_type, request.assumptions)
        model_id = f"val_{uuid.uuid4().hex[:20]}"
        # 版本分配和写入必须在同一写事务中；否则两个并发请求会拿到
        # 相同 MAX(version)+1 并撞 UNIQUE 约束。
        with self._write_lock, self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            version = int(connection.execute(
                "SELECT COALESCE(MAX(version),0)+1 FROM valuation_models WHERE user_id=? AND model_key=?", (user_id, model_key)
            ).fetchone()[0])
            connection.execute(
                """INSERT INTO valuation_models
                   (id,model_key,user_id,symbol,version,model_type,title,assumptions_json,peer_symbols_json,result_json,
                    source_ids_json,thesis_snapshot_id,reason,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (model_id, model_key, user_id, symbol, version, request.model_type, request.title.strip(), _json(request.assumptions),
                 _json([self.research.normalize_symbol(value) for value in request.peer_symbols]), _json(result), _json(request.source_ids),
                 request.thesis_snapshot_id, request.reason, _now()),
            )
        return self.get_valuation_model(user_id, model_id)

    def list_valuation_models(self, user_id: str, symbol: Optional[str] = None) -> list[dict[str, Any]]:
        clauses, values = ["user_id=?"], [user_id]
        if symbol:
            clauses.append("symbol=?")
            values.append(self.research.normalize_symbol(symbol))
        with self._connect() as connection:
            rows = connection.execute(
                f"SELECT * FROM valuation_models WHERE {' AND '.join(clauses)} ORDER BY created_at DESC", values
            ).fetchall()
        return [self._valuation_row(row) for row in rows]

    def get_valuation_model(self, user_id: str, model_id: str) -> dict[str, Any]:
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM valuation_models WHERE id=? AND user_id=?", (model_id, user_id)).fetchone()
        if not row:
            raise KeyError(model_id)
        return self._valuation_row(row)

    @staticmethod
    def _calculate_valuation(model_type: str, assumptions: dict[str, Any]) -> dict[str, Any]:
        if model_type == "relative":
            metric = str(assumptions.get("metric") or "pe_ttm_ratio")
            peer_median = _number(assumptions.get("peer_median"))
            target_metric = _number(assumptions.get("target_metric"))
            if peer_median is None or target_metric is None:
                raise ValueError("relative valuation requires peer_median and target_metric")
            return {"metric": metric, "peer_median": peer_median, "target_metric": target_metric,
                    "implied_equity_value": round(peer_median * target_metric, 4), "formula": "peer_median × target_metric"}
        if model_type == "reverse_dcf":
            target_price = _number(assumptions.get("target_price"))
            if target_price is None or target_price <= 0:
                raise ValueError("reverse DCF requires a finite positive target_price")
            low, high = -0.5, 1.0
            low_price = InvestmentLabService._dcf({**assumptions, "revenue_growth": low})["value_per_share"]
            high_price = InvestmentLabService._dcf({**assumptions, "revenue_growth": high})["value_per_share"]
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
                price = InvestmentLabService._dcf(trial)["value_per_share"]
                if (price < target_price) == increasing:
                    low = growth
                else:
                    high = growth
            result = InvestmentLabService._dcf({**assumptions, "revenue_growth": (low + high) / 2})
            return {**result, "target_price": target_price, "implied_revenue_growth": round((low + high) / 2, 6)}
        return InvestmentLabService._dcf(assumptions)

    @staticmethod
    def _dcf(assumptions: dict[str, Any]) -> dict[str, Any]:
        revenue = _number(assumptions.get("revenue"))
        fcf_margin = _number(assumptions.get("fcf_margin"))
        growth = _number(assumptions.get("revenue_growth"))
        wacc = _number(assumptions.get("wacc"))
        terminal_growth = _number(assumptions.get("terminal_growth"))
        shares = _number(assumptions.get("shares_outstanding"))
        if None in {revenue, fcf_margin, growth, wacc, terminal_growth, shares}:
            raise ValueError("DCF requires revenue, fcf_margin, revenue_growth, wacc, terminal_growth and shares_outstanding")
        years_value = _number(assumptions.get("years")) if "years" in assumptions else 5.0
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
        cash = _number(assumptions.get("cash")) if "cash" in assumptions else 0.0
        debt = _number(assumptions.get("debt")) if "debt" in assumptions else 0.0
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
            forecasts.append({"year": year, "revenue": round(current_revenue, 4), "fcf": round(fcf, 4), "present_value": round(pv, 4)})
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
                    ev = sum(fcf / ((1 + test_wacc) ** year) for year, fcf in raw_forecasts) + tv / ((1 + test_wacc) ** years)
                    value = round((ev + cash - debt) / shares, 4)
                row.append({"wacc": round(test_wacc, 4), "terminal_growth": round(test_terminal, 4), "value_per_share": value})
            sensitivity.extend(row)
        return {"enterprise_value": round(enterprise_value, 4), "equity_value": round(equity_value, 4),
                "value_per_share": round(value_per_share, 4), "terminal_value_share": round(terminal_pv / enterprise_value, 6) if enterprise_value else None,
                "forecast": forecasts, "sensitivity": sensitivity}

    def compare_peers(self, request: PeerComparisonRequest, *, settings=None) -> dict[str, Any]:
        errors: list[dict[str, str]] = []
        normalized_symbols = list(dict.fromkeys(self.research.normalize_symbol(symbol) for symbol in request.symbols))
        if len(normalized_symbols) < 2:
            raise ValueError("at least two distinct canonical symbols are required")

        def load_peer(symbol: str) -> dict[str, Any]:
            payload = self.fundamentals.get_security_insights(symbol, settings=settings)
            valuation = payload.get("valuation") or {}
            company = payload.get("company") or {}
            metrics = {metric: self._find_metric(valuation, metric) for metric in request.metrics}
            return {
                "symbol": symbol,
                "name": self._find_metric(company, "name") or symbol,
                "metrics": metrics,
                "source": payload.get("source"),
                "fetched_at": payload.get("fetched_at"),
                "available": any(value is not None for value in metrics.values()),
            }

        rows_by_symbol: dict[str, dict[str, Any]] = {}
        with ThreadPoolExecutor(max_workers=min(len(normalized_symbols), _LONGBRIDGE_MAX_CONCURRENCY)) as executor:
            futures = {executor.submit(load_peer, symbol): symbol for symbol in normalized_symbols}
            for future in as_completed(futures):
                symbol = futures[future]
                try:
                    rows_by_symbol[symbol] = future.result()
                except Exception as exc:
                    errors.append({"symbol": symbol, "error": str(exc)})
                    rows_by_symbol[symbol] = {
                        "symbol": symbol,
                        "name": symbol,
                        "metrics": {metric: None for metric in request.metrics},
                        "available": False,
                    }
        rows = [rows_by_symbol[symbol] for symbol in normalized_symbols]
        medians = {}
        for metric in request.metrics:
            values = [_number(row["metrics"].get(metric)) for row in rows]
            numeric = [value for value in values if value is not None]
            medians[metric] = statistics.median(numeric) if numeric else None
        return {"as_of": _now(), "rows": rows, "medians": medians, "errors": errors,
                "methodology": "Longbridge valuation fields; unavailable values are not imputed"}

    @classmethod
    def _find_metric(cls, value: Any, key: str) -> Any:
        aliases = {
            "pe_ttm_ratio": ("pe_ttm_ratio", "pe_ttm", "pe_ratio", "pe"),
            "pb_ratio": ("pb_ratio", "pb"),
            "ps_ttm_ratio": ("ps_ttm_ratio", "ps_ttm", "ps_ratio", "ps"),
            "market_cap": ("market_cap", "total_market_cap", "total_market_value"),
            "name": ("name", "name_cn", "name_hk", "name_en"),
        }.get(key, (key,))
        if isinstance(value, dict):
            for alias in aliases:
                if alias in value and value[alias] not in (None, ""):
                    candidate = value[alias]
                    return candidate if key == "name" else cls._latest_numeric_metric(candidate)
            for child in value.values():
                found = cls._find_metric(child, key)
                if found not in (None, ""):
                    return found
        elif isinstance(value, list):
            for child in value:
                found = cls._find_metric(child, key)
                if found not in (None, ""):
                    return found
        return None

    @classmethod
    def _latest_numeric_metric(cls, value: Any) -> Optional[float]:
        direct = _number(value)
        if direct is not None:
            return direct
        if isinstance(value, list):
            for item in reversed(value):
                found = cls._latest_numeric_metric(item)
                if found is not None:
                    return found
        elif isinstance(value, dict):
            # Longbridge valuation metrics can be a latest-value object or a
            # date-keyed/list time series. Prefer explicit value fields, then
            # walk newest entries first.
            for key in ("value", "current", "latest", "last", "ttm"):
                if key in value:
                    found = cls._latest_numeric_metric(value[key])
                    if found is not None:
                        return found
            for child in reversed(list(value.values())):
                found = cls._latest_numeric_metric(child)
                if found is not None:
                    return found
        return None

    def greater_china_context(self, request: GreaterChinaRequest, *, settings=None) -> dict[str, Any]:
        symbol = self.research.normalize_symbol(request.symbol)
        suffix = symbol.rsplit(".", 1)[-1] if "." in symbol else ""
        market = "HK" if suffix == "HK" else "A" if suffix in {"SH", "SZ"} else "US_CHINA" if request.china_related_us_listing else "OTHER"
        defaults = {
            "HK": {"currency": "HKD", "timezone": "Asia/Hong_Kong", "languages": ["zh-HK", "en"]},
            "A": {"currency": "CNY", "timezone": "Asia/Shanghai", "languages": ["zh-CN"]},
            "US_CHINA": {"currency": "USD", "timezone": "America/New_York", "languages": ["en", "zh-CN"]},
            "OTHER": {"currency": "", "timezone": "", "languages": []},
        }[market]
        static_info, insights, errors = {}, {}, []
        fetched_at = None
        with ThreadPoolExecutor(max_workers=2) as executor:
            static_future = executor.submit(self.market.get_security_static_info, [symbol], settings=settings)
            fundamentals_future = executor.submit(self.fundamentals.get_security_insights, symbol, settings=settings)
            try:
                infos = static_future.result()
                static_info = infos[0] if infos else {}
            except Exception as exc:
                errors.append(f"static_info: {exc}")
            try:
                payload = fundamentals_future.result()
                insights = {
                    key: payload.get(key)
                    for key in ("filings", "company", "valuation", "dividends", "institution_rating", "corporate_actions")
                }
                fetched_at = payload.get("fetched_at")
            except Exception as exc:
                errors.append(f"fundamentals: {exc}")
        paired = None
        if request.paired_symbol:
            paired = self.compare_peers(PeerComparisonRequest(symbols=[symbol, request.paired_symbol]), settings=settings)
        return {
            "symbol": symbol, "market": market, "currency": static_info.get("currency") or defaults["currency"],
            "timezone": defaults["timezone"], "disclosure_languages": defaults["languages"], "static_info": static_info,
            "insights": insights, "paired_comparison": paired, "fetched_at": fetched_at, "errors": errors,
            "research_checklist": self._china_checklist(market),
            "risk_dimensions": ["policy and regulatory exposure", "VIE or listing structure where applicable", "RMB/HKD/USD currency path",
                                "cross-border capital flow sensitivity", "controlling shareholder and related-party governance",
                                "A/H/ADR price and disclosure differences where applicable"],
            "source_note": "Company, valuation, filings and corporate-action data come from Longbridge when available; market classification is derived from the symbol suffix and user flag.",
        }

    @staticmethod
    def _china_checklist(market: str) -> list[str]:
        common = ["Reconcile Chinese and English company names and reporting currency.", "Check latest filings, dividends and corporate actions.",
                  "Separate operating fundamentals from listing-venue and currency effects."]
        if market == "HK":
            return common + ["Compare HK disclosure with mainland operations and any A-share counterpart.", "Review liquidity, shareholder concentration and southbound-flow sensitivity."]
        if market == "A":
            return common + ["Review exchange board, trading-status and company-announcement context.", "Compare with any H-share counterpart and sector policy exposure."]
        if market == "US_CHINA":
            return common + ["Review listing structure, audit/disclosure jurisdiction and any HK dual listing.", "Reconcile ADR ratio and reporting currency before peer comparison."]
        return common

    @staticmethod
    def _valuation_row(row: sqlite3.Row) -> dict[str, Any]:
        return {"id": row["id"], "model_key": row["model_key"], "symbol": row["symbol"], "version": row["version"],
                "model_type": row["model_type"], "title": row["title"], "assumptions": _loads(row["assumptions_json"], {}),
                "peer_symbols": _loads(row["peer_symbols_json"], []), "result": _loads(row["result_json"], {}),
                "source_ids": _loads(row["source_ids_json"], []), "thesis_snapshot_id": row["thesis_snapshot_id"],
                "reason": row["reason"], "created_at": row["created_at"]}
