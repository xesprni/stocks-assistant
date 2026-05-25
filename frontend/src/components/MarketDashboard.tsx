import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  BarChart2,
  Loader2,
  Minus,
  RefreshCw,
  Settings2,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getCandlesticks, getIndexQuotes, getStockQuotes } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useToneClasses } from "@/lib/color-scheme";
import { calcSupportResistance, type SupportResistanceLevel } from "@/lib/indicators";
import type { QuoteItem, WatchlistCategory } from "@/types/app";

type AppLanguage = "zh" | "en";

const marketDashboardCopy = {
  zh: {
    title: "行情监控",
    subtitle: "数据来源 Longbridge SDK",
    updatedAt: "更新于 {time}",
    refreshCountdown: "{seconds}s 后刷新",
    manualRefresh: "手动刷新",
    refresh: "刷新",
    config: "配置",
    marketConfig: "行情配置",
    indexTab: "大盘指数",
    stockTab: "个股行情",
    all: "全部",
    us: "美股",
    a: "A股",
    h: "H股",
    symbols: "{count} 支",
    open: "开盘",
    high: "最高",
    low: "最低",
    support: "支撑",
    resistance: "阻力",
    calculateLevels: "计算",
    calculatingLevels: "计算中",
    noLevels: "暂无有效支撑/阻力",
    levelsFailed: "计算失败",
    loadingQuotes: "正在拉取行情数据...",
    loadFailed: "加载失败",
    emptyIndices: "暂无指数数据，请在行情配置中添加指数并配置 Longbridge 凭据。",
    emptyStocks: "自选股列表为空，请先在「自选」页面添加股票。",
  },
  en: {
    title: "Market Monitor",
    subtitle: "Data source: Longbridge SDK",
    updatedAt: "updated at {time}",
    refreshCountdown: "refresh in {seconds}s",
    manualRefresh: "Manual refresh",
    refresh: "Refresh",
    config: "Config",
    marketConfig: "Market config",
    indexTab: "Indices",
    stockTab: "Stocks",
    all: "All",
    us: "US",
    a: "A-share",
    h: "HK",
    symbols: "{count} symbols",
    open: "Open",
    high: "High",
    low: "Low",
    support: "Support",
    resistance: "Resistance",
    calculateLevels: "Calculate",
    calculatingLevels: "Calculating",
    noLevels: "No valid levels",
    levelsFailed: "Failed to calculate",
    loadingQuotes: "Fetching market quotes...",
    loadFailed: "Failed to load",
    emptyIndices: "No index data. Add indices in market config and configure Longbridge credentials.",
    emptyStocks: "The watchlist is empty. Add stocks on the Watchlist page first.",
  },
} as const;

type MarketDashboardCopy = (typeof marketDashboardCopy)[AppLanguage];

function formatTemplate(text: string, values: Record<string, string | number>) {
  return text.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
}

function getStockCategories(language: AppLanguage): Array<{ id: WatchlistCategory | "ALL"; label: string }> {
  const copy = marketDashboardCopy[language];
  return [
    { id: "ALL", label: copy.all },
    { id: "US", label: copy.us },
    { id: "A", label: copy.a },
    { id: "H", label: copy.h },
  ];
}

function rateTone(rate: string | null): "up" | "down" | "flat" {
  if (!rate) return "flat";
  if (rate.startsWith("-")) return "down";
  if (rate !== "0" && rate !== "0.00%") return "up";
  return "flat";
}

function ChangeIndicator({ rate }: { rate: string | null }) {
  const tone = rateTone(rate);
  const tc = useToneClasses();
  if (tone === "up") return <TrendingUp className={`size-3.5 ${tc.up}`} />;
  if (tone === "down") return <TrendingDown className={`size-3.5 ${tc.down}`} />;
  return <Minus className="size-3.5 text-muted-foreground" />;
}

