import { useEffect, useMemo, useState } from "react";
import { BarChart3, Bell, BookOpen, Bot, BriefcaseBusiness, Building2, ExternalLink, FileText, Loader2, Plus, RefreshCw, Save, ScrollText, Sparkles, Upload } from "lucide-react";

import { FinancialReportsPage } from "@/components/FinancialReportsPage";
import { Field } from "@/components/common/Field";
import type { ConfirmFn } from "@/components/common/ConfirmDialog";
import { AlertsPage } from "@/pages/AlertsPage";
import { NewsPage } from "@/pages/NewsPage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createResearchDecision, createResearchDocument, createThesisSnapshot, getCandlesticks,
  getDashboardSymbolInsights, getResearchDocument, getSecurityWorkspaceSummary,
  listResearchDecisions, listResearchDocuments, listResearchEvidence, listThesisSnapshots,
  saveResearchEvidence, updateResearchDecision, uploadResearchDocument,
} from "@/lib/api";
import type { AppLanguage } from "@/lib/i18n";
import type { CandlestickItem, DashboardSymbolInsightsResponse, ResearchDecision, ResearchDocument, ResearchEvidence, SecurityWorkspaceSummary, ThesisPayload, ThesisSnapshot } from "@/types/app";

export type CompanyTab = "overview" | "chart" | "financials" | "documents" | "news" | "ai-research" | "thesis" | "position" | "alerts";

const tabs: Array<{ id: CompanyTab; icon: typeof Building2 }> = [
  { id: "overview", icon: Building2 }, { id: "chart", icon: BarChart3 }, { id: "financials", icon: ScrollText },
  { id: "documents", icon: FileText }, { id: "news", icon: BookOpen }, { id: "ai-research", icon: Bot },
  { id: "thesis", icon: Sparkles }, { id: "position", icon: BriefcaseBusiness }, { id: "alerts", icon: Bell },
];

const labels: Record<AppLanguage, Record<CompanyTab, string>> = {
  zh: { overview: "概览", chart: "图表", financials: "财务", documents: "材料", news: "新闻", "ai-research": "AI 研究", thesis: "Thesis", position: "持仓", alerts: "提醒" },
  en: { overview: "Overview", chart: "Chart", financials: "Financials", documents: "Documents", news: "News", "ai-research": "AI Research", thesis: "Thesis", position: "Position", alerts: "Alerts" },
};

const emptyThesis: ThesisPayload = {
  business_model: "", key_drivers: [], kpis: [], bull_case: "", base_case: "", bear_case: "",
  valuation_assumptions: {}, expected_range: {}, catalysts: [], risks: [], invalidation_conditions: [],
  confidence: 0.5, time_horizon: "", next_review_at: null,
};

