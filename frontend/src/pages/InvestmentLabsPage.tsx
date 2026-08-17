import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BarChart3, Building2, Calculator, FlaskConical, Globe2, Loader2, Play, RefreshCw, Save } from "lucide-react";

import { Field } from "@/components/common/Field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  analyzePortfolioLab, compareValuationPeers, createAlertRule, createValuationModel, getGreaterChinaContext, listValuationModels,
} from "@/lib/api";
import type { AppLanguage } from "@/lib/i18n";
import type { GreaterChinaContext, PeerComparisonResult, PortfolioLabResult, ValuationModel } from "@/types/app";

export type LabTab = "portfolio" | "valuation" | "greater-china";

const tabLabels = {
  zh: { portfolio: "Portfolio Lab", valuation: "估值 / 同业", "greater-china": "大中华市场" },
  en: { portfolio: "Portfolio Lab", valuation: "Valuation / Peers", "greater-china": "Greater China" },
} as const;

function initialQueryTab(): LabTab {
  if (typeof window === "undefined") return "portfolio";
  const value = new URLSearchParams(window.location.search).get("tab");
  return value === "valuation" || value === "greater-china" ? value : "portfolio";
}

export function InvestmentLabsPage({ initialSymbol = "", initialTab, language }: { initialSymbol?: string; initialTab?: LabTab; language: AppLanguage }) {
  const [tab, setTab] = useState<LabTab>(initialTab || initialQueryTab());
  const copy = tabLabels[language];
  return (
    <section className="panel motion-panel page-enter flex min-h-0 min-w-0 flex-1 flex-col rounded-md lg:h-full">
      <div className="page-toolbar flex flex-wrap items-center justify-between gap-2"><div><h1 className="flex items-center gap-2 text-base font-semibold"><FlaskConical className="text-primary" />Investment Labs</h1><p className="text-xs text-muted-foreground">{language === "en" ? "Auditable portfolio, valuation and Greater China research models" : "可审计、可复跑的组合、估值与大中华市场研究模型"}</p></div><div className="flex gap-1">{(["portfolio", "valuation", "greater-china"] as LabTab[]).map((value) => <Button key={value} onClick={() => setTab(value)} size="sm" variant={tab === value ? "secondary" : "ghost"}>{value === "portfolio" ? <BarChart3 /> : value === "valuation" ? <Calculator /> : <Globe2 />}{copy[value]}</Button>)}</div></div>
      <div className="panel-body min-h-0 flex-1 lg:overflow-y-auto">{tab === "portfolio" ? <PortfolioLab language={language} /> : tab === "valuation" ? <ValuationLab initialSymbol={initialSymbol} language={language} /> : <GreaterChinaLab initialSymbol={initialSymbol} language={language} />}</div>
    </section>
  );
}

