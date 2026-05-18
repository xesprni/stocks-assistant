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
import { getIndexQuotes, getStockQuotes } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useToneClasses } from "@/lib/color-scheme";
import { calcSupportResistance, type SupportResistanceLevel } from "@/lib/indicators";
import type { QuoteItem, WatchlistCategory } from "@/types/app";
import { getCandlesticks } from "@/lib/api";

const stockCategories: Array<{ id: WatchlistCategory | "ALL"; label: string }> = [
  { id: "ALL", label: "全部" },
  { id: "US", label: "美股" },
  { id: "A", label: "A股" },
  { id: "H", label: "H股" },
];

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

function formatNum(v: string | null): string {
  if (!v) return "—";
  const n = parseFloat(v);
  if (isNaN(n)) return v;
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + "M";
  return n.toLocaleString("zh-CN", { maximumFractionDigits: 4 });
}

function IndexCard({ quote }: { quote: QuoteItem }) {
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
          {formatNum(quote.last_done)}
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
            {quote.change_value ? (tone === "up" ? "+" : "") + formatNum(quote.change_value) : "—"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1 border-t border-border/60 pt-2 text-[11px]">
        <div>
          <p className="text-muted-foreground">开盘</p>
          <p className="font-medium tabular-nums">{formatNum(quote.open)}</p>
        </div>
        <div className="text-center">
          <p className="text-muted-foreground">最高</p>
          <p className="font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
            {formatNum(quote.high)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-muted-foreground">最低</p>
          <p className="font-medium tabular-nums text-red-600 dark:text-red-400">
            {formatNum(quote.low)}
          </p>
        </div>
      </div>
    </div>
  );
}

function StockCard({ quote, onSelect, levels }: { quote: QuoteItem; onSelect?: (q: QuoteItem) => void; levels?: SupportResistanceLevel[] }) {
  const tone = rateTone(quote.change_rate);
  const currentPrice = parseFloat(quote.last_done || "0");
  // Show nearest support and resistance
  const nearestSupport = levels?.filter((l) => l.type === "support" && l.price < currentPrice).sort((a, b) => b.price - a.price)[0];
  const nearestResistance = levels?.filter((l) => l.type === "resistance" && l.price > currentPrice).sort((a, b) => a.price - b.price)[0];

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
          {formatNum(quote.last_done)}
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
          <p className="text-muted-foreground">开盘</p>
          <p className="font-medium tabular-nums">{formatNum(quote.open)}</p>
        </div>
        <div className="text-center">
          <p className="text-muted-foreground">最高</p>
          <p className="font-medium tabular-nums">{formatNum(quote.high)}</p>
        </div>
        <div className="text-right">
          <p className="text-muted-foreground">最低</p>
          <p className="font-medium tabular-nums">{formatNum(quote.low)}</p>
        </div>
      </div>

      {/* Support / Resistance */}
      {(nearestSupport || nearestResistance) && (
        <div className="grid grid-cols-2 gap-1 border-t border-border/60 pt-2 text-[11px]">
          {nearestSupport ? (
            <div>
              <p className="text-muted-foreground flex items-center gap-0.5">
                <Target className="size-2.5" />
                支撑
                <span className="text-[9px] opacity-50">S{nearestSupport.strength}</span>
              </p>
              <p className="font-medium tabular-nums text-[var(--color-down)]">{nearestSupport.price.toFixed(2)}</p>
            </div>
          ) : <div />}
          {nearestResistance ? (
            <div className="text-right">
              <p className="text-muted-foreground flex items-center gap-0.5 justify-end">
                <span className="text-[9px] opacity-50">R{nearestResistance.strength}</span>
                阻力
                <Target className="size-2.5" />
              </p>
              <p className="font-medium tabular-nums text-[var(--color-up)]">{nearestResistance.price.toFixed(2)}</p>
            </div>
          ) : <div />}
        </div>
      )}
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
  refreshSignal,
  refreshInterval,
}: {
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
      setError(e instanceof Error ? e.message : "加载失败");
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
          正在拉取行情数据...
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : quotes.length === 0 ? (
        <EmptyState text="暂无指数数据，请在行情配置中添加指数并配置 Longbridge 凭据。" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {quotes.map((q) => (
            <IndexCard key={q.symbol} quote={q} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Stock tab ───────────────────────────────────────────────────────────────

function StockTab({
  refreshSignal,
  refreshInterval,
  onSelectStock,
}: {
  refreshSignal: number;
  refreshInterval: number;
  onSelectStock?: (quote: QuoteItem) => void;
}) {
  const [category, setCategory] = useState<WatchlistCategory | "ALL">("ALL");
  const [quotes, setQuotes] = useState<QuoteItem[]>([]);
  const [levelsMap, setLevelsMap] = useState<Record<string, SupportResistanceLevel[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await getStockQuotes(category === "ALL" ? undefined : category);
      setQuotes(res.quotes);

      // Fetch candlesticks for each stock and compute support/resistance
      const entries = await Promise.allSettled(
        res.quotes.map(async (q) => {
          try {
            const candles = await getCandlesticks(q.symbol, "1D", 60);
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
            return [q.symbol, calcSupportResistance(bars)] as [string, SupportResistanceLevel[]];
          } catch {
            return [q.symbol, [] as SupportResistanceLevel[]] as [string, SupportResistanceLevel[]];
          }
        }),
      );
      const map: Record<string, SupportResistanceLevel[]> = {};
      for (const r of entries) {
        if (r.status === "fulfilled") {
          map[r.value[0]] = r.value[1];
        }
      }
      setLevelsMap(map);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [category]);

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
          {quotes.length} 支
        </Badge>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : quotes.length === 0 && !loading ? (
        <EmptyState text="自选股列表为空，请先在「自选」页面添加股票。" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {quotes.map((q) => (
            <StockCard key={q.symbol} quote={q} onSelect={onSelectStock} levels={levelsMap[q.symbol]} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function MarketDashboard({
  onOpenConfig,
  refreshInterval,
  onSelectStock,
}: {
  onOpenConfig: () => void;
  refreshInterval: number;
  onSelectStock?: (quote: QuoteItem) => void;
}) {
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [countdown, setCountdown] = useState(refreshInterval);

  // Update last-updated time whenever refreshSignal changes
  useEffect(() => {
    setLastUpdated(
      new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
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
    <section className="panel motion-panel page-enter flex h-full min-h-0 min-w-0 flex-1 flex-col rounded-md">
      <div className="panel-header flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <BarChart2 className="size-5 text-primary" />
            <p className="font-semibold">行情监控</p>
          </div>
          <p className="text-xs text-muted-foreground">
            数据来源 Longbridge SDK
            {lastUpdated ? ` · 更新于 ${lastUpdated}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
            <Activity className="size-3 animate-pulse text-[var(--color-up)]" />
            {countdown}s 后刷新
          </div>
          <Button
            aria-label="手动刷新"
            size="sm"
            variant="outline"
            onClick={handleRefresh}
          >
            <RefreshCw />
            刷新
          </Button>
          <Button
            aria-label="行情配置"
            size="sm"
            variant="outline"
            onClick={onOpenConfig}
          >
            <Settings2 />
            配置
          </Button>
        </div>
      </div>

      <div className="panel-body min-h-0 flex-1 overflow-y-auto">
        <Tabs defaultValue="index">
          <TabsList className="mb-4 grid w-full grid-cols-2 sm:w-72">
            <TabsTrigger value="index" className="gap-1.5">
              <TrendingUp className="size-3.5" />
              大盘指数
            </TabsTrigger>
            <TabsTrigger value="stocks" className="gap-1.5">
              <ArrowUp className="size-3.5" />
              <ArrowDown className="size-3.5 -ml-2" />
              个股行情
            </TabsTrigger>
          </TabsList>

          <TabsContent value="index">
            <IndexTab refreshSignal={refreshSignal} refreshInterval={refreshInterval} />
          </TabsContent>

          <TabsContent value="stocks">
            <StockTab refreshSignal={refreshSignal} refreshInterval={refreshInterval} onSelectStock={onSelectStock} />
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
}
