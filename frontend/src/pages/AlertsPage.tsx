import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bell, Check, Clock, ExternalLink, Loader2, Play, Plus, RefreshCw, RotateCcw, Trash2 } from "lucide-react";

import type { ConfirmFn } from "@/components/common/ConfirmDialog";
import { Field } from "@/components/common/Field";
import { useErrorToast } from "@/components/common/Toast";
import { SchedulerPage } from "@/pages/SchedulerPage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  createAlertRule, deleteAlertRule, evaluateLiveAlerts, listAlertEvents, listAlertRules,
  retryAlertDelivery, setAlertEventStatus, updateAlertRule,
} from "@/lib/api";
import type { AppLanguage } from "@/lib/i18n";
import type { AlertEvent, AlertRule } from "@/types/app";

type AlertTab = "inbox" | "rules" | "scheduled";

const text = {
  zh: { inbox: "提醒收件箱", rules: "监控规则", scheduled: "定时任务", check: "立即检查", add: "新增规则", empty: "暂无提醒事件", noRules: "暂无监控规则", read: "已读", dismiss: "忽略", retry: "重试投递", delete: "删除", symbol: "标的", name: "规则名称", type: "条件", operator: "运算", threshold: "阈值/关键词", severity: "严重度", interval: "检查间隔（秒）", telegram: "Telegram", save: "创建规则", source: "查看来源", failed: "加载提醒失败" },
  en: { inbox: "Alert Inbox", rules: "Monitoring Rules", scheduled: "Scheduled Tasks", check: "Check now", add: "New rule", empty: "No alert events", noRules: "No monitoring rules", read: "Read", dismiss: "Dismiss", retry: "Retry delivery", delete: "Delete", symbol: "Symbol", name: "Rule name", type: "Condition", operator: "Operator", threshold: "Threshold / keyword", severity: "Severity", interval: "Check interval (sec)", telegram: "Telegram", save: "Create rule", source: "Open source", failed: "Failed to load alerts" },
} as const;

const conditionTypes: AlertRule["condition_type"][] = ["price", "volume", "valuation", "kpi", "technical", "news", "filing", "keyword", "rating", "corporate_action", "portfolio_risk"];
const operators = ["gt", "gte", "lt", "lte", "eq", "contains", "changed"];

