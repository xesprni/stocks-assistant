"""提醒规则的实时数据求值器，供手动检查与后台调度共同复用。"""

from __future__ import annotations

from typing import Any, Optional

from app.config import get_effective_settings
from app.core.notifications import TelegramSender
from app.core.research.service import ResearchService


def evaluate_due_alerts(
    research: ResearchService,
    *,
    market_service,
    fundamental_service,
    news_service,
    user_id: Optional[str] = None,
    force: bool = False,
) -> dict[str, Any]:
    """按用户有效凭据检查规则；单条失败只记录到规则，不中断其余规则。"""
    rules = research.list_alert_rules(user_id, due_only=not force)
    created = []
    errors = []
    for rule in rules:
        try:
            settings = get_effective_settings(rule["user_id"])
            observations = _observations_for_rule(
                rule,
                settings=settings,
                research=research,
                market_service=market_service,
                fundamental_service=fundamental_service,
                news_service=news_service,
            )
            for observation in observations:
                event = research.record_evaluation(
                    rule["user_id"],
                    rule["id"],
                    observed_value=observation.get("value"),
                    observed_at=observation.get("observed_at"),
                    event_key=observation.get("event_key"),
                    title=observation.get("title"),
                    source=observation.get("source"),
                )
                if event:
                    created.append(event)
                    _deliver_event(research, rule, event, settings)
            if not observations:
                research.record_evaluation(rule["user_id"], rule["id"], observed_value=None)
        except Exception as exc:
            research.mark_rule_error(rule, str(exc))
            errors.append({"rule_id": rule["id"], "error": str(exc)})
    retried = 0
    # 手动求值或用户点击“重试”只把事件置为 pending；统一在求值循环中完成外部投递。
    for event in research.list_pending_deliveries(user_id):
        try:
            event_user_id = event["user_id"]
            rule = research.get_alert_rule(event_user_id, event["rule_id"])
            _deliver_event(research, rule, event, get_effective_settings(event_user_id))
            retried += 1
        except Exception as exc:
            research.set_alert_delivery_result(event["user_id"], event["id"], delivered=False, error=str(exc))
            errors.append({"event_id": event["id"], "error": str(exc)})
    return {"checked": len(rules), "created": len(created), "events": created, "delivery_retried": retried, "errors": errors}


def _observations_for_rule(rule: dict[str, Any], *, settings, research, market_service, fundamental_service, news_service) -> list[dict[str, Any]]:
    symbol = rule["symbol"]
    kind = rule["condition_type"]
    metadata = rule.get("metadata") or {}
    if kind in {"price", "volume"}:
        payload = market_service.get_realtime_quotes([symbol], settings=settings)
        quote = (payload.get("quotes") or [None])[0] or {}
        field = "last_done" if kind == "price" else "volume"
        return [{
            "value": quote.get(field),
            "observed_at": quote.get("timestamp") or payload.get("fetched_at"),
            "event_key": f"{kind}:{quote.get('timestamp') or payload.get('fetched_at') or quote.get(field)}",
            "source": {"provider": "Longbridge OpenAPI", "symbol": symbol, "as_of": quote.get("timestamp"), "fetched_at": payload.get("fetched_at")},
        }]
    if kind == "technical":
        metric = str(metadata.get("metric") or "RSI").upper()
        payload = market_service.get_technical_indicators(symbol, indicators=[metric], settings=settings)
        latest = payload.get("latest") or {}
        value = latest.get(metric) or latest.get(metric.lower())
        return [{"value": value, "event_key": f"technical:{metric}:{payload.get('as_of') or value}", "source": {"provider": "Longbridge OpenAPI", "symbol": symbol, "as_of": payload.get("as_of")}}]
    if kind in {"news", "keyword"}:
        payload = news_service.get_security_news(symbol, limit=10, settings=settings)
        results = []
        for item in payload.get("news") or []:
            text = f"{item.get('title') or ''} {item.get('description') or ''}".strip()
            results.append({
                "value": text if kind == "keyword" else True,
                "observed_at": item.get("published_at"), "event_key": str(item.get("id") or item.get("url") or text),
                "title": item.get("title") or rule["name"],
                "source": {"provider": "Longbridge OpenAPI", "url": item.get("url"), "published_at": item.get("published_at"), "symbol": symbol},
            })
        return results
    if kind in {"filing", "rating", "corporate_action", "valuation", "kpi"}:
        payload = fundamental_service.get_security_insights(symbol, settings=settings)
        section_name = {
            "filing": "filings", "rating": "institution_rating", "corporate_action": "corporate_actions",
            "valuation": "valuation", "kpi": "company",
        }[kind]
        section = payload.get(section_name) or {}
        if kind in {"valuation", "kpi"}:
            metric = str(metadata.get("metric") or ("pe_ttm_ratio" if kind == "valuation" else "revenue"))
            value = _find_value(section, metric)
            return [{"value": value, "event_key": f"{kind}:{metric}:{payload.get('fetched_at') or value}", "source": {"provider": "Longbridge OpenAPI", "symbol": symbol, "as_of": payload.get("fetched_at")}}]
        results = []
        for item in section.get("items") or []:
            identity = item.get("id") or item.get("url") or item.get("title") or str(item)[:200]
            results.append({
                "value": True, "event_key": f"{kind}:{identity}",
                "observed_at": item.get("published_at") or payload.get("fetched_at"),
                "title": item.get("title") or item.get("name") or rule["name"],
                "source": {"provider": "Longbridge OpenAPI", "url": item.get("url"), "published_at": item.get("published_at"), "symbol": symbol},
            })
        return results
    if kind == "portfolio_risk":
        context = research._portfolio_context(rule["user_id"], symbol)
        field = str(metadata.get("metric") or "shares")
        return [{"value": context.get(field), "event_key": f"portfolio:{field}:{context.get(field)}", "source": {"provider": "Stocks Assistant Portfolio", "symbol": symbol}}]
    return []


def _find_value(value: Any, key: str) -> Any:
    if isinstance(value, dict):
        if key in value:
            return value[key]
        for child in value.values():
            found = _find_value(child, key)
            if found is not None:
                return found
    elif isinstance(value, list):
        for child in value:
            found = _find_value(child, key)
            if found is not None:
                return found
    return None


def _deliver_event(research: ResearchService, rule: dict[str, Any], event: dict[str, Any], settings) -> None:
    if "telegram" not in rule.get("channels", []):
        return
    try:
        sender = TelegramSender.from_settings(settings)
        sender.send_message(f"# {event['title']}\n\n{event['explanation']}")
        research.set_alert_delivery_result(rule["user_id"], event["id"], delivered=True)
    except Exception as exc:
        research.set_alert_delivery_result(rule["user_id"], event["id"], delivered=False, error=str(exc))
