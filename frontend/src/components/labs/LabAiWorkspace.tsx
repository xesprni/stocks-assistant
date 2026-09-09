import { useEffect, useId, useRef, useState } from "react";
import { ArrowDownToLine, ArrowRight, Check, ChevronRight, CircleCheck, Copy, Database, FileText, History, Loader2, RefreshCw, Sparkles, Square, TriangleAlert } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getLabAIRun, listLabAIRuns, streamLabAI } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { AppLanguage } from "@/lib/i18n";
import { labAiCopy, labAiPrompts, labDataLabel } from "@/lib/labs-ai";
import { cn } from "@/lib/utils";
import type { LabAIArtifact, LabAIKind, LabAIRun, LabAIStreamEvent } from "@/types/app";

type Activity = { id: number; title: string; status: "running" | "completed" | "failed"; tool?: string };
const timestamp = (value: string, language: AppLanguage) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(language === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

export function LabAiWorkspace({ lab, language, initialSymbol = "" }: { lab: LabAIKind; language: AppLanguage; initialSymbol?: string }) {
  const auth = useAuth();
  const copy = labAiCopy[language];
  const prompt = labAiPrompts[language][lab];
  const formId = useId();
  const [symbols, setSymbols] = useState(initialSymbol);
  const [objective, setObjective] = useState("");
  const [focus, setFocus] = useState(0);
  const [run, setRun] = useState<LabAIRun | null>(null);
  const [history, setHistory] = useState<LabAIRun[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [loadingRecordId, setLoadingRecordId] = useState<string | null>(null);
  const historySelectionRef = useRef(0);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const runRef = useRef<LabAIRun | null>(null);
  const mountedRef = useRef(true);
  const historyRequestRef = useRef(0);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canRead = auth.can(lab === "portfolio" ? "portfolio:read" : "fundamentals:read");
  const permission = auth.can("chat:write") && canRead;

  function updateRun(value: LabAIRun | null) {
    runRef.current = value;
    setRun(value);
  }

  async function refreshHistory(signal?: AbortSignal) {
    const request = ++historyRequestRef.current;
    setHistoryLoading(true);
    try {
      const records = await listLabAIRuns(lab, { signal });
      if (mountedRef.current && !signal?.aborted && request === historyRequestRef.current) {
        setHistory(records);
        setHistoryError("");
      }
    } catch (caught) {
      if (mountedRef.current && !signal?.aborted && request === historyRequestRef.current) setHistoryError(caught instanceof Error ? caught.message : copy.historyError);
    } finally {
      if (mountedRef.current && request === historyRequestRef.current) setHistoryLoading(false);
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    if (canRead) void refreshHistory(controller.signal);
    return () => {
      mountedRef.current = false;
      controller.abort();
      abortRef.current?.abort();
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, [lab, canRead]);

  useEffect(() => { setSymbols(initialSymbol); }, [initialSymbol]);

  async function selectHistory(record: LabAIRun) {
    const request = ++historySelectionRef.current;
    setLoadingRecordId(record.id);
    setError("");
    try {
      const detail = await getLabAIRun(record.id);
      if (mountedRef.current && request === historySelectionRef.current && !abortRef.current) {
        updateRun(detail);
        setActivities([]);
        setCopied(false);
      }
    } catch (caught) {
      if (mountedRef.current && request === historySelectionRef.current) setError(caught instanceof Error ? caught.message : copy.historyError);
    } finally {
      if (mountedRef.current && request === historySelectionRef.current) setLoadingRecordId(null);
    }
  }

  function onEvent(event: LabAIStreamEvent) {
    if (!mountedRef.current) return;
    const data = event.data;
    if (data.run) updateRun(data.run);
    if (event.type === "message_delta" && runRef.current) updateRun({ ...runRef.current, report: (data.reset ? "" : runRef.current.report) + (data.delta || "") });
    if (event.type === "status_update" && data.message) {
      setActivities((current) => [...current.slice(-99), { id: Date.now() + Math.random(), title: data.message!, status: "completed" }]);
    }
    if (event.type === "tool_start") {
      setActivities((current) => [...current.slice(-99), { id: Date.now() + Math.random(), tool: data.tool_name, title: data.message || labDataLabel(data.tool_name || "analysis", language), status: "running" }]);
    }
    if (event.type === "tool_end") {
      setActivities((current) => {
        const next = [...current];
        const index = next.map((item) => item.tool === data.tool_name && item.status === "running").lastIndexOf(true);
        if (index >= 0) next[index] = { ...next[index], title: data.message || next[index].title, status: data.status === "error" || data.status === "failed" ? "failed" : "completed" };
        return next;
      });
    }
    if (event.type === "error") setError(data.error || copy.connectionError);
  }

  async function startAnalysis() {
    if (abortRef.current || !permission) return;
    const selectedSymbols = lab === "portfolio" ? [] : [...new Set(symbols.split(/[\s,，;；]+/).map((value) => value.trim().toUpperCase()).filter(Boolean))];
    if (lab !== "portfolio" && (!selectedSymbols.length || selectedSymbols.length > 10 || selectedSymbols.some((value) => !/^[A-Z0-9][A-Z0-9._-]*\.[A-Z]{2,5}$/.test(value)))) {
      setError(copy.invalidSymbol);
      return;
    }
    const controller = new AbortController();
    historySelectionRef.current += 1;
    setLoadingRecordId(null);
    abortRef.current = controller;
    setBusy(true);
    setStopping(false);
    setError("");
    setCopied(false);
    setActivities([]);
    updateRun(null);
    try {
      const researchObjective = `${objective.trim() || prompt.objective}${focus ? `\n${prompt.focuses[focus]}` : ""}`;
      await streamLabAI({ lab, symbols: selectedSymbols, objective: researchObjective, locale: language === "zh" ? "zh-CN" : "en-US" }, onEvent, controller.signal);
    } catch (caught) {
      if (!mountedRef.current) return;
      if (controller.signal.aborted) {
        if (runRef.current && runRef.current.status === "running") updateRun({ ...runRef.current, status: "canceled", completed_at: new Date().toISOString() });
        if (runRef.current) {
          try {
            const saved = await getLabAIRun(runRef.current.id);
            if (mountedRef.current) updateRun(saved.status === "running" ? { ...saved, status: "canceled", completed_at: new Date().toISOString() } : saved);
          } catch { /* The stopped run remains available in history. */ }
        }
      } else {
        setError(caught instanceof Error ? caught.message : copy.connectionError);
        // 连接中断后只读取已创建的任务，避免重试导致重复模型调用。
        if (runRef.current) {
          try { const saved = await getLabAIRun(runRef.current.id); if (mountedRef.current) updateRun(saved); } catch { /* Keep the partial report for review. */ }
        }
      }
    } finally {
      abortRef.current = null;
      if (mountedRef.current) {
        setBusy(false);
        setStopping(false);
        setActivities((current) => current.map((item) => item.status === "running" ? { ...item, status: "failed" } : item));
        void refreshHistory();
      }
    }
  }

  function stopAnalysis() {
    setStopping(true);
    abortRef.current?.abort();
  }

  function reportMarkdown() {
    if (!run) return "";
    return `# ${run.title}\n\n${copy.recordDate}: ${run.created_at}\n\n${copy.input}: ${run.objective}\n\n${run.report}${run.warnings.length ? `\n\n## ${copy.warnings}\n\n${run.warnings.map((warning) => `- ${warning}`).join("\n")}` : ""}`;
  }

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(reportMarkdown());
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch (caught) { setError(caught instanceof Error ? caught.message : copy.copy); }
  }

  function exportReport() {
    if (!run) return;
    const url = URL.createObjectURL(new Blob([reportMarkdown()], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `labs-${lab}-${run.id.replace(/[^a-zA-Z0-9-]/g, "")}.md`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const statusText = run ? copy[run.status] : copy.preparing;
  return (
    <div className="mx-auto grid w-full max-w-[1440px] min-w-0 gap-5 xl:grid-cols-[minmax(260px,330px)_minmax(0,1fr)]">
      <aside className="contents min-w-0 space-y-4 xl:block">
        <form className="order-1 overflow-hidden rounded-2xl border border-primary/20 bg-card shadow-sm" onSubmit={(event) => { event.preventDefault(); void startAnalysis(); }}>
          <div className="border-b border-primary/10 bg-gradient-to-br from-primary/10 via-primary/[0.03] to-transparent p-5">
            <div className="mb-4 flex size-10 items-center justify-center rounded-xl border border-primary/20 bg-background text-primary shadow-sm"><Sparkles className="size-5" /></div>
            <h2 className="text-lg font-semibold leading-snug tracking-tight">{prompt.title}</h2>
            <p className="mt-2 text-xs leading-6 text-muted-foreground">{prompt.description}</p>
          </div>
          <div className="space-y-5 p-5">
            {lab !== "portfolio" && <div className="space-y-2">
              <label className="text-xs font-semibold" htmlFor={`${formId}-symbols`}>{copy.symbol}</label>
              <Input autoCapitalize="characters" autoComplete="off" disabled={busy} id={`${formId}-symbols`} onChange={(event) => setSymbols(event.target.value)} placeholder={lab === "valuation" ? "AAPL.US" : "700.HK"} value={symbols} aria-describedby={`${formId}-symbol-help`} />
              <p className="text-[11px] leading-5 text-muted-foreground" id={`${formId}-symbol-help`}>{copy.symbolHint}</p>
            </div>}
            <div className="space-y-2.5">
              <div className="flex flex-wrap gap-1.5">{prompt.focuses.map((item, index) => <button aria-pressed={focus === index} className={cn("rounded-lg border px-2.5 py-1.5 text-left text-[11px] leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50", focus === index ? "border-primary/40 bg-primary/10 text-primary" : "border-border/70 bg-background text-muted-foreground hover:bg-muted")} disabled={busy} key={index} onClick={() => setFocus(index)} type="button">{item}</button>)}</div>
              <label className="flex items-center justify-between gap-2 pt-1 text-xs font-semibold" htmlFor={`${formId}-objective`}>{copy.objective}<span className="font-normal text-muted-foreground">{copy.optional}</span></label>
              <Textarea className="min-h-[108px] text-xs" disabled={busy} id={`${formId}-objective`} maxLength={3800} onChange={(event) => setObjective(event.target.value)} placeholder={prompt.objective} value={objective} />
            </div>
            {!permission && <p className="text-xs leading-5 text-muted-foreground">{copy.limited}</p>}
            {busy ? <Button className="w-full" disabled={stopping} key="stop" onClick={(event) => { event.preventDefault(); stopAnalysis(); }} type="button" variant="outline">{stopping ? <Loader2 className="animate-spin" /> : <Square />}{stopping ? copy.stopping : copy.stop}</Button> : <Button className="w-full" key="start" disabled={!permission || (lab !== "portfolio" && !symbols.trim())} type="submit"><Sparkles />{copy.start}<ArrowRight className="ml-auto" /></Button>}
            <p className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground"><CircleCheck className="size-3" />{copy.usingModel}</p>
          </div>
        </form>
        <section className="order-3 rounded-2xl border border-border/70 bg-card p-4">
          <div className="mb-3 flex items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-xs font-semibold"><History className="size-4 text-muted-foreground" />{copy.history}</h3><Button aria-label={copy.refresh} disabled={historyLoading || busy} onClick={() => void refreshHistory()} size="icon" title={copy.refresh} variant="ghost"><RefreshCw className={cn("size-3.5", historyLoading && "animate-spin")} /></Button></div>
          {historyError && <p className="mb-2 break-words text-xs text-destructive" role="alert">{historyError}</p>}
          {!history.length && <p className="py-2 text-xs leading-6 text-muted-foreground">{historyLoading ? copy.preparing : copy.noHistory}</p>}
          <div className="max-h-80 space-y-1 overflow-y-auto">{history.map((record) => <button aria-pressed={run?.id === record.id} className={cn("w-full rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50", run?.id === record.id ? "border-primary/25 bg-primary/[0.06]" : "border-transparent hover:bg-muted/60")} disabled={busy} key={record.id} onClick={() => void selectHistory(record)} type="button"><div className="line-clamp-2 break-words text-xs font-medium leading-5">{loadingRecordId === record.id && <Loader2 className="mr-1.5 inline size-3 animate-spin" />}{record.title}</div><div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground"><span>{timestamp(record.created_at, language)}</span><span className={record.status === "failed" ? "text-destructive" : record.status === "completed" ? "text-emerald-600 dark:text-emerald-400" : ""}>{copy[record.status]}</span></div></button>)}</div>
        </section>
      </aside>
      <main className="order-2 min-w-0 space-y-4">
        {error && <div className="flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-xs leading-6 text-destructive" role="alert"><TriangleAlert className="mt-1 size-4 shrink-0" /><span className="break-words">{error}</span></div>}
        {!run && !busy ? <div className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/[0.15] px-6 py-12 text-center">
          <div className="mb-6 flex size-16 items-center justify-center rounded-2xl border border-border bg-card text-primary shadow-sm"><FlaskIcon /></div>
          <h2 className="text-lg font-semibold">{copy.empty}</h2><p className="mt-3 max-w-sm text-xs leading-6 text-muted-foreground">{copy.emptyHint}</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-3 gap-y-4 text-[11px] text-muted-foreground">{[copy.collecting, copy.reasoning, copy.writing].map((step, index) => <div className="flex items-center gap-3" key={step}>{index > 0 && <ChevronRight className="size-3 text-muted-foreground/50" />}<span className="flex items-center gap-1.5"><span className="flex size-5 items-center justify-center rounded-full border border-border bg-card text-[10px]">{index + 1}</span>{step}</span></div>)}</div>
        </div> : <>
          <section className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
            <div className="space-y-3 border-b border-border/60 px-5 py-4 sm:px-7">
              <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><Badge variant={run?.status === "failed" ? "danger" : busy ? "secondary" : "outline"}>{busy && <Loader2 className="mr-1.5 size-3 animate-spin" />}{busy ? copy.running : statusText}</Badge>{run && <span className="text-[11px] text-muted-foreground">{timestamp(run.created_at, language)}</span>}</div>{run?.report && <div className="flex gap-1"><Button aria-label={copied ? copy.copied : copy.copy} onClick={() => void copyReport()} size="icon" title={copy.copy} variant="ghost">{copied ? <Check /> : <Copy />}</Button><Button aria-label={copy.export} onClick={exportReport} size="icon" title={copy.export} variant="ghost"><ArrowDownToLine /></Button></div>}</div>
              <h2 className="break-words text-base font-semibold leading-7 sm:text-lg">{run?.title || copy.preparing}</h2>
              {run?.symbols.length ? <div className="flex flex-wrap gap-1.5">{run.symbols.map((symbol) => <Badge key={symbol} variant="muted">{symbol}</Badge>)}</div> : null}
              {run && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{copy.input}</summary><p className="mt-2 whitespace-pre-wrap break-words leading-6">{run.objective}</p></details>}
            </div>
            {(busy || activities.length > 0) && <details className="border-b border-border/60 bg-muted/20 px-5 py-3 sm:px-7" open={busy || undefined}><summary className="cursor-pointer text-xs font-medium">{copy.steps} <span className="ml-2 font-normal text-muted-foreground">{activities.length || ""}</span></summary><ol className="mt-3 max-h-52 space-y-2 overflow-y-auto pr-2" aria-live="polite" aria-relevant="additions text">{!activities.length && <li className="text-xs text-muted-foreground">{copy.preparing}</li>}{activities.map((item) => <li className="flex items-start gap-2 text-[11px] leading-5" key={item.id}>{item.status === "running" ? <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-primary" /> : item.status === "failed" ? <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600" /> : <Check className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}<span className="break-words text-muted-foreground">{item.title}</span></li>)}</ol></details>}
            <div className="min-h-40 px-5 py-6 sm:px-7">
              {run?.report ? <div className="prose prose-sm max-w-none break-words text-foreground prose-headings:font-semibold prose-headings:text-foreground prose-h1:text-xl prose-h2:text-lg prose-h3:text-base prose-p:leading-7 prose-a:text-primary prose-strong:text-foreground prose-code:break-all prose-code:text-foreground prose-pre:overflow-x-auto prose-pre:bg-muted prose-pre:text-foreground prose-th:text-foreground dark:prose-invert [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children, ...props }) => <a {...props} rel="noopener noreferrer" target="_blank">{children}</a>, img: ({ alt }) => <span>{alt}</span> }}>{run.report}</ReactMarkdown></div> : <div className="flex items-center gap-3 py-6 text-xs text-muted-foreground">{busy ? <Loader2 className="size-4 animate-spin text-primary" /> : <FileText className="size-4" />}{busy ? copy.preparing : run?.error || copy.noReport}</div>}
            </div>
            {run && !busy && <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 px-5 py-3 text-[10px] text-muted-foreground sm:px-7"><span>{run.artifacts.length} {copy.artifactCount}</span><span>{run.steps} {copy.toolCount}</span><span className="sm:ml-auto">{copy.saved}</span></div>}
          </section>
          {run && run.warnings.length > 0 && <section className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-4"><h3 className="mb-2 flex items-center gap-2 text-xs font-semibold"><TriangleAlert className="size-4 text-amber-600" />{copy.warnings}</h3><ul className="list-disc space-y-1.5 pl-5 text-xs leading-6 text-muted-foreground">{run.warnings.map((warning, index) => <li className="break-words" key={index}>{warning}</li>)}</ul></section>}
          {run && run.artifacts.length > 0 && <section className="min-w-0 space-y-3"><h3 className="flex items-center gap-2 px-1 text-xs font-semibold"><Database className="size-4 text-muted-foreground" />{copy.artifacts}<Badge variant="muted">{run.artifacts.length}</Badge></h3>{run.artifacts.map((artifact) => <ArtifactCard artifact={artifact} key={artifact.id} language={language} />)}</section>}
        </>}
      </main>
    </div>
  );
}

function FlaskIcon() { return <Sparkles className="size-7" strokeWidth={1.4} />; }

function ArtifactCard({ artifact, language }: { artifact: LabAIArtifact; language: AppLanguage }) {
  return <details className="group min-w-0 overflow-hidden rounded-xl border border-border/75 bg-card"><summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary [&::-webkit-details-marker]:hidden"><span className="rounded-lg bg-muted p-2 text-muted-foreground"><Database className="size-4" /></span><span className="min-w-0 flex-1"><span className="block break-words text-xs font-medium leading-5">{artifact.title}</span><span className="mt-0.5 block text-[10px] text-muted-foreground">{timestamp(artifact.created_at, language)}</span></span><ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" /></summary><div className="min-w-0 border-t border-border/60 px-4 py-3"><DataDetails language={language} value={artifact.data} /></div></details>;
}

function DataDetails({ value, language, depth = 0 }: { value: unknown; language: AppLanguage; depth?: number }) {
  const [expanded, setExpanded] = useState(false);
  const copy = labAiCopy[language];
  const percentageKeys = new Set(["fcf_margin", "revenue_growth", "wacc", "terminal_growth", "terminal_value_share", "weight", "period_return", "return_contribution", "estimated_return", "history_weight", "annualized_volatility", "max_drawdown", "portfolio_return", "benchmark_return", "annualized_return", "implied_growth"]);
  const scalar = (item: unknown, key = "") => typeof item === "number" && Number.isFinite(item) && percentageKeys.has(key) ? `${(item * 100).toLocaleString(language === "zh" ? "zh-CN" : "en-US", { maximumFractionDigits: 2 })}%` : item == null ? "—" : typeof item === "number" ? Number.isFinite(item) ? item.toLocaleString(language === "zh" ? "zh-CN" : "en-US", { maximumFractionDigits: 6 }) : "—" : typeof item === "boolean" ? copy[String(item) as "true" | "false"] : String(item);
  if (value == null || typeof value !== "object") return <span className="whitespace-pre-wrap break-words text-xs leading-6">{scalar(value)}</span>;
  const entries = Object.entries(value).filter(([key]) => !["id", "model_key", "thesis_snapshot_id", "saved_model_id", "source_ids"].includes(key));
  if (!entries.length) return <span className="text-xs text-muted-foreground">{copy.none}</span>;
  if (Array.isArray(value)) {
    const items = expanded ? value : value.slice(0, 8);
    const rows = items.every((item) => item && typeof item === "object" && !Array.isArray(item)) ? items as Record<string, unknown>[] : null;
    const keys = rows ? [...new Set(rows.flatMap((item) => Object.keys(item)))].filter((key) => rows.every((item) => item[key] == null || typeof item[key] !== "object")) : [];
    return <div className="min-w-0 space-y-2">{rows && keys.length > 0 && rows.every((item) => Object.keys(item).every((key) => keys.includes(key))) ? <div className="overflow-x-auto rounded-lg border border-border/60"><table className="w-full text-left text-[11px]"><thead className="bg-muted/50 text-muted-foreground"><tr>{keys.map((key) => <th className="whitespace-nowrap px-3 py-2 font-medium" key={key}>{labDataLabel(key, language)}</th>)}</tr></thead><tbody className="divide-y divide-border/50">{rows.map((item, index) => <tr key={index}>{keys.map((key) => <td className="max-w-sm whitespace-pre-wrap break-words px-3 py-2 tabular-nums" key={key}>{scalar(item[key], key)}</td>)}</tr>)}</tbody></table></div> : <div className="space-y-2">{items.map((item, index) => <div className="min-w-0 rounded-lg border border-border/50 p-2.5" key={index}><DataDetails depth={depth + 1} language={language} value={item} /></div>)}</div>}{value.length > 8 && <Button onClick={() => setExpanded((current) => !current)} size="sm" variant="ghost">{expanded ? copy.less : `${copy.more} (${value.length} ${copy.count})`}</Button>}</div>;
  }
  return <div className="min-w-0 divide-y divide-border/50">{entries.map(([key, item]) => item != null && typeof item === "object" ? <details className="min-w-0 py-2" key={key} open={depth < 1 && ["result", "metrics", "assumptions"].includes(key) || undefined}><summary className="cursor-pointer break-words py-1 text-xs font-medium text-muted-foreground">{labDataLabel(key, language)}{Array.isArray(item) ? ` · ${item.length}` : ""}</summary><div className="min-w-0 pb-1 pt-2"><DataDetails depth={depth + 1} language={language} value={item} /></div></details> : <div className="grid min-w-0 grid-cols-[minmax(85px,0.8fr)_minmax(0,2fr)] gap-3 py-2.5 text-xs leading-5" key={key}><span className="break-words text-muted-foreground">{labDataLabel(key, language)}</span><span className="whitespace-pre-wrap break-words tabular-nums">{scalar(item, key)}</span></div>)}</div>;
}