export function AlertsPage({
  confirmAction,
  initialSymbol = "",
  language,
  telegramEnabled,
}: {
  confirmAction: ConfirmFn;
  initialSymbol?: string;
  language: AppLanguage;
  telegramEnabled: boolean;
}) {
  const copy = text[language];
  const [tab, setTab] = useState<AlertTab>(initialSymbol ? "rules" : "inbox");
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ symbol: initialSymbol, name: "", condition_type: "price", operator: "gt", threshold: "", severity: "medium", evaluation_interval_seconds: 300, telegram: false });
  useErrorToast(error, copy.inbox);

  const unread = useMemo(() => events.filter((event) => event.status === "unread").length, [events]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [nextRules, nextEvents] = await Promise.all([
        listAlertRules(initialSymbol || undefined),
        listAlertEvents(initialSymbol || undefined),
      ]);
      setRules(nextRules);
      setEvents(nextEvents);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.failed);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [initialSymbol]);

  async function handleCreate() {
    if (!form.symbol.trim() || !form.name.trim()) return;
    try {
      const eventKind = ["news", "filing", "rating", "corporate_action"].includes(form.condition_type);
      await createAlertRule({
        symbol: form.symbol.trim().toUpperCase(), name: form.name.trim(), condition_type: form.condition_type,
        operator: eventKind ? "changed" : form.operator,
        threshold: eventKind ? true : (["contains", "eq"].includes(form.operator) ? form.threshold : Number(form.threshold)),
        severity: form.severity, channels: form.telegram ? ["in_app", "telegram"] : ["in_app"],
        evaluation_interval_seconds: Number(form.evaluation_interval_seconds),
        metadata: form.condition_type === "technical" ? { metric: "RSI" } : form.condition_type === "kpi" ? { metric: "revenue" } : {},
      });
      setShowForm(false);
      setForm((current) => ({ ...current, name: "", threshold: "" }));
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.failed);
    }
  }

  async function handleCheck() {
    setChecking(true);
    try {
      await evaluateLiveAlerts();
      await load();
      setTab("inbox");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.failed);
    } finally {
      setChecking(false);
    }
  }

  async function handleDelete(rule: AlertRule) {
    const confirmed = await confirmAction({ title: copy.delete, description: rule.name, confirmText: copy.delete, cancelText: language === "en" ? "Cancel" : "取消", destructive: true });
    if (!confirmed) return;
    await deleteAlertRule(rule.id);
    await load();
  }

  async function handleStatus(event: AlertEvent, status: AlertEvent["status"]) {
    const next = await setAlertEventStatus(event.id, status);
    setEvents((current) => current.map((item) => item.id === next.id ? next : item));
  }

  if (tab === "scheduled") {
    return (
      <section className="flex min-h-0 flex-1 flex-col gap-3">
        <AlertTabs active={tab} copy={copy} onChange={setTab} unread={unread} />
        <SchedulerPage confirmAction={confirmAction} language={language} telegramEnabled={telegramEnabled} />
      </section>
    );
  }

  return (
    <section className="panel motion-panel page-enter flex min-h-0 min-w-0 flex-1 flex-col rounded-md lg:h-full">
      <div className="page-toolbar flex flex-wrap items-center justify-between gap-2">
        <AlertTabs active={tab} copy={copy} onChange={setTab} unread={unread} />
        <div className="flex items-center gap-2">
          <Button disabled={checking} onClick={() => void handleCheck()} size="sm" variant="outline">
            {checking ? <Loader2 className="animate-spin" /> : <Play />}{copy.check}
          </Button>
          {tab === "rules" ? <Button onClick={() => setShowForm((value) => !value)} size="sm"><Plus />{copy.add}</Button> : null}
          <Button disabled={loading} onClick={() => void load()} size="icon" variant="ghost"><RefreshCw className={loading ? "animate-spin" : ""} /></Button>
        </div>
      </div>
      <div className="panel-body min-h-0 flex-1 space-y-3 lg:overflow-y-auto">
        {tab === "rules" && showForm ? (
          <div className="rounded-md border border-border/80 bg-background/60 p-3">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Field label={copy.symbol}><Input disabled={Boolean(initialSymbol)} value={form.symbol} onChange={(event) => setForm({ ...form, symbol: event.target.value })} /></Field>
              <Field label={copy.name}><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
              <Field label={copy.type}><Select options={conditionTypes.map((value) => ({ label: value, value }))} value={form.condition_type} onValueChange={(value) => setForm({ ...form, condition_type: value })} /></Field>
              <Field label={copy.operator}><Select options={operators.map((value) => ({ label: value, value }))} value={form.operator} onValueChange={(value) => setForm({ ...form, operator: value })} /></Field>
              <Field label={copy.threshold}><Input value={form.threshold} onChange={(event) => setForm({ ...form, threshold: event.target.value })} /></Field>
              <Field label={copy.severity}><Select options={["info", "low", "medium", "high", "critical"].map((value) => ({ label: value, value }))} value={form.severity} onValueChange={(value) => setForm({ ...form, severity: value })} /></Field>
              <Field label={copy.interval}><Input min={30} type="number" value={form.evaluation_interval_seconds} onChange={(event) => setForm({ ...form, evaluation_interval_seconds: Number(event.target.value) })} /></Field>
              <label className="flex items-end gap-2 pb-2 text-sm"><input checked={form.telegram} disabled={!telegramEnabled} onChange={(event) => setForm({ ...form, telegram: event.target.checked })} type="checkbox" />{copy.telegram}</label>
            </div>
            <Button className="mt-3" onClick={() => void handleCreate()} size="sm">{copy.save}</Button>
          </div>
        ) : null}

        {loading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="animate-spin" />Loading...</div> : tab === "rules" ? (
          rules.length ? rules.map((rule) => (
            <article className="rounded-md border border-border/80 bg-background/60 p-3" key={rule.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><div className="flex flex-wrap items-center gap-2"><strong>{rule.name}</strong><Badge variant="outline">{rule.symbol}</Badge><Badge variant={rule.enabled ? "secondary" : "muted"}>{rule.enabled ? "ON" : "OFF"}</Badge><Badge variant="outline">{rule.severity}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{rule.condition_type} · {rule.operator} · {String(rule.threshold)} · {rule.evaluation_interval_seconds}s</p>{rule.last_error ? <p className="mt-1 text-xs text-destructive">{rule.last_error}</p> : null}</div>
                <div className="flex gap-1"><Button onClick={() => void updateAlertRule(rule.id, { enabled: !rule.enabled }).then(load)} size="sm" variant="outline">{rule.enabled ? "Disable" : "Enable"}</Button><Button onClick={() => void handleDelete(rule)} size="icon" variant="ghost"><Trash2 /></Button></div>
              </div>
            </article>
          )) : <Empty icon={<Bell />} text={copy.noRules} />
        ) : events.length ? events.map((event) => (
          <article className="rounded-md border border-border/80 bg-background/60 p-3" key={event.id}>
            <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Badge variant={event.status === "unread" ? "secondary" : "outline"}>{event.status}</Badge><Badge variant="outline">{event.severity}</Badge><strong className="truncate">{event.title}</strong><a className="text-xs text-primary hover:underline" href={`/security/${encodeURIComponent(event.symbol)}/alerts`}>{event.symbol}</a></div><p className="mt-2 text-sm leading-6 text-muted-foreground">{event.explanation}</p><p className="mt-2 text-xs text-muted-foreground">{new Date(event.occurred_at).toLocaleString()} · delivery {event.delivery_status}</p></div><div className="flex flex-wrap gap-1">{event.status === "unread" ? <Button onClick={() => void handleStatus(event, "read")} size="sm" variant="outline"><Check />{copy.read}</Button> : null}<Button onClick={() => void handleStatus(event, "dismissed")} size="sm" variant="ghost">{copy.dismiss}</Button>{event.delivery_status === "failed" ? <Button onClick={() => void retryAlertDelivery(event.id).then(() => evaluateLiveAlerts()).then(load)} size="sm" variant="outline"><RotateCcw />{copy.retry}</Button> : null}{typeof event.source.url === "string" ? <Button asChild size="sm" variant="outline"><a href={event.source.url} rel="noreferrer" target="_blank"><ExternalLink />{copy.source}</a></Button> : null}</div></div>
          </article>
        )) : <Empty icon={<Bell />} text={copy.empty} />}
      </div>
    </section>
  );
}

function AlertTabs({ active, copy, onChange, unread }: { active: AlertTab; copy: typeof text.zh | typeof text.en; onChange: (tab: AlertTab) => void; unread: number }) {
  return <div className="flex flex-wrap items-center gap-1">{(["inbox", "rules", "scheduled"] as AlertTab[]).map((tab) => <Button key={tab} onClick={() => onChange(tab)} size="sm" variant={active === tab ? "secondary" : "ghost"}>{tab === "inbox" ? <Bell /> : tab === "scheduled" ? <Clock /> : <RefreshCw />}{copy[tab]}{tab === "inbox" && unread ? <Badge variant="secondary">{unread}</Badge> : null}</Button>)}</div>;
}

function Empty({ icon, text: value }: { icon: ReactNode; text: string }) {
  return <div className="grid place-items-center rounded-md border border-dashed border-border/80 px-4 py-12 text-sm text-muted-foreground"><span className="mb-2">{icon}</span>{value}</div>;
}