function PortfolioLab({ language }: { language: AppLanguage }) {
  const [benchmark, setBenchmark] = useState("SPY.US");
  const [lookback, setLookback] = useState(252);
  const [shocks, setShocks] = useState('{"market:US":-0.1,"market:A":-0.08,"market:H":-0.12}');
  const [targets, setTargets] = useState("{}");
  const [cashFlows, setCashFlows] = useState("[]");
  const [result, setResult] = useState<PortfolioLabResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setLoading(true); setError("");
    try { setResult(await analyzePortfolioLab({ markets: ["US", "A", "H"], benchmark_symbol: benchmark.trim().toUpperCase(), lookback_days: lookback, scenario_shocks: JSON.parse(shocks), target_weights: JSON.parse(targets), cash_flows: JSON.parse(cashFlows) })); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Portfolio Lab failed"); }
    finally { setLoading(false); }
  }

  const metrics = result?.metrics || {};
  return <div className="space-y-4"><div className="grid gap-3 rounded-md border border-border/80 bg-background/60 p-3 lg:grid-cols-5"><Field label={language === "en" ? "Benchmark" : "基准指数"}><Input value={benchmark} onChange={(event) => setBenchmark(event.target.value)} /></Field><Field label={language === "en" ? "Lookback days" : "回看天数"}><Input min={30} max={1000} type="number" value={lookback} onChange={(event) => setLookback(Number(event.target.value))} /></Field><Field label={language === "en" ? "Scenario shocks (JSON)" : "压力情景（JSON）"}><Textarea className="min-h-20 font-mono text-xs" value={shocks} onChange={(event) => setShocks(event.target.value)} /></Field><Field label={language === "en" ? "Target weights (JSON)" : "目标权重（JSON）"}><Textarea className="min-h-20 font-mono text-xs" value={targets} onChange={(event) => setTargets(event.target.value)} /></Field><Field label={language === "en" ? "Cash flows for IRR (JSON)" : "IRR 现金流（JSON）"}><Textarea className="min-h-20 font-mono text-xs" placeholder='[{"date":"2025-01-01","amount":-10000}]' value={cashFlows} onChange={(event) => setCashFlows(event.target.value)} /></Field><div className="lg:col-span-5"><Button disabled={loading} onClick={() => void run()}>{loading ? <Loader2 className="animate-spin" /> : <Play />}{language === "en" ? "Run analysis" : "运行分析"}</Button></div></div>{error ? <ErrorBox text={error} /> : null}{result ? <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7"><Metric label={language === "en" ? "Simulated TWR" : "模拟 TWR"} value={percent(metrics.simulated_twr)} /><Metric label="Money-weighted IRR" value={percent(metrics.money_weighted_irr)} /><Metric label={language === "en" ? "Volatility" : "年化波动"} value={percent(metrics.annualized_volatility)} /><Metric label={language === "en" ? "Max drawdown" : "最大回撤"} value={percent(metrics.max_drawdown)} /><Metric label="Beta" value={number(metrics.beta)} /><Metric label={language === "en" ? "Correlation" : "基准相关性"} value={number(metrics.benchmark_correlation)} /><Metric label="HHI" value={number(metrics.concentration_hhi)} /></div><div className="grid gap-4 xl:grid-cols-2"><LabCard title={language === "en" ? "Return contribution" : "收益贡献"}><Table headers={["Symbol", "Weight", "Return", "Contribution"]} rows={result.contribution.map((item) => [item.symbol, percent(item.weight), percent(item.period_return), percent(item.return_contribution)])} /></LabCard><LabCard title={language === "en" ? "Exposure" : "风险暴露"}><Exposure title={language === "en" ? "Market" : "市场"} values={result.exposures.market} /><Exposure title={language === "en" ? "Currency" : "币种"} values={result.exposures.currency} /><Exposure title={language === "en" ? "Listing country" : "上市地"} values={(result.exposures as Record<string, Record<string, number>>).country_listing} /><Exposure title={language === "en" ? "Shared Thesis risks" : "共用 Thesis 风险"} values={(result.exposures as Record<string, Record<string, number>>).thesis_risk} /></LabCard><LabCard title={language === "en" ? "Stress scenario" : "压力情景"}><p className="text-2xl font-semibold">{percent(result.scenario.estimated_return)}</p><p className="mt-2 text-xs text-muted-foreground">{result.scenario.method}</p></LabCard><LabCard title={language === "en" ? "Thesis linkage" : "Thesis 联动"}><div className="space-y-2">{result.thesis_links.map((item) => <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2" key={item.symbol}><span className="text-sm font-medium">{item.symbol}</span><span className="text-xs text-muted-foreground">{percent(item.weight)} · confidence {item.confidence == null ? "—" : percent(item.confidence)}</span></div>)}</div></LabCard></div><div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground"><strong className="text-foreground">Coverage: {result.coverage.history_available}/{result.coverage.holdings} · {percent(result.coverage.history_weight)}</strong>{[...result.warnings, ...result.limitations].map((item) => <p className="mt-1" key={item}>• {item}</p>)}</div></> : null}</div>;
}