function formatNum(v: string | null, language: AppLanguage): string {
  if (!v) return "—";
  const n = parseFloat(v);
  if (isNaN(n)) return v;
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + "M";
  return n.toLocaleString(language === "en" ? "en-US" : "zh-CN", { maximumFractionDigits: 4 });
}

function IndexCard({ copy, language, quote }: { copy: MarketDashboardCopy; language: AppLanguage; quote: QuoteItem }) {
  const tone = rateTone(quote.change_rate);
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-lg border bg-card/80 p-3 transition-colors hover:border-primary/40",
        tone === "up" && "border-[var(--color-up)]/30",
        tone === "down" && "border-[var(--color-down)]/30",
        tone === "flat" && "border-border/80",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{quote.name || quote.symbol}</p>
          <p className="truncate text-[11px] text-muted-foreground">{quote.symbol}</p>
        </div>
        <ChangeIndicator rate={quote.change_rate} />
      </div>

      <div className="flex items-end justify-between gap-2">
        <p
          className={cn(
            "text-xl font-bold tabular-nums",
            tone === "up" && "text-[var(--color-up)]",
            tone === "down" && "text-[var(--color-down)]",
          )}
        >
          {formatNum(quote.last_done, language)}
        </p>
        <div className="text-right">
          <p
            className={cn(
              "text-sm font-semibold tabular-nums",
              tone === "up" && "text-[var(--color-up)]",
              tone === "down" && "text-[var(--color-down)]",
              tone === "flat" && "text-muted-foreground",
            )}
          >
            {quote.change_rate ?? "—"}
          </p>
          <p
            className={cn(
              "text-xs tabular-nums",
              tone === "up" && "opacity-80 text-[var(--color-up)]",
              tone === "down" && "opacity-80 text-[var(--color-down)]",
              tone === "flat" && "text-muted-foreground",
            )}
          >
            {quote.change_value ? (tone === "up" ? "+" : "") + formatNum(quote.change_value, language) : "—"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1 border-t border-border/60 pt-2 text-[11px]">
        <div>
          <p className="text-muted-foreground">{copy.open}</p>
          <p className="font-medium tabular-nums">{formatNum(quote.open, language)}</p>
        </div>
        <div className="text-center">
          <p className="text-muted-foreground">{copy.high}</p>
          <p className="font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
            {formatNum(quote.high, language)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-muted-foreground">{copy.low}</p>
          <p className="font-medium tabular-nums text-red-600 dark:text-red-400">
            {formatNum(quote.low, language)}
          </p>
        </div>
      </div>
    </div>
  );
}

type LevelStatus = "idle" | "loading" | "done" | "error";

function StockCard({
  copy,
  language,
  quote,
  onCalculateLevels,
  onSelect,
  levels,
  levelStatus = "idle",
}: {
  copy: MarketDashboardCopy;
  language: AppLanguage;
  quote: QuoteItem;
  onCalculateLevels?: (q: QuoteItem) => void;
  onSelect?: (q: QuoteItem) => void;
  levels?: SupportResistanceLevel[];
  levelStatus?: LevelStatus;
}) {
  const tone = rateTone(quote.change_rate);
  const currentPrice = parseFloat(quote.last_done || "0");
  const nearestSupport = levels?.filter((l) => l.type === "support" && l.price < currentPrice).sort((a, b) => b.price - a.price)[0];
  const nearestResistance = levels?.filter((l) => l.type === "resistance" && l.price > currentPrice).sort((a, b) => a.price - b.price)[0];
  const isCalculating = levelStatus === "loading";

  return (
    <div
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onClick={() => onSelect?.(quote)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect?.(quote); }}
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-md border bg-card/80 p-3 transition-colors hover:border-primary/40",
        onSelect && "cursor-pointer",
        tone === "up" && "border-[var(--color-up)]/25",
        tone === "down" && "border-[var(--color-down)]/25",
        tone === "flat" && "border-border/80",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-semibold">{quote.symbol}</p>
            {quote.category ? (
              <Badge variant="outline" className="h-4 px-1 text-[10px]">
                {quote.category}
              </Badge>
            ) : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">{quote.name || "—"}</p>
        </div>
        <ChangeIndicator rate={quote.change_rate} />
      </div>

      <div className="flex items-baseline justify-between gap-2">
        <p
          className={cn(
            "text-base font-bold tabular-nums",
            tone === "up" && "text-[var(--color-up)]",
            tone === "down" && "text-[var(--color-down)]",
          )}
        >
          {formatNum(quote.last_done, language)}
        </p>
        <p
          className={cn(
            "text-sm font-semibold tabular-nums",
            tone === "up" && "text-[var(--color-up)]",
            tone === "down" && "text-[var(--color-down)]",
            tone === "flat" && "text-muted-foreground",
          )}
        >
          {quote.change_rate ?? "—"}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-1 border-t border-border/60 pt-2 text-[11px]">
        <div>
          <p className="text-muted-foreground">{copy.open}</p>
          <p className="font-medium tabular-nums">{formatNum(quote.open, language)}</p>
        </div>
        <div className="text-center">
          <p className="text-muted-foreground">{copy.high}</p>
          <p className="font-medium tabular-nums">{formatNum(quote.high, language)}</p>
        </div>
        <div className="text-right">
          <p className="text-muted-foreground">{copy.low}</p>
          <p className="font-medium tabular-nums">{formatNum(quote.low, language)}</p>
        </div>
      </div>

      <div className="space-y-2 border-t border-border/60 pt-2 text-[11px]">
        <div className="flex items-center justify-between gap-2">
          <p className="flex min-w-0 items-center gap-1 truncate text-muted-foreground">
            <Target className="size-3" />
            {copy.support} / {copy.resistance}
          </p>
          <Button
            className="h-7 shrink-0 px-2 text-[11px]"
            disabled={isCalculating}
            onClick={(event) => {
              event.stopPropagation();
              onCalculateLevels?.(quote);
            }}
            onKeyDown={(event) => event.stopPropagation()}
            size="sm"
            type="button"
            variant="outline"
          >
            {isCalculating ? <Loader2 className="size-3 animate-spin" /> : <Target className="size-3" />}
            {isCalculating ? copy.calculatingLevels : copy.calculateLevels}
          </Button>
        </div>

        {nearestSupport || nearestResistance ? (
          <div className="grid grid-cols-2 gap-1">
            {nearestSupport ? (
              <div>
                <p className="flex items-center gap-0.5 text-muted-foreground">
                  <Target className="size-2.5" />
                  {copy.support}
                  <span className="text-[9px] opacity-50">S{nearestSupport.strength}</span>
                </p>
                <p className="font-medium tabular-nums text-[var(--color-down)]">{nearestSupport.price.toFixed(2)}</p>
              </div>
            ) : <div />}
            {nearestResistance ? (
              <div className="text-right">
                <p className="flex items-center justify-end gap-0.5 text-muted-foreground">
                  <span className="text-[9px] opacity-50">R{nearestResistance.strength}</span>
                  {copy.resistance}
                  <Target className="size-2.5" />
                </p>
                <p className="font-medium tabular-nums text-[var(--color-up)]">{nearestResistance.price.toFixed(2)}</p>
              </div>
            ) : <div />}
          </div>
        ) : levelStatus === "done" ? (
          <p className="text-muted-foreground">{copy.noLevels}</p>
        ) : levelStatus === "error" ? (
          <p className="text-destructive">{copy.levelsFailed}</p>
        ) : null}
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="grid min-h-40 place-items-center rounded-lg border border-dashed border-border/70 bg-muted/10 text-sm text-muted-foreground">
      {text}
    </div>
  );
}

// ── Index tab ───────────────────────────────────────────────────────────────

function IndexTab({
  copy,
  language,
  refreshSignal,
  refreshInterval,
}: {
  copy: MarketDashboardCopy;
  language: AppLanguage;
  refreshSignal: number;
  refreshInterval: number;
}) {
  const [quotes, setQuotes] = useState<QuoteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await getIndexQuotes();
      setQuotes(res.quotes);
    } catch (e) {
      setError(e instanceof Error ? e.message : copy.loadFailed);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on mount and when refresh signal fires
  useEffect(() => {
    load();
  }, [load, refreshSignal]);

  // Auto-refresh
  useEffect(() => {
    const id = window.setInterval(load, refreshInterval * 1000);
    return () => window.clearInterval(id);
  }, [load, refreshInterval]);

  return (
    <div className="space-y-3">
      {loading && quotes.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {copy.loadingQuotes}
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : quotes.length === 0 ? (
        <EmptyState text={copy.emptyIndices} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {quotes.map((q) => (
            <IndexCard copy={copy} language={language} key={q.symbol} quote={q} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Stock tab ───────────────────────────────────────────────────────────────

function StockTab({
  copy,
  language,
  refreshSignal,
  refreshInterval,
  onSelectStock,
}: {
  copy: MarketDashboardCopy;
  language: AppLanguage;
  refreshSignal: number;
  refreshInterval: number;
  onSelectStock?: (quote: QuoteItem) => void;
}) {
  const [category, setCategory] = useState<WatchlistCategory | "ALL">("ALL");
  const stockCategories = getStockCategories(language);
  const [quotes, setQuotes] = useState<QuoteItem[]>([]);
  const [levelsMap, setLevelsMap] = useState<Record<string, SupportResistanceLevel[]>>({});
  const [levelStatusMap, setLevelStatusMap] = useState<Record<string, LevelStatus>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestSeqRef = useRef(0);

  const calculateLevels = useCallback(async (quote: QuoteItem) => {
    const symbol = quote.symbol;
    setLevelStatusMap((current) => ({ ...current, [symbol]: "loading" }));
    try {
      const candles = await getCandlesticks(symbol, "1D", 60);
      const bars = candles.bars
        .map((c: { timestamp: number; open: string; high: string; low: string; close: string; volume: string }) => ({
          time: c.timestamp,
          open: parseFloat(c.open),
          high: parseFloat(c.high),
          low: parseFloat(c.low),
          close: parseFloat(c.close),
          volume: parseFloat(c.volume ?? "0"),
        }))
        .filter((b: { open: number }) => b.open > 0);
      setLevelsMap((current) => ({ ...current, [symbol]: calcSupportResistance(bars) }));
      setLevelStatusMap((current) => ({ ...current, [symbol]: "done" }));
    } catch {
      setLevelsMap((current) => ({ ...current, [symbol]: [] }));
      setLevelStatusMap((current) => ({ ...current, [symbol]: "error" }));
    }
  }, []);

  const load = useCallback(async () => {
    const requestId = requestSeqRef.current + 1;
    requestSeqRef.current = requestId;
    setLoading(true);
    setError("");
    try {
      const res = await getStockQuotes(category === "ALL" ? undefined : category);
      if (requestSeqRef.current !== requestId) return;
      setQuotes(res.quotes);
      setLevelsMap({});
      setLevelStatusMap({});
      setLoading(false);
    } catch (e) {
      if (requestSeqRef.current !== requestId) return;
      setError(e instanceof Error ? e.message : copy.loadFailed);
    } finally {
      if (requestSeqRef.current === requestId) setLoading(false);
    }
  }, [category, copy.loadFailed]);

  useEffect(() => {
    load();
  }, [load, refreshSignal]);

  useEffect(() => {
    const id = window.setInterval(load, refreshInterval * 1000);
    return () => window.clearInterval(id);
  }, [load, refreshInterval]);

  return (
    <div className="space-y-3">
      {/* Category filter */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-border/80 bg-muted/40 p-1">
          {stockCategories.map((item) => (
            <button
              className={cn(
                "h-7 min-w-16 rounded-sm px-3 text-xs font-medium transition-all",
                category === item.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              key={item.id}
              onClick={() => setCategory(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
        {loading ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : null}
        <Badge variant="outline" className="ml-auto">
          {formatTemplate(copy.symbols, { count: quotes.length })}
        </Badge>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : quotes.length === 0 && !loading ? (
        <EmptyState text={copy.emptyStocks} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {quotes.map((q) => (
            <StockCard
              copy={copy}
              language={language}
              key={q.symbol}
              quote={q}
              onCalculateLevels={calculateLevels}
              onSelect={onSelectStock}
              levels={levelsMap[q.symbol]}
              levelStatus={levelStatusMap[q.symbol]}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function MarketDashboard({
  language,
  onOpenConfig,
  refreshInterval,
  onSelectStock,
}: {
  language: AppLanguage;
  onOpenConfig: () => void;
  refreshInterval: number;
  onSelectStock?: (quote: QuoteItem) => void;
}) {
  const copy = marketDashboardCopy[language];
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [countdown, setCountdown] = useState(refreshInterval);

  // Update last-updated time whenever refreshSignal changes
  useEffect(() => {
    setLastUpdated(
      new Date().toLocaleTimeString(language === "en" ? "en-US" : "zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    );
    setCountdown(refreshInterval);
  }, [refreshSignal, refreshInterval]);

  // Countdown timer
  const countdownRef = useRef<number | null>(null);
  useEffect(() => {
    countdownRef.current = window.setInterval(() => {
      setCountdown((c) => (c <= 1 ? refreshInterval : c - 1));
    }, 1000);
    return () => {
      if (countdownRef.current !== null) window.clearInterval(countdownRef.current);
    };
  }, [refreshInterval]);

  function handleRefresh() {
    setRefreshSignal((s) => s + 1);
  }

  return (
    <section className="panel motion-panel page-enter flex min-h-0 min-w-0 flex-1 flex-col rounded-md lg:h-full">
      <div className="panel-header flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <BarChart2 className="size-5 text-primary" />
            <p className="font-semibold">{copy.title}</p>
          </div>
          <p className="text-xs text-muted-foreground">
            {copy.subtitle}
            {lastUpdated ? ` · ${formatTemplate(copy.updatedAt, { time: lastUpdated })}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
            <Activity className="size-3 animate-pulse text-[var(--color-up)]" />
            {formatTemplate(copy.refreshCountdown, { seconds: countdown })}
          </div>
          <Button
            aria-label={copy.manualRefresh}
            size="sm"
            variant="outline"
            onClick={handleRefresh}
          >
            <RefreshCw />
            {copy.refresh}
          </Button>
          <Button
            aria-label={copy.marketConfig}
            size="sm"
            variant="outline"
            onClick={onOpenConfig}
          >
            <Settings2 />
            {copy.config}
          </Button>
        </div>
      </div>

      <div className="panel-body min-h-0 flex-1 lg:overflow-y-auto">
        <Tabs defaultValue="index">
          <TabsList className="mb-4 grid w-full grid-cols-2 sm:w-72">
            <TabsTrigger value="index" className="gap-1.5">
              <TrendingUp className="size-3.5" />
              {copy.indexTab}
            </TabsTrigger>
            <TabsTrigger value="stocks" className="gap-1.5">
              <ArrowUp className="size-3.5" />
              <ArrowDown className="size-3.5 -ml-2" />
              {copy.stockTab}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="index">
            <IndexTab copy={copy} language={language} refreshSignal={refreshSignal} refreshInterval={refreshInterval} />
          </TabsContent>

          <TabsContent value="stocks">
            <StockTab copy={copy} language={language} refreshSignal={refreshSignal} refreshInterval={refreshInterval} onSelectStock={onSelectStock} />
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
}
