import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent, MouseEvent as ReactMouseEvent, RefObject } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BrainCircuit,
  BriefcaseBusiness,
  Bot,
  Check,
  CircleDot,
  Copy,
  History,
  Loader2,
  Maximize2,
  MessageSquareText,
  Minimize2,
  PencilLine,
  Plus,
  Search,
  Send,
  Square,
  Trash2,
  X,
} from "lucide-react";

import type { ConfirmFn } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { persistChatThinkingEnabled, readChatThinkingEnabled, resetChatThinkingEnabled } from "@/lib/chat-thinking";
import { formatTemplate, i18n } from "@/lib/i18n";
import type { AppLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { ChatHistoryState } from "@/hooks/useConversations";
import type { ChatMessage, ChatTraceEvent, Conversation } from "@/types/app";

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  // copied 变为 true 后 1.5s 自动复位；组件卸载或再次复制时清理旧定时器。
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  async function handleCopy(e: ReactMouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // clipboard API not available
    }
  }

  return (
    <button
      type="button"
      className={cn(
        "shrink-0 rounded-md p-1 text-current/60 transition-colors hover:bg-foreground/10 hover:text-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      onClick={handleCopy}
      title={copied ? "已复制" : "复制"}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const msgDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (msgDate.getTime() === today.getTime()) return "今天";
  if (msgDate.getTime() === yesterday.getTime()) return "昨天";
  return "更早";
}

type FinanceChartMarker = "circle" | "square" | "triangle" | "pentagon";

type FinanceChartPoint = {
  label: string;
  value: number;
};

type FinanceChartSeries = {
  symbol: string;
  name?: string;
  color?: string;
  marker?: FinanceChartMarker;
  points: FinanceChartPoint[];
};

type FinanceChartRow = {
  symbol: string;
  name?: string;
  price?: string;
  change?: string;
  changeRate?: string;
  previousClose?: string;
  color?: string;
  marker?: FinanceChartMarker;
};

type FinanceChartPayload = {
  title?: string;
  subtitle?: string;
  unit?: string;
  activeRange?: string;
  ranges?: string[];
  series: FinanceChartSeries[];
  rows?: FinanceChartRow[];
};

const FINANCE_CHART_COLORS = ["#5b7cfa", "#ffb45c", "#9db7ff", "#f97316", "#f8efe6", "#22c55e"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toText(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.replace(/[%,$]/g, "").trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeMarker(value: unknown): FinanceChartMarker | undefined {
  if (value === "circle" || value === "square" || value === "triangle" || value === "pentagon") {
    return value;
  }
  return undefined;
}

function normalizePoint(value: unknown): FinanceChartPoint | null {
  if (Array.isArray(value)) {
    const numberValue = toNumber(value[1]);
    if (numberValue === null) return null;
    return { label: toText(value[0]) ?? "", value: numberValue };
  }
  if (!isRecord(value)) return null;
  const numberValue = toNumber(value.value ?? value.close ?? value.change_rate ?? value.changeRate);
  if (numberValue === null) return null;
  return {
    label: toText(value.label ?? value.date ?? value.time) ?? "",
    value: numberValue,
  };
}

function parseFinanceChart(raw: string): FinanceChartPayload | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.series)) return null;

    const series = parsed.series
      .map((item, index): FinanceChartSeries | null => {
        if (!isRecord(item)) return null;
        const symbol = toText(item.symbol ?? item.name) ?? `Series ${index + 1}`;
        const rawPoints = Array.isArray(item.points) ? item.points : Array.isArray(item.data) ? item.data : [];
        const points = rawPoints.map(normalizePoint).filter((point): point is FinanceChartPoint => Boolean(point));
        if (!points.length) return null;
        return {
          symbol,
          name: toText(item.name),
          color: toText(item.color),
          marker: normalizeMarker(item.marker),
          points,
        };
      })
      .filter((item): item is FinanceChartSeries => Boolean(item));

    if (!series.length) return null;

    const rows = Array.isArray(parsed.rows)
      ? parsed.rows
          .map((item): FinanceChartRow | null => {
            if (!isRecord(item)) return null;
            const symbol = toText(item.symbol ?? item.name);
            if (!symbol) return null;
            return {
              symbol,
              name: toText(item.name),
              price: toText(item.price),
              change: toText(item.change ?? item.changeValue),
              changeRate: toText(item.changeRate ?? item.change_rate),
              previousClose: toText(item.previousClose ?? item.previous_close),
              color: toText(item.color),
              marker: normalizeMarker(item.marker),
            };
          })
          .filter((item): item is FinanceChartRow => Boolean(item))
      : undefined;

    return {
      title: toText(parsed.title),
      subtitle: toText(parsed.subtitle),
      unit: toText(parsed.unit) ?? "%",
      activeRange: toText(parsed.activeRange ?? parsed.active_range),
      ranges: Array.isArray(parsed.ranges)
        ? parsed.ranges.map(toText).filter((item): item is string => Boolean(item))
        : undefined,
      series,
      rows,
    };
  } catch {
    return null;
  }
}