function ValuationLab({ initialSymbol, language }: { initialSymbol: string; language: AppLanguage }) {
  const [symbol, setSymbol] = useState(initialSymbol || "AAPL.US");
  const [type, setType] = useState<"dcf" | "reverse_dcf" | "relative">("dcf");
  const [title, setTitle] = useState("Base valuation");
  const [fields, setFields] = useState({ revenue: "1000", fcf_margin: "0.20", revenue_growth: "0.08", wacc: "0.10", terminal_growth: "0.03", shares_outstanding: "100", cash: "0", debt: "0", years: "5", target_price: "20", peer_median: "20", target_metric: "1" });
  const [peerText, setPeerText] = useState("");
  const [sourceIds, setSourceIds] = useState("");
  const [thesisId, setThesisId] = useState("");
  const [models, setModels] = useState<ValuationModel[]>([]);
  const [peers, setPeers] = useState<PeerComparisonResult | null>(null);
  const [continueId, setContinueId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const peersList = useMemo(() => peerText.split(/[,\s]+/).map((item) => item.trim().toUpperCase()).filter(Boolean), [peerText]);
  useEffect(() => { if (symbol.trim()) listValuationModels(symbol.trim().toUpperCase()).then(setModels).catch(() => setModels([])); }, [symbol]);

  function assumptions() { const values = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, Number(value)])); return type === "relative" ? { metric: "pe_ttm_ratio", peer_median: values.peer_median, target_metric: values.target_metric } : type === "reverse_dcf" ? values : Object.fromEntries(Object.entries(values).filter(([key]) => !["target_price", "peer_median", "target_metric"].includes(key))); }
  async function save() { setLoading(true); setError(""); try { const model = await createValuationModel(symbol.trim().toUpperCase(), { model_id: continueId, model_type: type, title, assumptions: assumptions(), peer_symbols: peersList, source_ids: sourceIds.split(/[,\s]+/).filter(Boolean), thesis_snapshot_id: thesisId.trim() || null, reason: continueId ? "Assumption update" : "Initial model" }); setModels((current) => [model, ...current]); setContinueId(model.id); } catch (caught) { setError(caught instanceof Error ? caught.message : "Valuation failed"); } finally { setLoading(false); } }
  async function compare() { if (peersList.length < 2) return; setLoading(true); setError(""); try { setPeers(await compareValuationPeers(peersList)); } catch (caught) { setError(caught instanceof Error ? caught.message : "Peer comparison failed"); } finally { setLoading(false); } }
  async function monitorLatest() { const fairValue = Number(models[0]?.result.value_per_share); if (!Number.isFinite(fairValue)) return; setError(""); try { await createAlertRule({ symbol: symbol.trim().toUpperCase(), name: `${models[0].title} fair-value review`, condition_type: "price", operator: "lte", threshold: fairValue, severity: "medium", channels: ["in_app"], evaluation_interval_seconds: 300, metadata: { valuation_model_id: models[0].id } }); } catch (caught) { setError(caught instanceof Error ? caught.message : "Failed to create alert"); } }

  const numericFields = type === "relative" ? ["peer_median", "target_metric"] : ["revenue", "fcf_margin", "revenue_growth", "wacc", "terminal_growth", "shares_outstanding", "cash", "debt", "years", ...(type === "reverse_dcf" ? ["target_price"] : [])];
  return <div className="space-y-4"><div className="grid gap-3 rounded-md border border-border/80 bg-background/60 p-3 md:grid-cols-3 xl:grid-cols-5"><Field label="Symbol"><Input value={symbol} onChange={(event) => { setSymbol(event.target.value); setContinueId(null); }} /></Field><Field label={language === "en" ? "Model" : "模型"}><Select options={[{ label: "DCF", value: "dcf" }, { label: "Reverse DCF", value: "reverse_dcf" }, { label: language === "en" ? "Relative" : "相对估值", value: "relative" }]} value={type} onValueChange={(value) => { setType(value as typeof type); setContinueId(null); }} /></Field><Field label={language === "en" ? "Title" : "名称"}><Input value={title} onChange={(event) => setTitle(event.target.value)} /></Field>{numericFields.map((key) => <Field key={key} label={key.replaceAll("_", " ")}><Input step="any" type="number" value={fields[key as keyof typeof fields]} onChange={(event) => setFields({ ...fields, [key]: event.target.value })} /></Field>)}<Field label={language === "en" ? "Peer symbols" : "同业标的（逗号分隔）"}><Input placeholder="AAPL.US, MSFT.US" value={peerText} onChange={(event) => setPeerText(event.target.value)} /></Field><Field label="Thesis snapshot ID"><Input value={thesisId} onChange={(event) => setThesisId(event.target.value)} /></Field><Field label={language === "en" ? "Evidence source IDs" : "证据来源 ID"}><Input value={sourceIds} onChange={(event) => setSourceIds(event.target.value)} /></Field><div className="flex items-end gap-2"><Button disabled={loading || !symbol.trim()} onClick={() => void save()}>{loading ? <Loader2 className="animate-spin" /> : <Save />}{continueId ? (language === "en" ? "Save new version" : "保存新版本") : (language === "en" ? "Save model" : "保存模型")}</Button><Button disabled={loading || peersList.length < 2} onClick={() => void compare()} variant="outline"><RefreshCw />Peers</Button></div></div>{error ? <ErrorBox text={error} /> : null}{models[0] ? <div className="grid gap-4 xl:grid-cols-[1fr_1.4fr]"><LabCard title={`${models[0].title} · v${models[0].version}`}><div className="grid grid-cols-2 gap-2">{Object.entries(models[0].result).filter(([, value]) => typeof value === "number").slice(0, 8).map(([key, value]) => <Metric key={key} label={key.replaceAll("_", " ")} value={number(value as number)} />)}</div><div className="mt-3 flex flex-wrap gap-2"><Button onClick={() => setContinueId(models[0].id)} size="sm" variant="outline">{language === "en" ? "Continue this model" : "基于此版本继续"}</Button>{typeof models[0].result.value_per_share === "number" ? <Button onClick={() => void monitorLatest()} size="sm" variant="outline">{language === "en" ? "Create price review alert" : "创建价格复核提醒"}</Button> : null}</div></LabCard><LabCard title={language === "en" ? "Sensitivity / assumptions" : "敏感性 / 假设"}><pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{JSON.stringify(models[0].result.sensitivity || models[0].assumptions, null, 2)}</pre></LabCard></div> : null}{peers ? <LabCard title={language === "en" ? "Peer comparison" : "同业比较"}><Table headers={["Symbol", ...Object.keys(peers.medians)]} rows={peers.rows.map((row) => [row.symbol, ...Object.keys(peers.medians).map((key) => String(row.metrics[key] ?? "—"))])} /><p className="mt-3 text-xs text-muted-foreground">Median: {JSON.stringify(peers.medians)} · {peers.methodology}</p></LabCard> : null}</div>;
}

