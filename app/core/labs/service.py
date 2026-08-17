"""可复跑的 Portfolio、估值/同业与大中华市场实验室。"""

from __future__ import annotations

import json
import math
import sqlite3
import statistics
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Optional

from app.schemas.labs import GreaterChinaRequest, PeerComparisonRequest, PortfolioLabRequest, ValuationModelCreate


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _number(value: Any, default: Optional[float] = None) -> Optional[float]:
    if value is None:
        return default
    try:
        return float(str(value).replace(",", "").replace("%", "").strip())
    except (TypeError, ValueError):
        return default


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
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        return connection

    def _init_schema(self) -> None:
        with self._connect() as connection:
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
        for market in request.markets:
            payload = self.portfolio.list_items(market, user_id=user_id, settings=settings)
            cash_by_market[market] = _number(payload.get("total_capital"), 0.0) or 0.0
            if payload.get("quote_error"):
                warnings.append(f"{market} live valuation unavailable: {payload['quote_error']}")
            for item in payload.get("items", []):
                shares = _number(item.get("shares"), 0.0) or 0.0
                price = _number(item.get("current_price")) or _number(item.get("cost_price"), 0.0) or 0.0
                value = _number(item.get("stock_value"))
                if value is None:
                    value = shares * price
                holdings.append({**item, "market": market, "analysis_value": value})

        equity_value = sum(item["analysis_value"] for item in holdings)
        cash_value = sum(cash_by_market.values())
        total_value = equity_value + cash_value
        if total_value <= 0:
            return self._empty_portfolio_result(request, warnings + ["No valued holdings or cash were available."])

        for item in holdings:
            item["weight"] = item["analysis_value"] / total_value

        return_series: dict[str, dict[int, float]] = {}
        history_errors = []
        for item in holdings:
            symbol = str(item.get("symbol") or "")
            try:
                bars = self.market.get_candlesticks(symbol, "1D", request.lookback_days + 1, settings=settings).get("bars", [])
                series = self._returns_from_bars(bars)
                if series:
                    return_series[symbol] = series
                else:
                    history_errors.append(f"{symbol}: insufficient history")
            except Exception as exc:
                history_errors.append(f"{symbol}: {exc}")
        warnings.extend(history_errors)

        available_holdings = [item for item in holdings if item.get("symbol") in return_series]
        available_weight = sum(item["weight"] for item in available_holdings)
        portfolio_returns = self._weighted_returns(available_holdings, return_series, available_weight)
        benchmark_returns: dict[int, float] = {}
        try:
            benchmark_bars = self.market.get_candlesticks(
                request.benchmark_symbol, "1D", request.lookback_days + 1, settings=settings
            ).get("bars", [])
            benchmark_returns = self._returns_from_bars(benchmark_bars)
        except Exception as exc:
            warnings.append(f"Benchmark {request.benchmark_symbol}: {exc}")

        metrics = self._risk_metrics(portfolio_returns, benchmark_returns)
        metrics["simulated_twr"] = metrics.get("period_return")
        metrics["money_weighted_irr"] = self._cash_flow_irr(request.cash_flows, total_value)
        metrics.update({"concentration_hhi": round(sum(item["weight"] ** 2 for item in holdings), 6), "cash_weight": round(cash_value / total_value, 6)})
        contribution = []
        for item in holdings:
            series = return_series.get(item.get("symbol"), {})
            period_return = self._compound(series.values()) if series else None
            contribution.append({
                "symbol": item.get("symbol"), "market": item["market"], "weight": round(item["weight"], 6),
                "period_return": round(period_return, 6) if period_return is not None else None,
                "return_contribution": round(item["weight"] * period_return, 6) if period_return is not None else None,
                "data_available": bool(series),
            })
        contribution.sort(key=lambda row: abs(row.get("return_contribution") or 0), reverse=True)

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
            "benchmark_symbol": request.benchmark_symbol, "total_value": round(total_value, 2), "equity_value": round(equity_value, 2),
            "cash_value": round(cash_value, 2), "metrics": metrics, "contribution": contribution,
            "exposures": exposures, "scenario": scenario, "rebalance": rebalance, "thesis_links": thesis_links,
            "coverage": {"holdings": len(holdings), "history_available": len(available_holdings), "history_weight": round(available_weight, 6)},
            "warnings": warnings,
            "limitations": [
                "Returns replay current weights over history; they are not transaction-aware TWR or IRR.",
                "Money-weighted IRR is only calculated when complete user-supplied cash flows are provided.",
                "Cross-currency values are not FX-normalized unless the source portfolio already uses a common denominator.",
                "Missing histories are excluded and reported in coverage.",
            ],
        }

    def _empty_portfolio_result(self, request: PortfolioLabRequest, warnings: list[str]) -> dict[str, Any]:
        return {"as_of": _now(), "methodology": "current_weight_historical_replay", "lookback_days": request.lookback_days,
                "benchmark_symbol": request.benchmark_symbol, "total_value": 0, "equity_value": 0, "cash_value": 0,
                "metrics": {}, "contribution": [], "exposures": {}, "scenario": {}, "rebalance": [],
                "thesis_links": [], "coverage": {"holdings": 0, "history_available": 0, "history_weight": 0},
                "warnings": warnings, "limitations": ["No analyzable portfolio data."]}

    @staticmethod
    def _returns_from_bars(bars: list[dict[str, Any]]) -> dict[int, float]:
        ordered = sorted(
            ((int(bar.get("timestamp") or 0), _number(bar.get("close"))) for bar in bars), key=lambda item: item[0]
        )
        result = {}
        for index in range(1, len(ordered)):
            timestamp, close = ordered[index]
            previous = ordered[index - 1][1]
            if close is not None and previous not in (None, 0):
                result[timestamp] = close / previous - 1
        return result

    @staticmethod
    def _weighted_returns(holdings: list[dict[str, Any]], series: dict[str, dict[int, float]], denominator: float) -> dict[int, float]:
        if not holdings or denominator <= 0:
            return {}
        dates = set.intersection(*(set(series[item["symbol"]]) for item in holdings))
        return {
            timestamp: sum((item["weight"] / denominator) * series[item["symbol"]][timestamp] for item in holdings)
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
            covariance = sum((a - statistics.mean(left)) * (b - statistics.mean(right)) for a, b in zip(left, right)) / (len(common) - 1)
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
            occurred_at = str(item.get("date") or item.get("occurred_at") or "")
            try:
                date = datetime.fromisoformat(occurred_at.replace("Z", "+00:00"))
            except ValueError:
                continue
            if date.tzinfo is None:
                date = date.replace(tzinfo=timezone.utc)
            if amount is not None:
                parsed.append((date, amount))
        parsed.append((datetime.now(timezone.utc), terminal_value))
        if len(parsed) < 2 or not any(amount < 0 for _, amount in parsed) or not any(amount > 0 for _, amount in parsed):
            return None
        parsed.sort(key=lambda item: item[0])
        start = parsed[0][0]

        def npv(rate: float) -> float:
            return sum(amount / ((1 + rate) ** max((date - start).total_seconds() / 31_557_600, 0)) for date, amount in parsed)

        low, high = -0.9999, 10.0
        if npv(low) * npv(high) > 0:
            return None
        for _ in range(100):
            middle = (low + high) / 2
            if npv(low) * npv(middle) <= 0:
                high = middle
            else:
                low = middle
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
        links = []
        for item in holdings:
            theses = self.research.list_theses(user_id, item["symbol"])
            thesis = theses[0] if theses else None
            links.append({"symbol": item["symbol"], "weight": round(item["weight"], 6), "thesis_snapshot_id": thesis["id"] if thesis else None,
                          "confidence": thesis["payload"].get("confidence") if thesis else None,
                          "risks": thesis["payload"].get("risks", []) if thesis else [],
                          "invalidation_conditions": thesis["payload"].get("invalidation_conditions", []) if thesis else []})
        return links

    def create_valuation_model(self, user_id: str, symbol: str, request: ValuationModelCreate) -> dict[str, Any]:
        symbol = self.research.normalize_symbol(symbol)
        if request.thesis_snapshot_id:
            self.research.get_thesis(user_id, request.thesis_snapshot_id)
        if request.model_id:
            previous = self.get_valuation_model(user_id, request.model_id)
            if previous["symbol"] != symbol:
                raise ValueError("model symbol cannot change")
            model_key = previous["model_key"]
        else:
            model_key = f"valuation_{uuid.uuid4().hex[:16]}"
        with self._connect() as connection:
            version = int(connection.execute(
                "SELECT COALESCE(MAX(version),0)+1 FROM valuation_models WHERE user_id=? AND model_key=?", (user_id, model_key)
            ).fetchone()[0])
        result = self._calculate_valuation(request.model_type, request.assumptions)
        model_id = f"val_{uuid.uuid4().hex[:20]}"
        with self._connect() as connection:
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
            if target_price is None:
                raise ValueError("reverse DCF requires target_price")
            low, high = -0.5, 1.0
            for _ in range(80):
                growth = (low + high) / 2
                trial = {**assumptions, "revenue_growth": growth}
                price = InvestmentLabService._dcf(trial)["value_per_share"]
                if price < target_price:
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
        years = int(_number(assumptions.get("years"), 5) or 5)
        if years < 1 or years > 20 or wacc <= terminal_growth or shares <= 0:
            raise ValueError("invalid DCF horizon, discount rate, terminal growth or share count")
        cash = _number(assumptions.get("cash"), 0) or 0
        debt = _number(assumptions.get("debt"), 0) or 0
        forecasts, present_value = [], 0.0
        current_revenue = revenue
        for year in range(1, years + 1):
            current_revenue *= 1 + growth
            fcf = current_revenue * fcf_margin
            pv = fcf / ((1 + wacc) ** year)
            present_value += pv
            forecasts.append({"year": year, "revenue": round(current_revenue, 4), "fcf": round(fcf, 4), "present_value": round(pv, 4)})
        terminal_value = forecasts[-1]["fcf"] * (1 + terminal_growth) / (wacc - terminal_growth)
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
                    tv = forecasts[-1]["fcf"] * (1 + test_terminal) / (test_wacc - test_terminal)
                    ev = sum(item["fcf"] / ((1 + test_wacc) ** item["year"]) for item in forecasts) + tv / ((1 + test_wacc) ** years)
                    value = round((ev + cash - debt) / shares, 4)
                row.append({"wacc": round(test_wacc, 4), "terminal_growth": round(test_terminal, 4), "value_per_share": value})
            sensitivity.extend(row)
        return {"enterprise_value": round(enterprise_value, 4), "equity_value": round(equity_value, 4),
                "value_per_share": round(value_per_share, 4), "terminal_value_share": round(terminal_pv / enterprise_value, 6) if enterprise_value else None,
                "forecast": forecasts, "sensitivity": sensitivity}

    def compare_peers(self, request: PeerComparisonRequest, *, settings=None) -> dict[str, Any]:
        rows, errors = [], []
        for raw_symbol in request.symbols:
            symbol = self.research.normalize_symbol(raw_symbol)
            try:
                payload = self.fundamentals.get_security_insights(symbol, settings=settings)
                valuation = payload.get("valuation") or {}
                company = payload.get("company") or {}
                metrics = {metric: self._find_metric(valuation, metric) for metric in request.metrics}
                rows.append({"symbol": symbol, "name": self._find_metric(company, "name") or symbol, "metrics": metrics,
                             "source": payload.get("source"), "fetched_at": payload.get("fetched_at"),
                             "available": any(value is not None for value in metrics.values())})
            except Exception as exc:
                errors.append({"symbol": symbol, "error": str(exc)})
                rows.append({"symbol": symbol, "name": symbol, "metrics": {metric: None for metric in request.metrics}, "available": False})
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
            "pe_ttm_ratio": {"pe_ttm_ratio", "pe_ttm", "pe_ratio"}, "pb_ratio": {"pb_ratio", "pb"},
            "ps_ttm_ratio": {"ps_ttm_ratio", "ps_ttm", "ps_ratio"}, "market_cap": {"market_cap", "total_market_cap"},
            "name": {"name", "name_cn", "name_hk", "name_en"},
        }.get(key, {key})
        if isinstance(value, dict):
            for alias in aliases:
                if alias in value and value[alias] not in (None, ""):
                    return value[alias]
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
        try:
            infos = self.market.get_security_static_info([symbol], settings=settings)
            static_info = infos[0] if infos else {}
        except Exception as exc:
            errors.append(f"static_info: {exc}")
        try:
            payload = self.fundamentals.get_security_insights(symbol, settings=settings)
            insights = {key: payload.get(key) for key in ("filings", "company", "valuation", "dividends", "institution_rating", "corporate_actions")}
            fetched_at = payload.get("fetched_at")
        except Exception as exc:
            errors.append(f"fundamentals: {exc}")
            fetched_at = None
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