export function CompanyWorkspacePage({
  confirmAction,
  language,
  onAskAgent,
  onNavigateTab,
  onOpenPortfolio,
  symbol,
  tab,
  telegramEnabled,
}: {
  confirmAction: ConfirmFn;
  language: AppLanguage;
  onAskAgent: (prompt: string) => void;
  onNavigateTab: (tab: CompanyTab) => void;
  onOpenPortfolio: () => void;
  symbol: string;
  tab: CompanyTab;
  telegramEnabled: boolean;
}) {
  const [summary, setSummary] = useState<SecurityWorkspaceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadSummary() {
    setLoading(true);
    setError("");
    try { setSummary(await getSecurityWorkspaceSummary(symbol)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Failed to load company workspace"); }
    finally { setLoading(false); }
  }

  useEffect(() => { void loadSummary(); }, [symbol]);

  return (
    <section className="panel motion-panel page-enter flex min-h-0 min-w-0 flex-1 flex-col rounded-md lg:h-full">
      <div className="page-toolbar flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2"><span className="grid size-9 place-items-center rounded-md bg-primary/10 text-primary"><Building2 /></span><div><h1 className="text-base font-semibold">{symbol}</h1><p className="text-xs text-muted-foreground">{language === "en" ? "Persistent company research workspace" : "可持续维护的公司研究工作区"}</p></div>{summary?.watchlisted ? <Badge variant="outline">Watchlist</Badge> : null}{summary?.position ? <Badge variant="secondary">Position</Badge> : null}</div>
        <Button disabled={loading} onClick={() => void loadSummary()} size="icon" variant="ghost">{loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}</Button>
      </div>
      <div className="flex flex-wrap gap-1 border-b border-border/70 px-3 py-2">{tabs.map(({ id, icon: Icon }) => <Button key={id} onClick={() => onNavigateTab(id)} size="sm" variant={tab === id ? "secondary" : "ghost"}><Icon />{labels[language][id]}{id === "alerts" && summary?.unread_alerts ? <Badge variant="secondary">{summary.unread_alerts}</Badge> : null}</Button>)}</div>
      <div className="panel-body min-h-0 flex-1 lg:overflow-y-auto">
        {error ? <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div> : null}
        {tab === "overview" ? <div className="space-y-4"><Overview language={language} loading={loading} summary={summary} symbol={symbol} /><EvidencePanel language={language} symbol={symbol} /></div> : null}
        {tab === "chart" ? <ChartTab language={language} symbol={symbol} /> : null}
        {tab === "financials" ? <FinancialReportsPage initialSymbol={symbol} language={language} /> : null}
        {tab === "documents" ? <DocumentsTab language={language} onChanged={loadSummary} symbol={symbol} /> : null}
        {tab === "news" ? <NewsPage initialSymbol={symbol} language={language} /> : null}
        {tab === "ai-research" ? <AIResearch language={language} onAskAgent={onAskAgent} symbol={symbol} /> : null}
        {tab === "thesis" ? <ThesisTab language={language} onChanged={loadSummary} symbol={symbol} /> : null}
        {tab === "position" ? <PositionTab language={language} onOpenPortfolio={onOpenPortfolio} summary={summary} symbol={symbol} /> : null}
        {tab === "alerts" ? <AlertsPage confirmAction={confirmAction} initialSymbol={symbol} language={language} telegramEnabled={telegramEnabled} /> : null}
      </div>
    </section>
  );
}

function EvidencePanel({ language, symbol }: { language: AppLanguage; symbol: string }) {
  const [evidence, setEvidence] = useState<ResearchEvidence[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { listResearchEvidence(symbol).then(setEvidence).catch((caught) => setError(caught instanceof Error ? caught.message : "Unavailable")); }, [symbol]);

  async function setRelation(item: ResearchEvidence, relation: "supports" | "weakens" | "neutral") {
    const next = await saveResearchEvidence(symbol, { source_id: item.source_id, source: item.source, relation, note: item.note });
    setEvidence((current) => current.map((value) => value.id === next.id ? next : value));
  }

  return (
    <div className="rounded-md border border-border/80 bg-background/60 p-4">
      <div className="mb-3 flex items-center justify-between gap-2"><div><h2 className="text-sm font-semibold">{language === "en" ? "Saved evidence" : "已保存证据"}</h2><p className="text-xs text-muted-foreground">{language === "en" ? "Classify each source before attaching its ID to a Thesis snapshot." : "先标记证据与论点的关系，再将其 ID 关联到 Thesis 快照。"}</p></div><Badge variant="outline">{evidence.length}</Badge></div>
      {error ? <p className="text-sm text-destructive">{error}</p> : evidence.length ? <div className="space-y-2">{evidence.map((item) => <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2" key={item.id}><div className="min-w-0"><div className="flex items-center gap-2">{item.source.url ? <a className="truncate text-sm font-medium hover:text-primary" href={item.source.url} rel="noreferrer" target="_blank">{item.source.title || item.source_id}<ExternalLink className="ml-1 inline size-3" /></a> : <span className="truncate text-sm font-medium">{item.source.title || item.source_id}</span>}<Badge variant="outline">{item.source.provider}</Badge></div><code className="text-[10px] text-muted-foreground">{item.source_id}</code></div><div className="flex gap-1">{(["supports", "weakens", "neutral"] as const).map((relation) => <Button key={relation} onClick={() => void setRelation(item, relation)} size="sm" variant={item.relation === relation ? "secondary" : "ghost"}>{relation}</Button>)}</div></div>)}</div> : <p className="text-sm text-muted-foreground">{language === "en" ? "Save cited Agent sources to build a reviewable evidence set." : "可从 Agent 回答的引用来源一键保存证据。"}</p>}
    </div>
  );
}

function Overview({ language, loading, summary, symbol }: { language: AppLanguage; loading: boolean; summary: SecurityWorkspaceSummary | null; symbol: string }) {
  const [insights, setInsights] = useState<DashboardSymbolInsightsResponse | null>(null);
  const [insightError, setInsightError] = useState("");
  useEffect(() => { getDashboardSymbolInsights(symbol).then(setInsights).catch((caught) => setInsightError(caught instanceof Error ? caught.message : "Unavailable")); }, [symbol]);
  if (loading && !summary) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="animate-spin" />Loading...</div>;
  const cards = [
    [language === "en" ? "Thesis versions" : "Thesis 版本", summary?.thesis_versions ?? 0],
    [language === "en" ? "Documents" : "研究材料", summary?.documents ?? 0],
    [language === "en" ? "Alert rules" : "提醒规则", summary?.alert_rules ?? 0],
    [language === "en" ? "Unread" : "未读提醒", summary?.unread_alerts ?? 0],
  ];
  return <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, value]) => <div className="rounded-md border border-border/80 bg-background/60 p-3" key={String(label)}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>)}</div>{summary?.latest_thesis ? <div className="rounded-md border border-primary/25 bg-primary/5 p-4"><div className="flex flex-wrap gap-2"><Badge>Thesis v{summary.latest_thesis.version}</Badge><Badge variant="outline">{Math.round(summary.latest_thesis.payload.confidence * 100)}%</Badge></div><p className="mt-3 text-sm leading-6">{summary.latest_thesis.payload.business_model || summary.latest_thesis.payload.base_case}</p><p className="mt-2 text-xs text-muted-foreground">{summary.latest_thesis.reason}</p></div> : null}<div className="grid gap-3 lg:grid-cols-3">{insights ? (["filings", "valuation", "institution_rating", "corporate_actions", "dividends", "company"] as const).map((key) => <div className="rounded-md border border-border/80 bg-background/60 p-3" key={key}><div className="flex items-center justify-between"><strong className="text-sm capitalize">{key.replaceAll("_", " ")}</strong><Badge variant={insights[key].available ? "outline" : "muted"}>{insights[key].total}</Badge></div>{insights[key].error ? <p className="mt-2 text-xs text-muted-foreground">{insights[key].error}</p> : null}</div>) : <p className="text-sm text-muted-foreground">{insightError}</p>}</div>{summary?.latest_decisions?.length ? <div><h2 className="mb-2 text-sm font-semibold">{language === "en" ? "Recent decisions" : "最近决策"}</h2>{summary.latest_decisions.map((decision) => <p className="border-t border-border/60 py-2 text-sm" key={decision.id}><strong>{decision.action}</strong> · {decision.rationale}</p>)}</div> : null}</div>;
}

function ChartTab({ language, symbol }: { language: AppLanguage; symbol: string }) {
  const [bars, setBars] = useState<CandlestickItem[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { getCandlesticks(symbol, "1D", 90).then((value) => setBars(value.bars)).catch((caught) => setError(caught instanceof Error ? caught.message : "Unavailable")); }, [symbol]);
  const latest = bars.slice(-30).reverse();
  return <div><div className="mb-3"><h2 className="text-base font-semibold">{language === "en" ? "Daily price context" : "日线价格上下文"}</h2><p className="text-xs text-muted-foreground">{language === "en" ? "Latest 30 of 90 fetched bars; use evidence timestamps before drawing a conclusion." : "展示最近 90 根中的 30 根；形成结论前请核对数据时间。"}</p></div>{error ? <p className="text-sm text-destructive">{error}</p> : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b border-border/70 text-muted-foreground">{["Date", "Open", "High", "Low", "Close", "Volume"].map((item) => <th className="px-2 py-2" key={item}>{item}</th>)}</tr></thead><tbody>{latest.map((bar) => <tr className="border-b border-border/50" key={bar.timestamp}><td className="px-2 py-2">{new Date(bar.timestamp * 1000).toLocaleDateString()}</td><td className="px-2">{bar.open}</td><td className="px-2">{bar.high}</td><td className="px-2">{bar.low}</td><td className="px-2 font-semibold">{bar.close}</td><td className="px-2">{bar.volume}</td></tr>)}</tbody></table></div>}</div>;
}

function AIResearch({ language, onAskAgent, symbol }: { language: AppLanguage; onAskAgent: (prompt: string) => void; symbol: string }) {
  const prompts = language === "en" ? [
    `Deep dive ${symbol}. Use company filings, valuation, ratings, news, my knowledge, and current Thesis. Separate facts from inference and cite sources.`,
    `Review the latest earnings evidence for ${symbol}; identify changes versus the current Thesis and propose items requiring human confirmation.`,
    `Assess how ${symbol} affects my portfolio risk, list invalidation conditions, and propose monitoring rules without giving an absolute trade instruction.`,
  ] : [
    `深度研究 ${symbol}：使用公司公告、估值、评级、新闻、我的知识库和当前 Thesis，区分事实与推断并逐项引用来源。`,
    `复盘 ${symbol} 最新财报证据，识别相对当前 Thesis 的变化，并列出需要人工确认的事项。`,
    `评估 ${symbol} 对组合风险的影响，列出证伪条件并建议监控规则，不给出绝对买卖指令。`,
  ];
  return <div className="grid gap-3 lg:grid-cols-3">{prompts.map((prompt, index) => <button className="rounded-md border border-border/80 bg-background/60 p-4 text-left transition hover:border-primary/40 hover:bg-primary/5" key={prompt} onClick={() => onAskAgent(prompt)}><Bot className="size-5 text-primary" /><strong className="mt-3 block text-sm">{language === "en" ? ["Company deep dive", "Earnings review", "Portfolio risk"][index] : ["公司 Deep Dive", "财报复盘", "持仓风险检查"][index]}</strong><p className="mt-2 text-xs leading-5 text-muted-foreground">{prompt}</p></button>)}</div>;
}

function ThesisTab({ language, onChanged, symbol }: { language: AppLanguage; onChanged: () => Promise<void>; symbol: string }) {
  const [versions, setVersions] = useState<ThesisSnapshot[]>([]);
  const [form, setForm] = useState<ThesisPayload>(emptyThesis);
  const [reason, setReason] = useState("");
  const [sourceIds, setSourceIds] = useState("");
  const [saving, setSaving] = useState(false);
  const [decisions, setDecisions] = useState<ResearchDecision[]>([]);
  const [decision, setDecision] = useState({ action: "", rationale: "" });
  async function load() { const [nextVersions, nextDecisions] = await Promise.all([listThesisSnapshots(symbol), listResearchDecisions(symbol)]); setVersions(nextVersions); setDecisions(nextDecisions); if (nextVersions[0]) setForm(nextVersions[0].payload); }
  useEffect(() => { void load(); }, [symbol]);
  const listValue = (values: string[]) => values.join("\n");
  const setList = (key: "key_drivers" | "catalysts" | "risks" | "invalidation_conditions", value: string) => setForm({ ...form, [key]: value.split("\n").map((item) => item.trim()).filter(Boolean) });
  async function save() { if (!reason.trim()) return; setSaving(true); try { await createThesisSnapshot(symbol, { payload: form, reason: reason.trim(), source_ids: sourceIds.split(/[\s,]+/).filter(Boolean) }); setReason(""); await load(); await onChanged(); } finally { setSaving(false); } }
  async function saveDecision() { if (!decision.action.trim() || !decision.rationale.trim()) return; await createResearchDecision(symbol, { ...decision, thesis_snapshot_id: versions[0]?.id }); setDecision({ action: "", rationale: "" }); await load(); await onChanged(); }
  return <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]"><div className="space-y-3"><div className="grid gap-3 md:grid-cols-2"><Field label={language === "en" ? "Business model" : "商业模式"}><Textarea value={form.business_model} onChange={(event) => setForm({ ...form, business_model: event.target.value })} /></Field><Field label={language === "en" ? "Key drivers" : "关键驱动（每行一项）"}><Textarea value={listValue(form.key_drivers)} onChange={(event) => setList("key_drivers", event.target.value)} /></Field><Field label="Bull case"><Textarea value={form.bull_case} onChange={(event) => setForm({ ...form, bull_case: event.target.value })} /></Field><Field label="Base case"><Textarea value={form.base_case} onChange={(event) => setForm({ ...form, base_case: event.target.value })} /></Field><Field label="Bear case"><Textarea value={form.bear_case} onChange={(event) => setForm({ ...form, bear_case: event.target.value })} /></Field><Field label={language === "en" ? "Risks" : "风险（每行一项）"}><Textarea value={listValue(form.risks)} onChange={(event) => setList("risks", event.target.value)} /></Field><Field label={language === "en" ? "Catalysts" : "催化剂（每行一项）"}><Textarea value={listValue(form.catalysts)} onChange={(event) => setList("catalysts", event.target.value)} /></Field><Field label={language === "en" ? "Invalidation conditions" : "证伪条件（每行一项）"}><Textarea value={listValue(form.invalidation_conditions)} onChange={(event) => setList("invalidation_conditions", event.target.value)} /></Field><Field label={language === "en" ? "Confidence (0-1)" : "信心（0-1）"}><Input max={1} min={0} step={0.05} type="number" value={form.confidence} onChange={(event) => setForm({ ...form, confidence: Number(event.target.value) })} /></Field><Field label={language === "en" ? "Time horizon" : "时间范围"}><Input value={form.time_horizon} onChange={(event) => setForm({ ...form, time_horizon: event.target.value })} /></Field><Field label={language === "en" ? "Next review" : "下次复核"}><Input type="datetime-local" value={form.next_review_at?.slice(0, 16) ?? ""} onChange={(event) => setForm({ ...form, next_review_at: event.target.value || null })} /></Field><Field label={language === "en" ? "Evidence source IDs" : "证据 Source IDs"}><Input value={sourceIds} onChange={(event) => setSourceIds(event.target.value)} /></Field></div><Field label={language === "en" ? "Why this version changed" : "本次修改原因"}><Input value={reason} onChange={(event) => setReason(event.target.value)} /></Field><Button disabled={saving || !reason.trim()} onClick={() => void save()}><Save />{language === "en" ? "Save Thesis snapshot" : "保存 Thesis 快照"}</Button><div className="rounded-md border border-border/80 p-3"><h3 className="text-sm font-semibold">{language === "en" ? "Decision log" : "决策日志"}</h3><div className="mt-2 grid gap-2 md:grid-cols-2"><Input placeholder={language === "en" ? "Action / decision" : "动作 / 决策"} value={decision.action} onChange={(event) => setDecision({ ...decision, action: event.target.value })} /><Input placeholder={language === "en" ? "Rationale" : "当时理由"} value={decision.rationale} onChange={(event) => setDecision({ ...decision, rationale: event.target.value })} /></div><Button className="mt-2" onClick={() => void saveDecision()} size="sm"><Plus />{language === "en" ? "Record decision" : "记录决策"}</Button>{decisions.map((item) => <DecisionRow decision={item} key={item.id} language={language} onUpdated={load} />)}</div></div><aside className="space-y-2"><h3 className="text-sm font-semibold">{language === "en" ? "Version history" : "版本历史"}</h3>{versions.map((version) => <div className="rounded-md border border-border/80 bg-background/60 p-3" key={version.id}><div className="flex items-center justify-between"><Badge>v{version.version}</Badge><span className="text-xs text-muted-foreground">{new Date(version.created_at).toLocaleString()}</span></div><p className="mt-2 text-sm">{version.reason}</p><p className="mt-2 text-xs text-muted-foreground">{(version.change_summary.changed_fields as string[] | undefined)?.join(", ") || "Initial"}</p></div>)}</aside></div>;
}

function DecisionRow({ decision, language, onUpdated }: { decision: ResearchDecision; language: AppLanguage; onUpdated: () => Promise<void> }) { const [outcome, setOutcome] = useState(decision.outcome); return <div className="mt-2 border-t border-border/60 pt-2 text-sm"><strong>{decision.action}</strong><p className="text-muted-foreground">{decision.rationale}</p><div className="mt-2 flex gap-2"><Input placeholder={language === "en" ? "Outcome / review" : "事后结果 / 复盘"} value={outcome} onChange={(event) => setOutcome(event.target.value)} /><Button onClick={() => void updateResearchDecision(decision.id, outcome).then(onUpdated)} size="sm" variant="outline">{language === "en" ? "Update" : "更新"}</Button></div></div>; }

function DocumentsTab({ language, onChanged, symbol }: { language: AppLanguage; onChanged: () => Promise<void>; symbol: string }) {
  const [documents, setDocuments] = useState<ResearchDocument[]>([]); const [detail, setDetail] = useState<ResearchDocument | null>(null); const [saving, setSaving] = useState(false); const [file, setFile] = useState<File | null>(null); const [form, setForm] = useState({ document_id: "", title: "", document_type: "filing", source_url: "", published_at: "", content: "" });
  async function load() { setDocuments(await listResearchDocuments(symbol)); }
  useEffect(() => { void load(); }, [symbol]);
  async function save() { if (!form.title.trim() || (!form.content.trim() && !file)) return; setSaving(true); try { if (file) { const data = new FormData(); data.set("file", file); data.set("title", form.title); data.set("document_type", form.document_type); if (form.document_id) data.set("document_id", form.document_id); if (form.source_url) data.set("source_url", form.source_url); if (form.published_at) data.set("published_at", form.published_at); await uploadResearchDocument(symbol, data); } else { await createResearchDocument(symbol, { ...form, document_id: form.document_id || null, source_url: form.source_url || null, published_at: form.published_at || null }); } setForm({ ...form, document_id: "", title: "", content: "" }); setFile(null); await load(); await onChanged(); } finally { setSaving(false); } }
  async function open(document: ResearchDocument) { setDetail(await getResearchDocument(document.id)); }
  return <div className="grid gap-4 xl:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.4fr)]"><div className="space-y-3"><div className="rounded-md border border-border/80 bg-background/60 p-3"><h3 className="text-sm font-semibold">{language === "en" ? "Ingest research material" : "摄取研究材料"}</h3><div className="mt-3 space-y-2"><Field label={language === "en" ? "Add version to" : "追加版本到"}><Select value={form.document_id || "new"} onValueChange={(value) => setForm({ ...form, document_id: value === "new" ? "" : value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="new">New document</SelectItem>{documents.map((item) => <SelectItem key={item.id} value={item.id}>{item.title}</SelectItem>)}</SelectContent></Select></Field><Field label={language === "en" ? "Title" : "标题"}><Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></Field><Field label={language === "en" ? "Type" : "类型"}><Select value={form.document_type} onValueChange={(value) => setForm({ ...form, document_type: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["filing", "transcript", "slides", "pdf", "article", "note"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></Field><Field label="Source URL"><Input value={form.source_url} onChange={(event) => setForm({ ...form, source_url: event.target.value })} /></Field><Field label={language === "en" ? "Published at" : "发布时间"}><Input type="datetime-local" value={form.published_at} onChange={(event) => setForm({ ...form, published_at: event.target.value })} /></Field><Field label={language === "en" ? "PDF / text file" : "PDF / 文本文件"}><Input accept=".pdf,.txt,.md" onChange={(event) => setFile(event.target.files?.[0] ?? null)} type="file" /></Field><Field label={language === "en" ? "Or paste text" : "或粘贴正文"}><Textarea className="min-h-36" value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} /></Field><Button disabled={saving} onClick={() => void save()}>{saving ? <Loader2 className="animate-spin" /> : file ? <Upload /> : <Save />}{language === "en" ? "Ingest" : "保存材料"}</Button></div></div>{documents.map((document) => <button className="w-full rounded-md border border-border/80 bg-background/60 p-3 text-left hover:border-primary/40" key={document.id} onClick={() => void open(document)}><div className="flex items-center justify-between"><strong className="truncate text-sm">{document.title}</strong><Badge variant="outline">v{document.latest_version}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{document.document_type} · {new Date(document.updated_at).toLocaleString()}</p></button>)}</div><div>{detail ? <DocumentDetail detail={detail} language={language} /> : <div className="grid min-h-72 place-items-center rounded-md border border-dashed border-border/80 text-sm text-muted-foreground">{language === "en" ? "Select a document to inspect versions and changes." : "选择材料查看版本、页码定位与变化。"}</div>}</div></div>;
}

function DocumentDetail({ detail, language }: { detail: ResearchDocument; language: AppLanguage }) { const [selected, setSelected] = useState(detail.versions[0]?.id); useEffect(() => setSelected(detail.versions[0]?.id), [detail.id]); const version = detail.versions.find((item) => item.id === selected) ?? detail.versions[0]; return <div className="rounded-md border border-border/80 bg-background/60 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold">{detail.title}</h3><p className="text-xs text-muted-foreground">{detail.document_type}</p></div>{detail.source_url ? <Button asChild size="sm" variant="outline"><a href={detail.source_url} rel="noreferrer" target="_blank"><ExternalLink />Source</a></Button> : null}</div><div className="mt-3 flex flex-wrap gap-1">{detail.versions.map((item) => <Button key={item.id} onClick={() => setSelected(item.id)} size="sm" variant={item.id === version?.id ? "secondary" : "outline"}>v{item.version}</Button>)}</div>{version ? <><div className="mt-3 grid gap-2 sm:grid-cols-3"><Stat label={language === "en" ? "Added lines" : "新增行"} value={version.change_summary.added_lines ?? 0} /><Stat label={language === "en" ? "Removed lines" : "删除行"} value={version.change_summary.removed_lines ?? 0} /><Stat label={language === "en" ? "Pages" : "页数"} value={version.locator.pages?.length ?? 0} /></div>{version.change_summary.diff?.length ? <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/30 p-3 text-xs">{version.change_summary.diff.join("\n")}</pre> : null}<pre className="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-md border border-border/70 p-3 text-xs leading-5">{version.content}</pre></> : null}</div>; }

function PositionTab({ language, onOpenPortfolio, summary, symbol }: { language: AppLanguage; onOpenPortfolio: () => void; summary: SecurityWorkspaceSummary | null; symbol: string }) { const values = summary?.position ?? {}; return <div className="max-w-2xl rounded-md border border-border/80 bg-background/60 p-4"><h2 className="font-semibold">{symbol} · {language === "en" ? "Position context" : "持仓上下文"}</h2>{summary?.position ? <div className="mt-3 grid gap-3 sm:grid-cols-3"><Stat label={language === "en" ? "Market" : "市场"} value={String(values.market ?? "-")} /><Stat label={language === "en" ? "Shares" : "股数"} value={String(values.shares ?? "-")} /><Stat label={language === "en" ? "Cost" : "成本"} value={String(values.cost_price ?? "-")} /></div> : <p className="mt-3 text-sm text-muted-foreground">{language === "en" ? "This symbol is not in the local portfolio." : "本地组合中暂无该标的。"}</p>}<Button className="mt-4" onClick={onOpenPortfolio} variant="outline"><BriefcaseBusiness />{language === "en" ? "Open portfolio" : "打开组合"}</Button></div>; }

function Stat({ label, value }: { label: string; value: string | number }) { return <div className="rounded-md border border-border/70 bg-muted/15 p-2"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-semibold">{value}</p></div>; }