function formatAxisLabel(value: number, unit: string): string {
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Number(value.toFixed(1));
  return unit ? `${rounded}${unit}` : String(rounded);
}

function pointLabel(point: FinanceChartPoint, index: number): string {
  return point.label || String(index + 1);
}

function buildLinePath(points: FinanceChartPoint[], min: number, max: number, width: number, height: number, left: number, top: number) {
  const range = max - min || 1;
  const step = points.length > 1 ? width / (points.length - 1) : 0;
  return points
    .map((point, index) => {
      const x = left + step * index;
      const y = top + (1 - (point.value - min) / range) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function markerStyle(marker: FinanceChartMarker | undefined, color: string): CSSProperties {
  const base: CSSProperties = { backgroundColor: color };
  if (marker === "circle") return { ...base, borderRadius: "999px" };
  if (marker === "triangle") return { ...base, clipPath: "polygon(50% 0, 0 100%, 100% 100%)" };
  if (marker === "pentagon") return { ...base, clipPath: "polygon(50% 0, 100% 38%, 82% 100%, 18% 100%, 0 38%)" };
  return { ...base, borderRadius: "4px" };
}

function rowToneClass(row: FinanceChartRow): string {
  const value = `${row.change ?? ""} ${row.changeRate ?? ""}`.trim();
  if (value.startsWith("-") || value.includes("↓")) return "text-[var(--color-down)]";
  if (value.startsWith("+") || value.includes("↑")) return "text-[var(--color-up)]";
  return "text-foreground";
}

function FinanceChartBlock({ chart, language }: { chart: FinanceChartPayload; language: AppLanguage }) {
  const allValues = chart.series.flatMap((series) => series.points.map((point) => point.value));
  const rawMin = Math.min(...allValues, 0);
  const rawMax = Math.max(...allValues, 0);
  const padding = Math.max((rawMax - rawMin) * 0.08, chart.unit === "%" ? 12 : 1);
  const min = rawMin - padding;
  const max = rawMax + padding;
  const svgWidth = 900;
  const svgHeight = 292;
  const left = 58;
  const right = 24;
  const top = 24;
  const bottom = 52;
  const plotWidth = svgWidth - left - right;
  const plotHeight = svgHeight - top - bottom;
  const labels = language === "en"
    ? { symbol: "Symbol", price: "Price", change: "Change", rate: "Change %", prev: "Previous close" }
    : { symbol: "股票代码", price: "价格", change: "涨跌额", rate: "涨跌幅", prev: "昨收盘" };
  const firstSeries = chart.series[0];
  const tickIndexes = firstSeries.points.length > 1
    ? Array.from(new Set([0, Math.floor((firstSeries.points.length - 1) / 4), Math.floor((firstSeries.points.length - 1) / 2), Math.floor(((firstSeries.points.length - 1) * 3) / 4), firstSeries.points.length - 1]))
    : [0];
  const yTicks = Array.from({ length: 5 }, (_, index) => max - ((max - min) * index) / 4);
  const ranges = chart.ranges?.length ? chart.ranges : ["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "MAX"];
  const activeRange = chart.activeRange ?? ranges[Math.min(5, ranges.length - 1)];

  return (
    <div className="not-prose my-3 overflow-hidden rounded-2xl bg-muted/30 text-foreground ring-1 ring-border/45">
      <div className="space-y-1 px-4 pb-2 pt-4">
        {chart.title ? <p className="text-sm font-semibold">{chart.title}</p> : null}
        {chart.subtitle ? <p className="text-xs text-muted-foreground">{chart.subtitle}</p> : null}
        <div className="flex flex-wrap gap-2 pt-2">
          {chart.series.map((series, index) => {
            const color = series.color ?? FINANCE_CHART_COLORS[index % FINANCE_CHART_COLORS.length];
            return (
              <span
                className="inline-flex h-8 items-center gap-2 rounded-full border border-border/75 bg-background/55 px-3 text-xs font-semibold text-foreground"
                key={`${series.symbol}-${index}`}
              >
                <span className="size-3 shrink-0" style={markerStyle(series.marker, color)} />
                <span className="max-w-28 truncate">{series.symbol}</span>
              </span>
            );
          })}
        </div>
      </div>
      <div className="overflow-x-auto px-2 pb-1">
        <svg className="h-[280px] min-w-[760px] text-muted-foreground" role="img" viewBox={`0 0 ${svgWidth} ${svgHeight}`}>
          {yTicks.map((tick) => {
            const y = top + (1 - (tick - min) / (max - min || 1)) * plotHeight;
            return (
              <g key={tick.toFixed(4)}>
                <line stroke="currentColor" strokeOpacity="0.14" x1={left} x2={svgWidth - right} y1={y} y2={y} />
                <text fill="currentColor" fontSize="15" x={left - 10} y={y + 5} textAnchor="end">
                  {formatAxisLabel(tick, chart.unit ?? "")}
                </text>
              </g>
            );
          })}
          {tickIndexes.map((pointIndex) => {
            const x = left + (firstSeries.points.length > 1 ? (plotWidth * pointIndex) / (firstSeries.points.length - 1) : 0);
            return (
              <g key={`${pointIndex}-${pointLabel(firstSeries.points[pointIndex], pointIndex)}`}>
                <line stroke="currentColor" strokeOpacity="0.16" x1={x} x2={x} y1={top} y2={top + plotHeight} />
                <text fill="currentColor" fontSize="15" x={x} y={svgHeight - 18} textAnchor="middle">
                  {pointLabel(firstSeries.points[pointIndex], pointIndex)}
                </text>
              </g>
            );
          })}
          <line stroke="currentColor" strokeDasharray="3 8" strokeOpacity="0.5" x1={left} x2={svgWidth - right} y1={top + (1 - (0 - min) / (max - min || 1)) * plotHeight} y2={top + (1 - (0 - min) / (max - min || 1)) * plotHeight} />
          {chart.series.map((series, index) => {
            const color = series.color ?? FINANCE_CHART_COLORS[index % FINANCE_CHART_COLORS.length];
            const path = buildLinePath(series.points, min, max, plotWidth, plotHeight, left, top);
            const last = series.points[series.points.length - 1];
            const lastX = left + (series.points.length > 1 ? plotWidth : 0);
            const lastY = top + (1 - (last.value - min) / (max - min || 1)) * plotHeight;
            return (
              <g key={`${series.symbol}-line-${index}`}>
                <path d={path} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
                <circle cx={lastX} cy={lastY} fill={color} r="5.5" />
              </g>
            );
          })}
        </svg>
      </div>
      <div className="flex overflow-x-auto border-t border-border/45 px-4 py-2 text-sm text-muted-foreground">
        {ranges.map((range) => (
          <span
            className={cn(
              "mr-2 shrink-0 rounded-full px-3 py-1.5 font-medium",
              range === activeRange ? "bg-background/80 text-foreground shadow-sm" : "text-muted-foreground",
            )}
            key={range}
          >
            {range}
          </span>
        ))}
      </div>
      {chart.rows?.length ? (
        <div className="overflow-x-auto border-t border-border/45">
          <table className="w-full min-w-[680px] border-collapse text-sm">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border/45">
                <th className="px-4 py-3 text-left font-medium">{labels.symbol}</th>
                <th className="px-4 py-3 text-right font-medium">{labels.price}</th>
                <th className="px-4 py-3 text-right font-medium">{labels.change}</th>
                <th className="px-4 py-3 text-right font-medium">{labels.rate}</th>
                <th className="px-4 py-3 text-right font-medium">{labels.prev}</th>
              </tr>
            </thead>
            <tbody>
              {chart.rows.map((row, index) => {
                const matchedSeries = chart.series.find((series) => series.symbol === row.symbol);
                const color = row.color ?? matchedSeries?.color ?? FINANCE_CHART_COLORS[index % FINANCE_CHART_COLORS.length];
                return (
                  <tr className="border-b border-border/35 last:border-0" key={`${row.symbol}-${index}`}>
                    <td className="px-4 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="size-3 shrink-0" style={markerStyle(row.marker ?? matchedSeries?.marker, color)} />
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-foreground">{row.symbol}</p>
                          {row.name ? <p className="truncate text-xs text-muted-foreground">{row.name}</p> : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.price ?? "-"}</td>
                    <td className={cn("px-4 py-3 text-right tabular-nums font-semibold", rowToneClass(row))}>{row.change ?? "-"}</td>
                    <td className={cn("px-4 py-3 text-right tabular-nums font-semibold", rowToneClass(row))}>{row.changeRate ?? "-"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.previousClose ?? "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function TraceIcon({ status }: { status: ChatTraceEvent["status"] }) {
  if (status === "running") return <Loader2 className="size-3 animate-spin text-primary" />;
  if (status === "done") return <Check className="size-3 text-emerald-500" />;
  if (status === "error") return <X className="size-3 text-destructive" />;
  return <CircleDot className="size-3 text-muted-foreground" />;
}

function ChatTraceList({ trace }: { trace?: ChatTraceEvent[] }) {
  if (!trace?.length) return null;

  return (
    <div className="mb-3 space-y-1 rounded-md border border-border/80 bg-background/70 px-2.5 py-2 text-xs text-muted-foreground shadow-sm">
      {trace.map((item) => (
        <div className="flex min-w-0 items-start gap-2" key={item.id}>
          <span className="mt-1 shrink-0">
            <TraceIcon status={item.status} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-medium text-foreground/85">{item.label}</span>
              <span className="text-[10px] text-muted-foreground/80">{item.createdAt}</span>
            </div>
            {item.detail ? <p className="mt-0.5 break-words text-[11px] leading-4">{item.detail}</p> : null}
          </div>
        </div>
      ))}
    </div>
  );
}


export function ChatPage({
  chatScrollRef,
  confirmAction,
  endRef,
  handleSend,
  handleChatScroll,
  handleStopStreaming,
  embedded = false,
  expanded = false,
  isSending,
  language,
  displayName,
  onToggleExpanded,
  messages,
  mobileNavVisible = true,
  prompt,
  quickPrompts,
  chatHistory,
  setPrompt,
}: {
  chatScrollRef: RefObject<HTMLDivElement | null>;
  confirmAction: ConfirmFn;
  endRef: RefObject<HTMLDivElement | null>;
  handleSend: (event?: { preventDefault: () => void }, value?: string, options?: { forceNewSession?: boolean; newSession?: boolean; thinkingEnabled?: boolean }) => void;
  handleChatScroll: () => void;
  handleStopStreaming: () => void;
  embedded?: boolean;
  expanded?: boolean;
  isSending: boolean;
  language: AppLanguage;
  displayName?: string;
  onToggleExpanded?: () => void;
  messages: ChatMessage[];
  mobileNavVisible?: boolean;
  prompt: string;
  quickPrompts: string[];
  chatHistory: ChatHistoryState;
  setPrompt: (value: string) => void;
}) {
  const {
    conversations,
    activeId,
    createConversation,
    switchConversation,
    deleteConversation,
    clearMessages,
    clearAllConversations,
    isCreatingConversation,
    isActiveConversationLoading,
  } = chatHistory;
  const chatCopy = i18n[language].chat;
  const common = i18n[language].common;
  const uiCopy = i18n[language].chatUi;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [mobileComposerOpen, setMobileComposerOpen] = useState(false);
  const [thinkingEnabled, setThinkingEnabled] = useState(readChatThinkingEnabled);
  const historyMenuRef = useRef<HTMLDivElement | null>(null);
  const openComposerLabel = language === "en" ? "Open question input" : "打开提问输入框";
  const closeComposerLabel = language === "en" ? "Close input" : "关闭输入框";
  const expandLabel = expanded
    ? (language === "en" ? "Collapse chat" : "收起对话")
    : (language === "en" ? "Expand chat" : "展开对话");
  const thinkingLabel = language === "en"
    ? `Thinking mode ${thinkingEnabled ? "on" : "off"}`
    : `思考模式${thinkingEnabled ? "开启" : "关闭"}`;
  const isHistoryLoading = chatHistory.isLoading;
  const isNewConversation = !isHistoryLoading && !isActiveConversationLoading && messages.length === 0 && !isSending;
  const greeting = displayName
    ? formatTemplate(uiCopy.greeting, { name: displayName })
    : uiCopy.greetingAnonymous;
  const suggestionPrompts = quickPrompts.slice(0, 3);
  const explorePrompts = [
    {
      icon: <BriefcaseBusiness className="size-5" />,
      label: uiCopy.explorePortfolio,
      prompt: language === "en" ? "Analyze my portfolio positions" : "分析我的持仓列表",
    },
  ];
  const markdownComponents = useMemo<Components>(
    () => ({
      pre({ children }) {
        return <div className="not-prose my-2 overflow-x-auto rounded-md bg-muted/35 p-3">{children}</div>;
      },
      code({ className, children, ...props }) {
        const match = /language-([\w-]+)/.exec(className ?? "");
        const lang = match?.[1]?.toLowerCase();
        const raw = String(children ?? "").replace(/\n$/, "");
        if (lang === "finance-chart" || lang === "finance_chart" || lang === "financechart") {
          const chart = parseFinanceChart(raw);
          if (chart) return <FinanceChartBlock chart={chart} language={language} />;
        }
        return (
          <code className={className} {...props}>
            {children}
          </code>
        );
      },
    }),
    [language],
  );

  const grouped = useMemo(() => {
    const groups: Record<string, Conversation[]> = {};
    for (const c of conversations) {
      const label = formatRelativeDate(c.updatedAt);
      (groups[label] ??= []).push(c);
    }
    return groups;
  }, [conversations]);

  useEffect(() => {
    function closeFloatingPanels(event: globalThis.MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (historyMenuRef.current && !historyMenuRef.current.contains(target)) {
        setHistoryOpen(false);
      }
    }

    document.addEventListener("mousedown", closeFloatingPanels);
    return () => document.removeEventListener("mousedown", closeFloatingPanels);
  }, []);

  useEffect(() => {
    if (prompt.trim()) {
      setMobileComposerOpen(true);
    }
  }, [prompt]);

  useEffect(() => {
    persistChatThinkingEnabled(thinkingEnabled);
  }, [thinkingEnabled]);

  function resetThinkingMode() {
    resetChatThinkingEnabled();
    setThinkingEnabled(false);
  }

  function handleNew() {
    resetThinkingMode();
    if (isSending || isCreatingConversation || isNewConversation) return;
    void createConversation().catch(() => {
      // 新建失败时保留当前会话。
    });
  }

  async function handleClearAllHistory() {
    const confirmed = await confirmAction({
      cancelText: common.cancel,
      confirmText: common.clear,
      description: uiCopy.clearAllHistoryConfirmDescription,
      destructive: true,
      title: uiCopy.clearAllHistory,
    });
    if (!confirmed) return;
    clearAllConversations();
    setHistoryOpen(false);
  }

  function closeMobileComposer() {
    setMobileComposerOpen(false);
  }

  function toggleThinkingEnabled() {
    setThinkingEnabled((current) => {
      const next = !current;
      persistChatThinkingEnabled(next);
      return next;
    });
  }

  function handleClearCurrent() {
    if (!activeId) return;
    resetThinkingMode();
    clearMessages(activeId);
  }

  function handleSwitchConversation(conversation: Conversation) {
    const isEmptyConversation = conversation.messageCount === 0 || (conversation.messages.length === 0 && !conversation.lastMessage);
    if (isEmptyConversation) {
      resetThinkingMode();
    }
    switchConversation(conversation.id);
    setHistoryOpen(false);
  }

  function handleComposerSubmit(event: FormEvent<HTMLFormElement>) {
    const shouldClose = Boolean(prompt.trim()) && !isSending;
    handleSend(event, undefined, { thinkingEnabled });
    if (shouldClose) {
      closeMobileComposer();
    }
  }

  function handleToggleFullscreen() {
    if (embedded && onToggleExpanded) {
      onToggleExpanded();
      return;
    }
    const root = document.documentElement;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {
        // Ignore browsers that block programmatic fullscreen exit.
      });
      return;
    }
    root.requestFullscreen?.().catch(() => {
      // Fullscreen is a convenience action and can be blocked by the browser.
    });
  }

  function sendPrompt(value: string) {
    const text = value.trim();
    if (!text || isSending) return;
    handleSend(undefined, text, { thinkingEnabled });
    closeMobileComposer();
  }

  function renderComposer(mode: "desktop" | "mobile") {
    const isMobile = mode === "mobile";
    const largeComposer = isNewConversation && !embedded;

    return (
      <form
        className={cn(
          isMobile
            ? "absolute inset-x-2 rounded-[30px] border border-border/80 bg-card/95 p-2.5 shadow-2xl backdrop-blur"
            : cn("bg-transparent px-3 pb-4 pt-1 sm:px-4", embedded ? "block" : "hidden lg:block"),
          isMobile && (mobileNavVisible ? "bottom-[calc(4.75rem+env(safe-area-inset-bottom))]" : "bottom-[calc(0.75rem+env(safe-area-inset-bottom))]"),
        )}
        onSubmit={handleComposerSubmit}
      >
        <div
          className={cn(
            "mr-auto flex w-full flex-col rounded-[30px] border border-border/80 bg-background/95 px-4 py-3 shadow-[var(--control-shadow)] transition-all focus-within:border-primary/45 focus-within:ring-2 focus-within:ring-primary/15",
            largeComposer ? "min-h-[150px]" : "min-h-[60px]",
          )}
        >
          <div className="flex min-h-0 flex-1 items-start gap-2">
              <Textarea
                className={cn(
                  "max-h-[180px] min-w-0 flex-1 resize-none border-0 bg-transparent px-0 py-1 text-[18px] leading-7 shadow-none focus-visible:border-transparent focus-visible:bg-transparent focus-visible:ring-0",
                  largeComposer ? "min-h-[78px]" : "min-h-10 text-[15px] leading-6",
                  embedded && "text-[14px] leading-6",
                )}
              disabled={isSending}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  const shouldClose = Boolean(prompt.trim()) && !isSending;
                  handleSend(event, undefined, { thinkingEnabled });
                  if (shouldClose) {
                    closeMobileComposer();
                  }
                }
              }}
              placeholder={uiCopy.promptPlaceholder}
              value={prompt}
            />
          </div>
          <div className="mt-2 flex items-end justify-between gap-3">
            <div className="flex shrink-0 items-center gap-1">
              <Button
                aria-label={common.newChat}
                aria-busy={isCreatingConversation}
                className="h-10 w-10 shrink-0 rounded-2xl text-muted-foreground hover:text-foreground"
                disabled={isSending || isCreatingConversation || isNewConversation}
                onClick={handleNew}
                size="icon"
                title={common.newChat}
                type="button"
                variant="ghost"
              >
                {isCreatingConversation ? <Loader2 className="size-5 animate-spin" /> : <Plus className="size-5" />}
              </Button>
              <Button
                aria-label={thinkingLabel}
                aria-pressed={thinkingEnabled}
                className={cn(
                  "h-10 w-10 shrink-0 rounded-2xl transition-colors",
                  thinkingEnabled
                    ? "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={toggleThinkingEnabled}
                size="icon"
                title={thinkingLabel}
                type="button"
                variant="ghost"
              >
                <BrainCircuit className="size-5" />
              </Button>
            </div>
            {isSending ? (
              <Button className="h-10 w-10 shrink-0 rounded-full sm:w-auto sm:px-4" onClick={handleStopStreaming} type="button" variant="destructive">
                <Square className="fill-current" />
                <span className="hidden sm:inline">{chatCopy.stop}</span>
              </Button>
            ) : (
              <Button className="h-10 w-10 shrink-0 rounded-full sm:w-auto sm:px-4" disabled={!prompt.trim()} type="submit">
                <Send className="size-5" />
                <span className="hidden sm:inline">{common.send}</span>
              </Button>
            )}
          </div>
        </div>
      </form>
    );
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-1 overflow-hidden", embedded && "min-h-0 rounded-none")}>
      <section className="finance-flat-page flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-transparent">
        <div className={cn("shrink-0 border-b border-border/60 px-3 py-3 sm:px-4", embedded && "py-2.5")}>
          <div className="flex items-center justify-between gap-3">
            <h1 className={cn("truncate font-semibold tracking-normal", embedded ? "text-base sm:text-lg" : "text-3xl sm:text-4xl")}>{uiCopy.title}</h1>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                aria-label="新建对话"
                aria-busy={isCreatingConversation}
                className="h-11 w-11 rounded-full text-muted-foreground hover:bg-muted/70 hover:text-foreground sm:h-12 sm:w-12"
                disabled={isSending || isCreatingConversation || isNewConversation}
                onClick={handleNew}
                size="icon"
                title={common.newChat}
                type="button"
                variant="ghost"
              >
                {isCreatingConversation ? <Loader2 className="size-5 animate-spin" /> : <PencilLine className="size-5" />}
              </Button>
              <div className="relative" ref={historyMenuRef}>
                <Button
                  aria-expanded={historyOpen}
                  aria-haspopup="menu"
                  aria-label={common.history}
                  className="h-11 w-11 rounded-full text-muted-foreground hover:bg-muted/70 hover:text-foreground sm:h-12 sm:w-12"
                  onClick={() => setHistoryOpen((current) => !current)}
                  size="icon"
                  title={common.history}
                  type="button"
                  variant="ghost"
                >
                  <History className="size-5" />
                </Button>
                {historyOpen ? (
                  <div
                    className={cn(
                      "absolute top-[calc(100%+0.5rem)] z-40 max-h-[min(520px,72dvh)] w-[calc(100vw-1.5rem)] max-w-[22rem] overflow-hidden rounded-xl border border-border/90 bg-popover/95 p-2 shadow-2xl backdrop-blur lg:right-0 lg:max-h-none lg:w-[320px] lg:max-w-[calc(100vw-2rem)] lg:rounded-lg",
                      embedded ? "right-[-2.75rem]" : "right-[-3.25rem] sm:right-[-3.5rem]",
                    )}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2 px-1">
                      <div>
                        <p className="text-xs font-semibold">{common.history}</p>
                        <p className="text-[10px] text-muted-foreground">{formatTemplate(uiCopy.sessions, { count: conversations.length })}</p>
                      </div>
                      {conversations.length > 0 ? (
                        <Button
                          aria-label={uiCopy.clearAllHistory}
                          className="h-7 shrink-0 px-2 text-[11px]"
                          onClick={handleClearAllHistory}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          <Trash2 className="size-3" />
                          {uiCopy.clearAllHistory}
                        </Button>
                      ) : null}
                    </div>
                    {activeId ? (
                      <Button
                        className="mb-2 h-8 w-full justify-start px-2 text-xs"
                        onClick={handleClearCurrent}
                        type="button"
                        variant="ghost"
                      >
                        <Trash2 className="size-3.5" />
                        {uiCopy.clearCurrent}
                      </Button>
                    ) : null}
                    <div className="max-h-[min(410px,58dvh)] overflow-y-auto lg:max-h-[360px]">
                      {Object.entries(grouped).map(([label, convs]) => (
                        <div key={label} className="mb-1 last:mb-0">
                          <p className="px-2 py-1 text-[10px] font-medium uppercase text-muted-foreground">{label}</p>
                          {convs.map((c) => (
                            <div
                              key={c.id}
                              className={cn(
                                "group flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                activeId === c.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                              )}
                              onClick={() => {
                                handleSwitchConversation(c);
                              }}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter" && event.key !== " ") return;
                                event.preventDefault();
                                handleSwitchConversation(c);
                              }}
                              role="button"
                              tabIndex={0}
                            >
                              <MessageSquareText className="size-3.5 shrink-0" />
                              <span className="min-w-0 flex-1 truncate">{c.title}</span>
                              <button
                                aria-label={uiCopy.deleteConversation}
                                className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground opacity-100 transition-opacity hover:bg-destructive/10 hover:text-destructive lg:size-5 lg:opacity-0 lg:group-hover:opacity-100"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  deleteConversation(c.id);
                                }}
                                title={uiCopy.deleteConversation}
                                type="button"
                              >
                                <X className="size-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      ))}
                      {conversations.length === 0 ? (
                        <div className="px-2 py-6 text-center text-xs text-muted-foreground">{uiCopy.emptyHistory}</div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
              <Button
                aria-label={embedded ? expandLabel : uiCopy.fullscreen}
                className={cn(
                  "h-11 w-11 rounded-full text-muted-foreground hover:bg-muted/70 hover:text-foreground sm:h-12 sm:w-12",
                  embedded && "h-9 w-9 sm:h-9 sm:w-9",
                )}
                onClick={handleToggleFullscreen}
                size="icon"
                title={embedded ? expandLabel : uiCopy.fullscreen}
                type="button"
                variant="ghost"
              >
                {embedded && expanded ? <Minimize2 className="size-4" /> : <Maximize2 className={embedded ? "size-4" : "size-5"} />}
              </Button>
            </div>
          </div>
        </div>

        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto px-3 pt-4 sm:px-4 sm:pt-5 lg:pb-3",
            embedded ? "pb-4 sm:pb-4" : mobileNavVisible ? "pb-20 sm:pb-24" : "pb-14 sm:pb-16",
          )}
          onScroll={handleChatScroll}
          ref={chatScrollRef}
        >
          <div className="mr-auto w-full space-y-4">
            {isActiveConversationLoading ? (
              <div className="flex min-h-56 items-center justify-center">
                <div className="flex items-center gap-2 rounded-md border border-border/75 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin text-primary" />
                  {common.loading}
                </div>
              </div>
            ) : null}
            {isNewConversation ? (
              <div className={cn("mx-auto w-full max-w-5xl space-y-10 py-6 sm:py-10", embedded && "space-y-5 py-2 sm:py-4")}>
                <div className={cn("space-y-8", embedded && "space-y-4")}>
                  <h2 className={cn("max-w-4xl font-semibold leading-tight tracking-normal", embedded ? "text-lg sm:text-xl" : "text-2xl sm:text-3xl")}>
                    {greeting}
                  </h2>
                  {suggestionPrompts.length > 0 ? (
                    <div className="max-w-4xl space-y-2">
                      {suggestionPrompts.map((item) => (
                        <button
                            className="group flex min-h-14 w-full items-center justify-between gap-4 rounded-2xl bg-muted/35 px-4 py-3 text-left text-base font-medium text-foreground transition-colors hover:bg-muted/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-5"
                          key={item}
                          onClick={() => sendPrompt(item)}
                          type="button"
                        >
                            <span className="min-w-0 truncate">{item}</span>
                            <span className={cn("grid shrink-0 place-items-center rounded-full bg-background/65 text-muted-foreground transition-colors group-hover:text-primary", embedded ? "size-8" : "size-10")}>
                              <Search className={embedded ? "size-4" : "size-5"} />
                            </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className={cn("space-y-4", embedded && "space-y-2")}>
                  <p className={cn("font-semibold text-muted-foreground", embedded ? "text-sm" : "text-lg sm:text-xl")}>{uiCopy.exploreTitle}</p>
                  <div className="flex max-w-4xl flex-wrap gap-3">
                    {explorePrompts.map((item) => (
                      <button
                        className={cn(
                          "inline-flex min-h-11 items-center gap-2 rounded-full bg-muted/55 px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-base",
                          embedded && "min-h-9 px-3 py-1.5 text-xs sm:text-sm",
                        )}
                        key={item.label}
                        onClick={() => sendPrompt(item.prompt)}
                        type="button"
                      >
                        <span className="text-muted-foreground">{item.icon}</span>
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
            {!isActiveConversationLoading && messages.map((message) => (
              <div className={cn("group flex min-w-0 gap-2 sm:gap-3", message.role === "user" ? "justify-end" : "justify-start")} key={message.id}>
                {message.role === "assistant" ? (
                  <div className="mt-1 grid size-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                    {message.pending ? <Loader2 className="size-4 animate-spin" /> : <Bot className="size-4" />}
                  </div>
                ) : null}
                <div
                  className={cn(
                    "message-bubble min-w-0 max-w-[92%] rounded-2xl border px-3.5 py-3 shadow-sm sm:max-w-[84%] sm:px-4 sm:py-3.5 xl:max-w-[78%]",
                    embedded && "sm:max-w-[92%] xl:max-w-[88%]",
                    message.role === "user"
                      ? "chat-bubble-user"
                      : "chat-bubble-assistant",
                  )}
                >
                  {message.role === "assistant" ? <ChatTraceList trace={message.trace} /> : null}
                  {message.role === "assistant" && message.pending && message.status ? (
                    <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <Loader2 className="size-3 animate-spin text-primary" />
                      <span>{message.status}</span>
                    </div>
                  ) : null}
                  {message.pending && message.status && message.content === message.status ? null : (
                    <div className="chat-message-content prose prose-sm dark:prose-invert max-w-none break-words prose-headings:my-2 prose-p:my-1 prose-p:text-inherit prose-pre:my-2 prose-pre:rounded-md prose-code:text-primary prose-strong:text-inherit prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-li:text-inherit prose-table:my-2">
                      {message.role === "assistant" ? (
                        <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                      ) : (
                        <p className="whitespace-pre-wrap">{message.content}</p>
                      )}
                    </div>
                  )}
                  <div
                    className={cn(
                      "mt-2 flex items-center gap-1.5",
                      message.role === "user" ? "text-current/70" : "text-muted-foreground",
                    )}
                  >
                    <span className="text-[11px]">{message.createdAt}</span>
                    <CopyButton
                      text={message.content}
                      className="opacity-0 transition-opacity group-hover:opacity-100"
                    />
                  </div>
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        </div>

        {renderComposer("desktop")}
      </section>
      {!embedded && mobileComposerOpen ? (
        <div className="fixed inset-0 z-[1000] lg:hidden">
          <button
            aria-label={closeComposerLabel}
            className="absolute inset-0 bg-background/35 backdrop-blur-[1px]"
            onClick={closeMobileComposer}
            type="button"
          />
          {renderComposer("mobile")}
        </div>
      ) : !embedded ? (
        <button
          aria-label={openComposerLabel}
          className={cn(
            "fixed right-3 z-30 grid size-12 place-items-center rounded-full border border-primary/35 bg-primary text-primary-foreground shadow-[0_14px_34px_hsl(var(--primary)_/_0.28)] transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:hidden",
            mobileNavVisible ? "bottom-[calc(4.75rem+env(safe-area-inset-bottom))]" : "bottom-[calc(0.75rem+env(safe-area-inset-bottom))]",
          )}
          onClick={() => setMobileComposerOpen(true)}
          title={openComposerLabel}
          type="button"
        >
          {isSending ? <Loader2 className="size-5 animate-spin" /> : <MessageSquareText className="size-5" />}
          {prompt.trim() ? <span className="absolute right-1 top-1 size-2.5 rounded-full bg-secondary ring-2 ring-background" /> : null}
        </button>
      ) : null}
    </div>
  );
}