function GreaterChinaLab({ initialSymbol, language }: { initialSymbol: string; language: AppLanguage }) {
  const [symbol, setSymbol] = useState(initialSymbol || "00700.HK");
  const [paired, setPaired] = useState("");
  const [usChina, setUsChina] = useState(false);
  const [context, setContext] = useState<GreaterChinaContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function load() { setLoading(true); setError(""); try { setContext(await getGreaterChinaContext({ symbol: symbol.trim().toUpperCase(), paired_symbol: paired.trim().toUpperCase() || undefined, china_related_us_listing: usChina })); } catch (caught) { setError(caught instanceof Error ? caught.message : "Greater China context failed"); } finally { setLoading(false); } }
  return <div className="space-y-4"><div className="grid gap-3 rounded-md border border-border/80 bg-background/60 p-3 md:grid-cols-4"><Field label="Symbol"><Input value={symbol} onChange={(event) => setSymbol(event.target.value)} /></Field><Field label={language === "en" ? "A/H/ADR counterpart" : "A/H/ADR 对应标的"}><Input placeholder="600941.SH" value={paired} onChange={(event) => setPaired(event.target.value)} /></Field><label className="flex items-end gap-2 pb-2 text-sm"><input checked={usChina} onChange={(event) => setUsChina(event.target.checked)} type="checkbox" />{language === "en" ? "US-listed China company" : "中概美股"}</label><div className="flex items-end"><Button disabled={loading} onClick={() => void load()}>{loading ? <Loader2 className="animate-spin" /> : <Building2 />}{language === "en" ? "Build context" : "生成专项上下文"}</Button></div></div>{error ? <ErrorBox text={error} /> : null}{context ? <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Market" value={context.market} /><Metric label="Currency" value={context.currency} /><Metric label="Timezone" value={context.timezone} /><Metric label={language === "en" ? "Languages" : "披露语言"} value={context.disclosure_languages.join(" / ")} /></div><div className="grid gap-4 xl:grid-cols-2"><LabCard title={language === "en" ? "Research checklist" : "专项研究清单"}>{context.research_checklist.map((item) => <p className="border-t border-border/60 py-2 text-sm" key={item}>• {item}</p>)}</LabCard><LabCard title={language === "en" ? "Risk dimensions" : "风险维度"}>{context.risk_dimensions.map((item) => <p className="border-t border-border/60 py-2 text-sm" key={item}>• {item}</p>)}</LabCard><LabCard title={language === "en" ? "Longbridge coverage" : "Longbridge 数据覆盖"}><div className="flex flex-wrap gap-2">{Object.entries(context.insights).map(([key, value]) => <Badge key={key} variant={value ? "outline" : "muted"}>{key}</Badge>)}</div><pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{JSON.stringify(context.static_info, null, 2)}</pre></LabCard>{context.paired_comparison ? <LabCard title={language === "en" ? "A/H/ADR comparison" : "A/H/ADR 对照"}><Table headers={["Symbol", ...Object.keys(context.paired_comparison.medians)]} rows={context.paired_comparison.rows.map((row) => [row.symbol, ...Object.keys(context.paired_comparison!.medians).map((key) => String(row.metrics[key] ?? "—"))])} /></LabCard> : null}</div><p className="text-xs text-muted-foreground">{context.source_note}</p></> : null}</div>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-md border border-border/80 bg-background/60 p-3"><p className="text-[11px] text-muted-foreground">{label}</p><p className="mt-1 truncate text-lg font-semibold">{value}</p></div>; }
function LabCard({ children, title }: { children: ReactNode; title: string }) { return <div className="rounded-md border border-border/80 bg-background/60 p-4"><h2 className="mb-3 text-sm font-semibold">{title}</h2>{children}</div>; }
function ErrorBox({ text }: { text: string }) { return <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{text}</div>; }
function percent(value: unknown) { const numberValue = typeof value === "number" ? value : Number(value); return Number.isFinite(numberValue) ? `${(numberValue * 100).toFixed(2)}%` : "—"; }
function number(value: unknown) { const numberValue = typeof value === "number" ? value : Number(value); return Number.isFinite(numberValue) ? numberValue.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—"; }
function Exposure({ title, values = {} }: { title: string; values?: Record<string, number> }) { return <div className="mb-3"><p className="mb-1 text-xs font-medium text-muted-foreground">{title}</p><div className="flex flex-wrap gap-2">{Object.entries(values).map(([key, value]) => <Badge key={key} variant="outline">{key} {percent(value)}</Badge>)}</div></div>; }
function Table({ headers, rows }: { headers: string[]; rows: Array<Array<string>> }) { return <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b border-border/70 text-muted-foreground">{headers.map((header) => <th className="px-2 py-2" key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr className="border-b border-border/50" key={`${row[0]}-${index}`}>{row.map((cell, cellIndex) => <td className="px-2 py-2" key={`${cellIndex}-${cell}`}>{cell}</td>)}</tr>)}</tbody></table></div>; }
