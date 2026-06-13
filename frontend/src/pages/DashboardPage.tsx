import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart2,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  FileText,
  Landmark,
  Loader2,
  Settings2,
  Star,
  Users,
} from "lucide-react";

import { CapitalFlowChart } from "@/components/CapitalFlowChart";
import { MarketPulse } from "@/components/MarketPulse";
import {
  NativeStockChart,
  type NativeChartSeries,
  type NativeChartTheme,
} from "@/components/charts/NativeStockChart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getCandlesticks,
  getDashboard,
  getDashboardMarket,
  getDashboardPortfolio,
  getDashboardSymbolInsights,
  getDashboardWatchlist,
  getIntraday,
} from "@/lib/api";
import { useChartColors } from "@/lib/color-scheme";
import { formatTemplate, i18n, localeFor, type AppLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type {
  CandlestickItem,
  DashboardMarketModule,
  DashboardModuleSource,
  DashboardPortfolioModule,
  DashboardPortfolioMarket,
  DashboardResponse,
  DashboardSymbolInsightSection,
  DashboardSymbolInsightsResponse,
  DashboardWatchlistModule,
  DashboardWatchlistRow,
  DashboardWatchlistView,
  IntradayItem,
  PortfolioMarket,
  QuoteItem,
  WatchlistCategory,
} from "@/types/app";

const WATCHLIST_FILTERS: Array<"ALL" | WatchlistCategory> = ["ALL", "US", "A", "H"];
const WATCHLIST_VIEWS: DashboardWatchlistView[] = ["movers", "gainers", "losers", "active"];
const DASHBOARD_SNAPSHOT_KEY = "stocks_assistant_dashboard_snapshot_v1";
const DASHBOARD_SNAPSHOT_MAX_AGE_MS = 10_000;
const DETAIL_CHART_RANGES = ["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "MAX"] as const;

const EMPTY_MARKET_MODULE: DashboardMarketModule = {
  available: true,
  error: null,
  fetched_at: null,
  stale: false,
  source: "local",
  indices: [],
};

const EMPTY_WATCHLIST_MODULE: DashboardWatchlistModule = {
  available: true,
  error: null,
  fetched_at: null,
  stale: false,
  source: "local",
  items: [],
  views: { movers: [], gainers: [], losers: [], active: [] },
  counts_by_category: { US: 0, A: 0, H: 0 },
  total: 0,
  quote_error: null,
};

const EMPTY_PORTFOLIO_MODULE: DashboardPortfolioModule = {
  available: true,
  error: null,
  fetched_at: null,
  stale: false,
  source: "local",
  markets: [],
};

const EMPTY_DASHBOARD: DashboardResponse = {
  market: EMPTY_MARKET_MODULE,
  watchlist: EMPTY_WATCHLIST_MODULE,
  portfolio: EMPTY_PORTFOLIO_MODULE,
};

type SymbolRow = DashboardWatchlistRow;
type Tone = "up" | "down" | "flat";
type DashboardModuleKey = "market" | "watchlist" | "portfolio";
type DetailChartRange = (typeof DETAIL_CHART_RANGES)[number];
const DASHBOARD_MODULE_KEYS: DashboardModuleKey[] = ["market", "watchlist", "portfolio"];

type ModuleStatus = {
  loading: boolean;
  refreshing: boolean;
  error: string;
  lastUpdated: string;
  stale: boolean;
  source: DashboardModuleSource | null;
};

type DashboardSnapshot = {
  savedAt: number;
  data: DashboardResponse;
};

type DashboardPageProps = {
  canPermission: (permission: string) => boolean;
  chatExpanded: boolean;
  chatPanel: ReactNode;
  isMobileViewport: boolean;
  language: AppLanguage;
  onOpenChart: (symbol: string) => void;
  onOpenMarketConfig: () => void;
  onOpenPortfolio: () => void;
  onOpenWatchlist: () => void;
  refreshInterval: number;
};

function parseNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumeric(value: string | null | undefined, language: AppLanguage, maximumFractionDigits = 2): string {
  const parsed = parseNumber(value);
  if (parsed === null) return value || "-";
  return parsed.toLocaleString(localeFor(language), { maximumFractionDigits });
}

function formatCompactNumeric(value: string | null | undefined, language: AppLanguage): string {
  const parsed = parseNumber(value);
  if (parsed === null) return value || "-";
  return parsed.toLocaleString(localeFor(language), { maximumFractionDigits: 1, notation: "compact" });
}

function formatPercent(value: string | null | undefined, language: AppLanguage): string {
  if (!value) return "-";
  if (value.includes("%")) return value;
  const parsed = parseNumber(value);
  if (parsed === null) return value;
  return `${parsed.toLocaleString(localeFor(language), { maximumFractionDigits: 2 })}%`;
}

function rateTone(rate: string | null | undefined): Tone {
  const parsed = parseNumber(rate);
  if (parsed === null || parsed === 0) return "flat";
  return parsed > 0 ? "up" : "down";
}

function toneClass(tone: Tone) {
  if (tone === "up") return "text-[var(--color-up)]";
  if (tone === "down") return "text-[var(--color-down)]";
  return "text-muted-foreground";
}

function signedChange(value: string | null | undefined, tone: Tone, language: AppLanguage): string {
  if (!value) return "-";
  const formatted = formatNumeric(value, language);
  if (tone === "up" && !formatted.startsWith("+")) return `+${formatted}`;
  return formatted;
}

function marketLabel(market: PortfolioMarket, language: AppLanguage) {
  if (market === "US") return language === "en" ? "US" : "美股";
  return language === "en" ? "A-share" : "A股";
}

function categoryLabel(category: WatchlistCategory, language: AppLanguage) {
  if (category === "US") return language === "en" ? "US" : "美股";
  if (category === "A") return language === "en" ? "A-share" : "A股";
  return language === "en" ? "HK" : "港股";
}

function watchlistFilterLabel(filter: "ALL" | WatchlistCategory, language: AppLanguage) {
  if (filter === "ALL") return language === "en" ? "All" : "全部";
  return categoryLabel(filter, language);
}

function watchlistViewLabel(view: DashboardWatchlistView, language: AppLanguage) {
  const labels = language === "en"
    ? { movers: "Movers", gainers: "Gainers", losers: "Losers", active: "Active" }
    : { movers: "异动", gainers: "领涨", losers: "领跌", active: "活跃" };
  return labels[view];
}

function chunkRows<T>(rows: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    pages.push(rows.slice(index, index + size));
  }
  return pages;
}

function readDashboardSnapshot(): DashboardResponse | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(DASHBOARD_SNAPSHOT_KEY);
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as DashboardSnapshot;
    if (!snapshot?.data || Date.now() - snapshot.savedAt > DASHBOARD_SNAPSHOT_MAX_AGE_MS) return null;
    return snapshot.data;
  } catch {
    return null;
  }
}

function writeDashboardSnapshot(data: DashboardResponse) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(DASHBOARD_SNAPSHOT_KEY, JSON.stringify({ savedAt: Date.now(), data }));
  } catch {
    // Snapshot cache is only a render accelerator; quota failures can be ignored.
  }
}

function moduleStatusFromModule(
  module: { error?: string | null; fetched_at?: string | null; stale?: boolean; source?: DashboardModuleSource | null } | null | undefined,
  loading = false,
): ModuleStatus {
  return {
    loading,
    refreshing: false,
    error: module?.error || "",
    lastUpdated: module?.fetched_at || "",
    stale: Boolean(module?.stale),
    source: module?.source ?? null,
  };
}

function initialModuleStatuses(snapshot: DashboardResponse | null): Record<DashboardModuleKey, ModuleStatus> {
  const loading = !snapshot;
  return {
    market: moduleStatusFromModule(snapshot?.market, loading),
    watchlist: moduleStatusFromModule(snapshot?.watchlist, loading),
    portfolio: moduleStatusFromModule(snapshot?.portfolio, loading),
  };
}

function mergeDashboard(prev: DashboardResponse | null, patch: Partial<DashboardResponse>): DashboardResponse {
  return {
    market: patch.market ?? prev?.market ?? EMPTY_DASHBOARD.market,
    watchlist: patch.watchlist ?? prev?.watchlist ?? EMPTY_DASHBOARD.watchlist,
    portfolio: patch.portfolio ?? prev?.portfolio ?? EMPTY_DASHBOARD.portfolio,
  };
}

function dashboardHasModuleData(data: DashboardResponse | null, key: DashboardModuleKey): boolean {
  if (!data) return false;
  if (key === "market") return data.market.indices.length > 0;
  if (key === "watchlist") return data.watchlist.total > 0 || data.watchlist.items.length > 0;
  return data.portfolio.markets.length > 0;
}

function formatModuleTime(value: string, language: AppLanguage): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(localeFor(language), { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function moduleStatusLabel(status: ModuleStatus, language: AppLanguage): string {
  const sourceLabels: Record<DashboardModuleSource, string> = language === "en"
    ? { local: "local", cache: "cached", live: "live" }
    : { local: "本地", cache: "缓存", live: "实时" };
  const parts: string[] = [];
  if (status.refreshing) parts.push(language === "en" ? "refreshing" : "刷新中");
  const updatedAt = formatModuleTime(status.lastUpdated, language);
  if (updatedAt) parts.push(updatedAt);
  if (status.source) parts.push(sourceLabels[status.source]);
  if (status.stale) parts.push(language === "en" ? "stale" : "可能过期");
  return parts.join(" · ");
}

function sectionSubtitle(base: string, status: ModuleStatus, language: AppLanguage): string {
  const meta = moduleStatusLabel(status, language);
  return meta ? `${base} · ${meta}` : base;
}

function FinanceSection({
  action,
  children,
  className,
  icon,
  subtitle,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
  subtitle?: string;
  title: string;
}) {
  return (
    <section className={cn("finance-section min-w-0", className)}>
      <div className="mb-3 flex min-w-0 items-end justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {icon ? <span className="shrink-0 text-muted-foreground [&_svg]:size-4">{icon}</span> : null}
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{title}</p>
            {subtitle ? <p className="truncate text-xs text-muted-foreground">{subtitle}</p> : null}
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

function InlineState({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center gap-2 rounded-md bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
      {icon}
      <span>{children}</span>
    </div>
  );
}

function QuoteRow({
  language,
  onOpenChart,
  onSelect,
  row,
  selected = false,
}: {
  language: AppLanguage;
  onOpenChart?: (symbol: string) => void;
  onSelect?: (symbol: string) => void;
  row: SymbolRow;
  selected?: boolean;
}) {
  const tone = rateTone(row.change_rate);
  const Icon = tone === "down" ? ArrowDownRight : tone === "up" ? ArrowUpRight : Activity;
  const chartLabel = language === "en" ? `Open chart ${row.symbol}` : `打开图表 ${row.symbol}`;
  const highLowLabel = language === "en" ? "H/L" : "高/低";
  const turnoverLabel = language === "en" ? "Turnover" : "成交额";
  const volumeLabel = language === "en" ? "Vol" : "成交量";
  const rangeMeta = row.high || row.low ? `${highLowLabel} ${formatCompactNumeric(row.high, language)} / ${formatCompactNumeric(row.low, language)}` : "";
  const activityMeta = row.turnover
    ? `${turnoverLabel} ${formatCompactNumeric(row.turnover, language)}`
    : row.volume
      ? `${volumeLabel} ${formatCompactNumeric(row.volume, language)}`
      : "";
  const meta = [rangeMeta, activityMeta].filter(Boolean).join(" · ");
  return (
    <div
      className={cn(
        "dashboard-quote-row group grid w-full min-w-0 select-none grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-transparent transition-colors",
      )}
      data-selected={selected ? "true" : undefined}
    >
      <button
        aria-pressed={selected}
        className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-1 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 sm:px-2"
        onClick={() => onSelect?.(row.symbol)}
        type="button"
      >
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-semibold">{row.symbol}</p>
            {row.category ? <Badge className="h-5 px-1.5 text-[10px]" variant="outline">{row.category}</Badge> : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">{row.name || "-"}</p>
          {meta ? <p className="mt-0.5 truncate text-[11px] text-muted-foreground/85">{meta}</p> : null}
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold tabular-nums">{formatNumeric(row.last_done, language, 3)}</p>
          <div className={cn("mt-0.5 flex items-center justify-end gap-1 text-xs font-semibold tabular-nums", toneClass(tone))}>
            <Icon className="size-3.5" />
            <span>{formatPercent(row.change_rate, language)}</span>
          </div>
        </div>
      </button>
      {onOpenChart ? (
        <Button
          aria-label={chartLabel}
          className="mr-1 h-8 w-8 shrink-0 text-muted-foreground hover:text-primary"
          onClick={() => onOpenChart(row.symbol)}
          size="icon"
          title={chartLabel}
          type="button"
          variant="ghost"
        >
          <BarChart2 className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}

function MarketPill({ language, quote }: { language: AppLanguage; quote: QuoteItem }) {
  const tone = rateTone(quote.change_rate);
  return (
    <div className="finance-index-item min-w-[168px] px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{quote.name || quote.symbol}</p>
          <p className="truncate text-[11px] text-muted-foreground">{quote.symbol}</p>
        </div>
        <p className={cn("text-xs font-semibold tabular-nums", toneClass(tone))}>{formatPercent(quote.change_rate, language)}</p>
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <p className="text-lg font-semibold tabular-nums">{formatNumeric(quote.last_done, language, 3)}</p>
        <p className={cn("text-xs tabular-nums", toneClass(tone))}>{signedChange(quote.change_value, tone, language)}</p>
      </div>
    </div>
  );
}

type ParsedDetailChartBar = {
  time: number;
  price: number;
  volume: number;
  open?: number;
};

function detailRangeLabel(range: DetailChartRange, language: AppLanguage) {
  const labels: Record<DetailChartRange, string> = language === "en"
    ? { "1D": "1D", "5D": "5D", "1M": "1M", "6M": "6M", YTD: "YTD", "1Y": "1Y", "5Y": "5Y", MAX: "Max" }
    : { "1D": "1天", "5D": "5天", "1M": "1个月", "6M": "6个月", YTD: "年初至今", "1Y": "1年", "5Y": "5年", MAX: "最大" };
  return labels[range];
}

function ytdDailyCount() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const elapsedDays = Math.ceil((now.getTime() - start.getTime()) / 86_400_000) + 5;
  return Math.min(260, Math.max(30, elapsedDays));
}

function detailChartRequest(range: DetailChartRange): { kind: "intraday" } | { kind: "candlestick"; period: "1D" | "1W" | "1M"; count: number } {
  if (range === "1D") return { kind: "intraday" };
  if (range === "5D") return { kind: "candlestick", period: "1D", count: 5 };
  if (range === "1M") return { kind: "candlestick", period: "1D", count: 30 };
  if (range === "6M") return { kind: "candlestick", period: "1D", count: 126 };
  if (range === "YTD") return { kind: "candlestick", period: "1D", count: ytdDailyCount() };
  if (range === "1Y") return { kind: "candlestick", period: "1D", count: 252 };
  if (range === "5Y") return { kind: "candlestick", period: "1W", count: 260 };
  return { kind: "candlestick", period: "1M", count: 600 };
}

function cssHsl(styles: CSSStyleDeclaration, name: string, alpha?: number) {
  const value = styles.getPropertyValue(name).trim();
  if (!value) return alpha == null ? "transparent" : `rgb(0 0 0 / ${alpha})`;
  return alpha == null ? `hsl(${value})` : `hsl(${value} / ${alpha})`;
}

function useIsDarkTheme() {
  const [isDark, setIsDark] = useState(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );

  useEffect(() => {
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") return undefined;
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, { attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

function useDashboardChartTheme(): NativeChartTheme {
  const isDark = useIsDarkTheme();
  const { upColor, downColor } = useChartColors();

  return useMemo(() => {
    if (typeof window === "undefined") {
      return {
        background: "transparent",
        text: "#e8eaed",
        mutedText: "#a6adb7",
        border: "rgb(255 255 255 / 0.14)",
        grid: "rgb(255 255 255 / 0.08)",
        crosshair: "rgb(255 255 255 / 0.5)",
        axisBackground: "rgb(0 0 0 / 0.9)",
        up: upColor,
        down: downColor,
        blue: "#8ab4f8",
        orange: "#fdd663",
        purple: "#c58af9",
        yellow: "#fdd663",
      };
    }

    const styles = window.getComputedStyle(document.documentElement);
    return {
      background: cssHsl(styles, "--card", isDark ? 0.42 : 0.58),
      text: cssHsl(styles, "--foreground"),
      mutedText: cssHsl(styles, "--muted-foreground"),
      border: cssHsl(styles, "--border", isDark ? 0.62 : 0.72),
      grid: styles.getPropertyValue("--grid-line").trim() || cssHsl(styles, "--border", isDark ? 0.24 : 0.32),
      crosshair: cssHsl(styles, "--muted-foreground", isDark ? 0.72 : 0.62),
      axisBackground: cssHsl(styles, "--background", isDark ? 0.94 : 0.9),
      up: upColor,
      down: downColor,
      blue: cssHsl(styles, "--primary"),
      orange: cssHsl(styles, "--secondary"),
      purple: isDark ? "#c58af9" : "#7e57c2",
      yellow: isDark ? "#fdd663" : "#b7791f",
    };
  }, [isDark, upColor, downColor]);
}

function colorWithAlpha(color: string, alpha: number) {
  const hex = color.trim();
  const normalized = hex.length === 4
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex;
  const match = /^#([0-9a-f]{6})$/i.exec(normalized);
  if (!match) return color;
  const value = Number.parseInt(match[1], 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgb(${r} ${g} ${b} / ${alpha})`;
}

function parseDetailIntradayBars(bars: IntradayItem[]): ParsedDetailChartBar[] {
  return bars
    .map((bar): ParsedDetailChartBar | null => {
      const price = parseNumber(bar.price);
      if (price === null) return null;
      return {
        time: bar.timestamp,
        price,
        volume: parseNumber(bar.volume) ?? 0,
      };
    })
    .filter((bar): bar is ParsedDetailChartBar => bar !== null)
    .sort((a, b) => a.time - b.time);
}

function parseDetailCandlestickBars(bars: CandlestickItem[]): ParsedDetailChartBar[] {
  return bars
    .map((bar): ParsedDetailChartBar | null => {
      const price = parseNumber(bar.close);
      if (price === null) return null;
      return {
        time: bar.timestamp,
        price,
        volume: parseNumber(bar.volume) ?? 0,
        open: parseNumber(bar.open) ?? price,
      };
    })
    .filter((bar): bar is ParsedDetailChartBar => bar !== null)
    .sort((a, b) => a.time - b.time);
}

function formatNumberValue(value: number | null | undefined, language: AppLanguage, maximumFractionDigits = 2) {
  if (value == null || !Number.isFinite(value)) return "-";
  return value.toLocaleString(localeFor(language), { maximumFractionDigits });
}

function formatSignedPercentValue(value: number | null | undefined, language: AppLanguage) {
  if (value == null || !Number.isFinite(value)) return "-";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const absolute = Math.abs(value).toLocaleString(localeFor(language), { maximumFractionDigits: 2 });
  return `${sign}${absolute}%`;
}

function chartChangePercent(bars: ParsedDetailChartBar[], row: DashboardWatchlistRow, range: DetailChartRange) {
  const rowRate = range === "1D" ? parseNumber(row.change_rate) : null;
  if (rowRate !== null) return rowRate;
  const first = bars[0]?.price;
  const latest = bars[bars.length - 1]?.price;
  if (!first || latest == null) return null;
  return ((latest - first) / first) * 100;
}

function WatchlistSymbolChart({ language, row }: { language: AppLanguage; row: DashboardWatchlistRow }) {
  const [range, setRange] = useState<DetailChartRange>("1D");
  const [bars, setBars] = useState<ParsedDetailChartBar[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const theme = useDashboardChartTheme();
  const labels = language === "en"
    ? { price: "Price", volume: "Volume", prevClose: "Prev", loading: "Loading chart", empty: "No chart data" }
    : { price: "价格", volume: "成交量", prevClose: "昨收", loading: "加载图表中", empty: "暂无图表数据" };

  useEffect(() => {
    let cancelled = false;
    const request = detailChartRequest(range);
    setLoading(true);
    setError("");
    setBars([]);

    const loader = request.kind === "intraday"
      ? getIntraday(row.symbol).then((response) => parseDetailIntradayBars(response.bars))
      : getCandlesticks(row.symbol, request.period, request.count).then((response) => parseDetailCandlestickBars(response.bars));

    loader
      .then((nextBars) => {
        if (cancelled) return;
        setBars(nextBars);
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : labels.empty);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [labels.empty, range, row.symbol]);

  const changePercent = chartChangePercent(bars, row, range);
  const tone: Tone = changePercent == null || changePercent === 0 ? "flat" : changePercent > 0 ? "up" : "down";
  const latest = bars[bars.length - 1];
  const displayPrice = latest?.price ?? parseNumber(row.last_done);
  const displayVolume = parseNumber(row.volume) ?? latest?.volume ?? null;
  const times = useMemo(() => bars.map((bar) => bar.time), [bars]);
  const panes = useMemo(() => [
    { id: "price", label: labels.price.toUpperCase(), heightWeight: 3 },
    { id: "volume", label: "VOL", heightWeight: 0.72 },
  ], [labels.price]);
  const series = useMemo<NativeChartSeries[]>(() => {
    if (bars.length === 0) return [];
    const lineColor = tone === "up" ? theme.up : tone === "down" ? theme.down : theme.blue;
    const next: NativeChartSeries[] = [];
    const prevClose = parseNumber(row.prev_close);
    if (prevClose !== null) {
      next.push({
        id: "prev-close",
        paneId: "price",
        type: "line",
        title: labels.prevClose,
        color: theme.mutedText,
        lineWidth: 1,
        dashed: true,
        data: bars.map((bar) => ({ time: bar.time, value: prevClose })),
      });
    }
    next.push(
      {
        id: "price",
        paneId: "price",
        type: "line",
        title: labels.price,
        color: lineColor,
        lineWidth: 2,
        data: bars.map((bar) => ({ time: bar.time, value: bar.price })),
      },
      {
        id: "volume",
        paneId: "volume",
        type: "histogram",
        title: "VOL",
        data: bars.map((bar, index) => {
          const previous = index > 0 ? bars[index - 1].price : bar.open ?? bar.price;
          return {
            time: bar.time,
            value: bar.volume,
            color: colorWithAlpha(bar.price >= previous ? theme.up : theme.down, 0.48),
          };
        }),
      },
    );
    return next;
  }, [bars, labels.prevClose, labels.price, row.prev_close, theme, tone]);

  return (
    <div className="overflow-hidden rounded-md border border-border/65 bg-card/70">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border/65 bg-background/55 px-2.5 py-1.5 text-sm tabular-nums">
          <span className="text-muted-foreground">{labels.price}：</span>
          <span className={cn("font-semibold", toneClass(tone))}>
            {formatNumberValue(displayPrice, language, 3)} ({formatSignedPercentValue(changePercent, language)})
          </span>
          <span className="text-muted-foreground">{labels.volume}：</span>
          <span className="font-medium text-foreground">{formatCompactNumeric(displayVolume == null ? null : String(displayVolume), language)}</span>
        </div>
        {loading && bars.length > 0 ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            {labels.loading}
          </span>
        ) : null}
      </div>

      <div className="h-[260px] border-t border-border/45">
        {loading && bars.length === 0 ? (
          <div className="flex h-full items-center justify-center p-3">
            <InlineState icon={<Loader2 className="size-4 animate-spin" />}>{labels.loading}</InlineState>
          </div>
        ) : error && bars.length === 0 ? (
          <div className="flex h-full items-center justify-center p-3">
            <InlineState>{error}</InlineState>
          </div>
        ) : bars.length === 0 ? (
          <div className="flex h-full items-center justify-center p-3">
            <InlineState>{labels.empty}</InlineState>
          </div>
        ) : (
          <NativeStockChart
            className="h-full w-full"
            fitKey={`${row.symbol}:${range}:${bars.length}`}
            panes={panes}
            primaryRangeSeriesId="price"
            series={series}
            theme={theme}
            times={times}
          />
        )}
      </div>

      <div className="grid grid-cols-4 gap-1 border-t border-border/45 bg-background/30 p-2 sm:grid-cols-8">
        {DETAIL_CHART_RANGES.map((item) => (
          <button
            className={cn(
              "h-9 rounded-md px-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground",
              range === item && "bg-muted text-foreground shadow-sm",
            )}
            key={item}
            onClick={() => setRange(item)}
            type="button"
          >
            {detailRangeLabel(item, language)}
          </button>
        ))}
      </div>
    </div>
  );
}

function MarketSnapshot({
  error,
  indices,
  language,
  loading,
  onOpenMarketConfig,
  subtitle,
}: {
  error: string;
  indices: QuoteItem[];
  language: AppLanguage;
  loading: boolean;
  onOpenMarketConfig: () => void;
  subtitle?: string;
}) {
  const copy = i18n[language].overview;
  return (
    <FinanceSection
      action={<Button size="sm" variant="ghost" onClick={onOpenMarketConfig}>{copy.config}<Settings2 /></Button>}
      icon={<BarChart2 />}
      subtitle={subtitle ?? copy.marketSnapshotSubtitle}
      title={copy.marketSnapshot}
    >
      {loading && indices.length === 0 ? (
        <InlineState icon={<Loader2 className="size-4 animate-spin" />}>{copy.loadingMarket}</InlineState>
      ) : error && indices.length === 0 ? (
        <InlineState>{error}</InlineState>
      ) : indices.length === 0 ? (
        <InlineState>{copy.emptyMarket}</InlineState>
      ) : (
        <div className="space-y-2">
          {error ? <InlineState>{error}</InlineState> : null}
          <div className="finance-index-strip -mx-2 flex overflow-x-auto sm:mx-0">
            {indices.slice(0, 8).map((quote) => (
              <MarketPill language={language} key={quote.symbol} quote={quote} />
            ))}
          </div>
        </div>
      )}
    </FinanceSection>
  );
}

function WatchlistMovers({
  error,
  language,
  loading,
  module,
  onOpenChart,
  onOpenWatchlist,
  onSelectSymbol,
  selectedSymbol,
  subtitle,
}: {
  error: string;
  language: AppLanguage;
  loading: boolean;
  module: DashboardWatchlistModule | null | undefined;
  onOpenChart?: (symbol: string) => void;
  onOpenWatchlist: () => void;
  onSelectSymbol: (symbol: string) => void;
  selectedSymbol: string;
  subtitle?: string;
}) {
  const copy = i18n[language].overview;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<DashboardWatchlistView>("movers");
  const [filter, setFilter] = useState<"ALL" | WatchlistCategory>("ALL");
  const [page, setPage] = useState(0);
  const [itemsPerPage, setItemsPerPage] = useState(() => (typeof window === "undefined" || window.innerWidth >= 768 ? 8 : 6));
  const rows = useMemo(() => {
    const source = module?.views?.[view] ?? [];
    if (filter === "ALL") return source;
    return source.filter((row) => row.category === filter);
  }, [filter, module?.views, view]);
  const pages = useMemo(() => chunkRows(rows, itemsPerPage), [itemsPerPage, rows]);
  const pageCount = pages.length;
  const total = module?.total ?? 0;
  const moduleError = module?.error || error;
  const previousLabel = language === "en" ? "Previous watchlist page" : "上一页自选";
  const nextLabel = language === "en" ? "Next watchlist page" : "下一页自选";
  const pageLabel = language === "en" ? `${Math.min(page + 1, pageCount || 1)} / ${pageCount || 1}` : `${Math.min(page + 1, pageCount || 1)} / ${pageCount || 1}`;

  useEffect(() => {
    function updatePageSize() {
      setItemsPerPage(window.innerWidth >= 768 ? 8 : 6);
    }
    updatePageSize();
    window.addEventListener("resize", updatePageSize);
    return () => window.removeEventListener("resize", updatePageSize);
  }, []);

  useEffect(() => {
    setPage(0);
    scrollRef.current?.scrollTo({ left: 0 });
  }, [filter, itemsPerPage, view]);

  useEffect(() => {
    if (page >= pageCount && pageCount > 0) {
      setPage(pageCount - 1);
    }
  }, [page, pageCount]);

  function scrollToPage(nextPage: number) {
    const bounded = Math.max(0, Math.min(pageCount - 1, nextPage));
    setPage(bounded);
    const node = scrollRef.current;
    if (node) node.scrollTo({ left: bounded * node.clientWidth, behavior: "smooth" });
  }

  function handleScroll() {
    const node = scrollRef.current;
    if (!node || node.clientWidth === 0) return;
    const nextPage = Math.round(node.scrollLeft / node.clientWidth);
    if (nextPage !== page) setPage(Math.max(0, Math.min(pageCount - 1, nextPage)));
  }

  return (
    <FinanceSection
      action={<Button size="sm" variant="ghost" onClick={onOpenWatchlist}>{copy.viewWatchlist}<ArrowRight /></Button>}
      icon={<Star />}
      subtitle={subtitle ?? copy.watchlistMoversSubtitle}
      title={copy.watchlistMovers}
    >
      {loading && total === 0 ? (
        <InlineState icon={<Loader2 className="size-4 animate-spin" />}>{copy.loadingMarket}</InlineState>
      ) : moduleError && total === 0 ? (
        <InlineState>{moduleError}</InlineState>
      ) : total === 0 ? (
        <InlineState>{copy.emptyMovers}</InlineState>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex max-w-full gap-1 overflow-x-auto rounded-full bg-muted/40 p-0.5">
              {WATCHLIST_VIEWS.map((item) => (
                <button
                  aria-pressed={view === item}
                  className={cn(
                    "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors",
                    view === item ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                  key={item}
                  onClick={() => setView(item)}
                  type="button"
                >
                  {watchlistViewLabel(item, language)}
                </button>
              ))}
            </div>
            <Badge className="border-transparent bg-muted/35 shadow-none" variant="outline">{total}</Badge>
          </div>
          <div className="flex gap-1 overflow-x-auto pb-0.5">
            {WATCHLIST_FILTERS.map((item) => (
              <button
                aria-pressed={filter === item}
                className={cn(
                  "shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors",
                  filter === item
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border/70 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
                key={item}
                onClick={() => setFilter(item)}
                type="button"
              >
                {watchlistFilterLabel(item, language)}
                <span className="ml-1 text-muted-foreground">
                  {item === "ALL" ? total : (module?.counts_by_category?.[item] ?? 0)}
                </span>
              </button>
            ))}
          </div>
          {moduleError ? <InlineState>{moduleError}</InlineState> : null}
          {module?.quote_error ? <InlineState>{module.quote_error}</InlineState> : null}
          {rows.length === 0 ? (
            <InlineState>{copy.emptyMovers}</InlineState>
          ) : (
            <div className="relative">
              {pageCount > 1 ? (
                <>
                  <Button
                    aria-label={previousLabel}
                    className="absolute -left-2 top-1/2 z-10 h-8 w-8 -translate-y-1/2 rounded-full bg-card/95 shadow-md"
                    disabled={page <= 0}
                    onClick={() => scrollToPage(page - 1)}
                    size="icon"
                    type="button"
                    variant="outline"
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <Button
                    aria-label={nextLabel}
                    className="absolute -right-2 top-1/2 z-10 h-8 w-8 -translate-y-1/2 rounded-full bg-card/95 shadow-md"
                    disabled={page >= pageCount - 1}
                    onClick={() => scrollToPage(page + 1)}
                    size="icon"
                    type="button"
                    variant="outline"
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </>
              ) : null}
              <div
                className="finance-swipe-pages flex snap-x snap-mandatory overflow-x-auto scroll-smooth"
                onScroll={handleScroll}
                ref={scrollRef}
              >
                {pages.map((pageRows, pageIndex) => (
                  <div className="min-w-full snap-start pr-1" key={pageIndex}>
                    <div className="divide-y divide-border/55 border-y border-border/55">
                      {pageRows.map((row) => (
                        <QuoteRow
                          language={language}
                          key={`${row.category}-${row.symbol}`}
                          onOpenChart={onOpenChart}
                          onSelect={onSelectSymbol}
                          row={row}
                          selected={row.symbol === selectedSymbol}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {pageCount > 1 ? (
            <div className="flex items-center justify-center gap-2">
              <span className="text-[11px] font-semibold text-muted-foreground">{pageLabel}</span>
              <div className="flex gap-1">
                {pages.map((_, index) => (
                  <button
                    aria-label={`${index + 1}`}
                    className={cn("h-1.5 rounded-full transition-all", page === index ? "w-5 bg-primary" : "w-1.5 bg-muted-foreground/35")}
                    key={index}
                    onClick={() => scrollToPage(index)}
                    type="button"
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </FinanceSection>
  );
}

function PortfolioSummary({
  error,
  language,
  loading,
  module,
  onOpenPortfolio,
  subtitle,
}: {
  error: string;
  language: AppLanguage;
  loading: boolean;
  module: DashboardPortfolioModule | null | undefined;
  onOpenPortfolio: () => void;
  subtitle?: string;
}) {
  const copy = i18n[language].overview;
  const markets = module?.markets ?? [];
  const moduleError = module?.error || error;

  return (
    <FinanceSection
      action={<Button size="sm" variant="ghost" onClick={onOpenPortfolio}>{copy.viewPortfolio}<ArrowRight /></Button>}
      icon={<BriefcaseBusiness />}
      subtitle={subtitle ?? copy.portfolioSubtitle}
      title={copy.portfolioTitle}
    >
      {loading && markets.length === 0 ? (
        <InlineState icon={<Loader2 className="size-4 animate-spin" />}>{copy.loadingPortfolio}</InlineState>
      ) : moduleError && markets.length === 0 ? (
        <InlineState>{moduleError}</InlineState>
      ) : markets.length === 0 ? (
        <InlineState>{copy.emptyPortfolio}</InlineState>
      ) : (
        <div className="space-y-4">
          {moduleError ? <InlineState>{moduleError}</InlineState> : null}
          <div className="grid divide-y divide-border/55 border-y border-border/55 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            {markets.map((market) => (
              <PortfolioMarketSummary key={market.market} language={language} market={market} />
            ))}
          </div>
          {markets.some((market) => market.quote_error) ? (
            <InlineState>{markets.map((market) => market.quote_error).filter(Boolean).join(" · ")}</InlineState>
          ) : null}
        </div>
      )}
    </FinanceSection>
  );
}

function PortfolioMarketSummary({ language, market }: { language: AppLanguage; market: DashboardPortfolioMarket }) {
  const copy = i18n[language].overview;
  const labels = language === "en"
    ? { marketValue: "Market value", cost: "Cost", day: "Day", pnl: "Unrealized P&L", cash: "Cash" }
    : { marketValue: "持仓市值", cost: "成本", day: "日涨跌", pnl: "未实现盈亏", cash: "现金" };
  const dayTone = rateTone(market.day_change_rate || market.day_change_value);
  const pnlTone = rateTone(market.unrealized_pnl_value);
  return (
    <div className="min-w-0 px-1 py-3 sm:px-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold">{marketLabel(market.market, language)}</p>
        <Badge className="border-transparent bg-muted/35 shadow-none" variant="outline">
          {formatTemplate(copy.positionsCount, { count: market.position_count })}
        </Badge>
      </div>
      <p className="text-lg font-semibold tabular-nums">{formatNumeric(market.total_assets, language)}</p>
      <div className="mt-2 grid gap-1 text-xs">
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">{labels.day}</span>
          <span className={cn("font-semibold tabular-nums", toneClass(dayTone))}>
            {signedChange(market.day_change_value, dayTone, language)}
            {market.day_change_rate ? ` (${formatPercent(market.day_change_rate, language)})` : ""}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">{labels.pnl}</span>
          <span className={cn("font-semibold tabular-nums", toneClass(pnlTone))}>
            {signedChange(market.unrealized_pnl_value, pnlTone, language)}
            {market.unrealized_pnl_ratio ? ` (${formatPercent(market.unrealized_pnl_ratio, language)})` : ""}
          </span>
        </div>
        <div className="flex justify-between gap-2 text-muted-foreground">
          <span>{labels.marketValue}</span>
          <span className="tabular-nums">{formatNumeric(market.market_value, language)}</span>
        </div>
        <div className="flex justify-between gap-2 text-muted-foreground">
          <span>{labels.cash}</span>
          <span className="tabular-nums">
            {formatNumeric(market.cash_amount, language)} {market.cash_ratio ? `(${formatPercent(market.cash_ratio, language)})` : ""}
          </span>
        </div>
        <div className="flex justify-between gap-2 text-muted-foreground">
          <span>{labels.cost}</span>
          <span className="tabular-nums">{formatNumeric(market.cost_value, language)}</span>
        </div>
      </div>
    </div>
  );
}

function SymbolDetailMetric({ label, tone, value }: { label: string; tone?: Tone; value: string }) {
  return (
    <div className="min-w-0 rounded-md bg-muted/25 px-3 py-2">
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("mt-1 truncate text-sm font-semibold tabular-nums", tone ? toneClass(tone) : undefined)}>{value}</p>
    </div>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasInsightValue(value: unknown): boolean {
  if (value == null || value === "") return false;
  if (Array.isArray(value)) return value.some(hasInsightValue);
  if (isRecord(value)) return Object.values(value).some(hasInsightValue);
  return true;
}

function displayInsightValue(value: unknown, language: AppLanguage): string {
  if (value == null || value === "") return "";
  if (typeof value === "boolean") return value ? (language === "en" ? "Yes" : "是") : (language === "en" ? "No" : "否");
  if (typeof value === "number") return value.toLocaleString(localeFor(language), { maximumFractionDigits: 4 });
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => displayInsightValue(item, language)).filter(Boolean).join(" · ");
  if (isRecord(value)) {
    const direct = firstInsightText(value, ["desc", "name", "title", "value", "target", "recommend", "date_str", "date"], language);
    if (direct) return direct;
    return Object.entries(value)
      .filter(([, entryValue]) => hasInsightValue(entryValue))
      .slice(0, 3)
      .map(([key, entryValue]) => `${key}: ${displayInsightValue(entryValue, language)}`)
      .join(" · ");
  }
  return String(value);
}

function firstInsightText(record: Record<string, unknown>, keys: string[], language: AppLanguage): string {
  for (const key of keys) {
    const text = displayInsightValue(record[key], language);
    if (text) return text;
  }
  return "";
}

function dateInsightText(value: unknown, language: AppLanguage): string {
  const text = displayInsightValue(value, language);
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}`;
  return text;
}

function sectionHasInsightContent(section: DashboardSymbolInsightSection | undefined): boolean {
  if (!section) return false;
  return section.items.length > 0 || hasInsightValue(section.data);
}

function sectionRecords(section: DashboardSymbolInsightSection | undefined): Array<Record<string, unknown>> {
  return section?.items.filter(isRecord) ?? [];
}

function InsightField({ href, label, value }: { href?: string; label: string; value: string }) {
  if (!value) return null;
  const content = href ? (
    <a className="truncate text-primary hover:underline" href={href} rel="noreferrer" target="_blank">
      {value}
    </a>
  ) : (
    <span className="truncate">{value}</span>
  );
  return (
    <div className="min-w-0 rounded-md bg-muted/20 px-3 py-2">
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-1 flex min-w-0 text-sm font-semibold">{content}</p>
    </div>
  );
}

function InsightBlock({
  children,
  icon,
  section,
  title,
}: {
  children?: ReactNode;
  icon: ReactNode;
  section?: DashboardSymbolInsightSection;
  title: string;
}) {
  const hasContent = sectionHasInsightContent(section);
  if (!hasContent && !section?.error) return null;
  return (
    <div className="border-t border-border/55 pt-4 first:border-t-0 first:pt-0">
      <div className="mb-2 flex min-w-0 items-center gap-2 text-sm font-semibold">
        <span className="shrink-0 text-muted-foreground [&_svg]:size-4">{icon}</span>
        <span className="truncate">{title}</span>
      </div>
      {section?.error && !hasContent ? <InlineState>{section.error}</InlineState> : children}
    </div>
  );
}

function CompanyInsightSection({ language, section }: { language: AppLanguage; section: DashboardSymbolInsightSection }) {
  const labels = language === "en"
    ? {
      title: "Company",
      fullName: "Full name",
      market: "Market",
      category: "Category",
      founded: "Founded",
      listing: "Listing",
      fiscalYear: "Fiscal year",
      employees: "Employees",
      manager: "Manager",
      chairman: "Chairman",
      website: "Website",
      office: "Office",
    }
    : {
      title: "公司资料",
      fullName: "公司全称",
      market: "市场",
      category: "分类",
      founded: "成立",
      listing: "上市",
      fiscalYear: "财年",
      employees: "员工",
      manager: "经理",
      chairman: "主席",
      website: "官网",
      office: "办公地址",
    };
  const data = section.data;
  const profile = firstInsightText(data, ["profile"], language);
  const website = firstInsightText(data, ["website"], language);
  const fields = [
    { label: labels.fullName, value: firstInsightText(data, ["company_name", "name"], language) },
    { label: labels.market, value: [firstInsightText(data, ["market"], language), firstInsightText(data, ["region"], language)].filter(Boolean).join(" · ") },
    { label: labels.category, value: firstInsightText(data, ["category"], language) },
    { label: labels.founded, value: dateInsightText(data.founded, language) },
    { label: labels.listing, value: dateInsightText(data.listing_date, language) },
    { label: labels.fiscalYear, value: firstInsightText(data, ["year_end"], language) },
    { label: labels.employees, value: firstInsightText(data, ["employees"], language) },
    { label: labels.manager, value: firstInsightText(data, ["manager", "legal_repr"], language) },
    { label: labels.chairman, value: firstInsightText(data, ["chairman"], language) },
    { label: labels.website, value: website, href: /^https?:\/\//i.test(website) ? website : undefined },
    { label: labels.office, value: firstInsightText(data, ["office_address", "address"], language) },
  ].filter((field) => field.value);

  return (
    <InsightBlock icon={<Building2 />} section={section} title={labels.title}>
      <div className="space-y-3">
        {profile ? <p className="text-sm leading-6 text-muted-foreground">{profile}</p> : null}
        {fields.length > 0 ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {fields.map((field) => (
              <InsightField href={field.href} key={field.label} label={field.label} value={field.value} />
            ))}
          </div>
        ) : null}
      </div>
    </InsightBlock>
  );
}

function valuationMetricValue(metric: unknown, language: AppLanguage): string {
  if (!isRecord(metric)) return displayInsightValue(metric, language);
  const points = Array.isArray(metric.list) ? metric.list.filter(isRecord) : [];
  const latest = points.length > 0 ? displayInsightValue(points[points.length - 1]?.value, language) : "";
  return latest || firstInsightText(metric, ["value", "desc"], language);
}

function valuationMetricMeta(metric: unknown, labels: { high: string; low: string; median: string }, language: AppLanguage): string {
  if (!isRecord(metric)) return "";
  return [
    firstInsightText(metric, ["high"], language) ? `${labels.high} ${firstInsightText(metric, ["high"], language)}` : "",
    firstInsightText(metric, ["median"], language) ? `${labels.median} ${firstInsightText(metric, ["median"], language)}` : "",
    firstInsightText(metric, ["low"], language) ? `${labels.low} ${firstInsightText(metric, ["low"], language)}` : "",
  ].filter(Boolean).join(" · ");
}

function ValuationInsightSection({ language, section }: { language: AppLanguage; section: DashboardSymbolInsightSection }) {
  const labels = language === "en"
    ? { title: "Valuation", high: "High", low: "Low", median: "Median", pe: "PE", pb: "PB", ps: "PS", dvd_yld: "Dividend yield" }
    : { title: "估值", high: "高", low: "低", median: "中位", pe: "PE", pb: "PB", ps: "PS", dvd_yld: "股息率" };
  const metrics = isRecord(section.data.metrics) ? section.data.metrics : section.data;
  const rows = (["pe", "pb", "ps", "dvd_yld"] as const)
    .map((key) => ({ key, label: labels[key], value: valuationMetricValue(metrics[key], language), meta: valuationMetricMeta(metrics[key], labels, language) }))
    .filter((row) => row.value);

  return (
    <InsightBlock icon={<CircleDollarSign />} section={section} title={labels.title}>
      {rows.length > 0 ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {rows.map((row) => (
            <div className="min-w-0 rounded-md bg-muted/20 px-3 py-2" key={row.key}>
              <p className="truncate text-[11px] text-muted-foreground">{row.label}</p>
              <p className="mt-1 truncate text-sm font-semibold tabular-nums">{row.value}</p>
              {row.meta ? <p className="mt-1 truncate text-[11px] text-muted-foreground">{row.meta}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
    </InsightBlock>
  );
}

function RatingInsightSection({ language, section }: { language: AppLanguage; section: DashboardSymbolInsightSection }) {
  const labels = language === "en"
    ? { title: "Institution rating", recommend: "Consensus", target: "Target", change: "Change", updated: "Updated", buy: "Buy", hold: "Hold", sell: "Sell" }
    : { title: "机构评级", recommend: "共识", target: "目标价", change: "变化", updated: "更新", buy: "买入", hold: "持有", sell: "卖出" };
  const summary = isRecord(section.data.summary) ? section.data.summary : {};
  const latest = isRecord(section.data.latest) ? section.data.latest : {};
  const evaluate = isRecord(summary.evaluate) ? summary.evaluate : isRecord(latest.evaluate) ? latest.evaluate : {};
  const ccy = firstInsightText(summary, ["ccy_symbol"], language);
  const fields = [
    { label: labels.recommend, value: firstInsightText(summary, ["recommend"], language) },
    { label: labels.target, value: [ccy, firstInsightText(summary, ["target"], language)].filter(Boolean).join("") },
    { label: labels.change, value: firstInsightText(summary, ["change"], language) },
    { label: labels.updated, value: firstInsightText(summary, ["updated_at"], language) },
    { label: labels.buy, value: [firstInsightText(evaluate, ["strong_buy"], language), firstInsightText(evaluate, ["buy"], language)].filter(Boolean).join(" / ") },
    { label: labels.hold, value: firstInsightText(evaluate, ["hold"], language) },
    { label: labels.sell, value: [firstInsightText(evaluate, ["sell"], language), firstInsightText(evaluate, ["under"], language)].filter(Boolean).join(" / ") },
  ].filter((field) => field.value);

  return (
    <InsightBlock icon={<Users />} section={section} title={labels.title}>
      {fields.length > 0 ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {fields.map((field) => (
            <InsightField key={field.label} label={field.label} value={field.value} />
          ))}
        </div>
      ) : null}
    </InsightBlock>
  );
}

function ListInsightSection({
  icon,
  kind,
  language,
  section,
  title,
}: {
  icon: ReactNode;
  kind: "dividend" | "action" | "filing";
  language: AppLanguage;
  section: DashboardSymbolInsightSection;
  title: string;
}) {
  const emptyLabel = language === "en" ? "No records" : "暂无记录";
  const records = sectionRecords(section).slice(0, 4);

  function recordTitle(record: Record<string, unknown>) {
    if (kind === "dividend") return firstInsightText(record, ["desc", "title", "name"], language);
    if (kind === "action") return firstInsightText(record, ["act_desc", "action", "act_type", "title"], language);
    return firstInsightText(record, ["title", "name", "filing_title", "type", "desc"], language);
  }

  function recordMeta(record: Record<string, unknown>) {
    if (kind === "dividend") {
      return [
        dateInsightText(record.ex_date, language) ? `${language === "en" ? "Ex" : "除权"} ${dateInsightText(record.ex_date, language)}` : "",
        dateInsightText(record.payment_date, language) ? `${language === "en" ? "Pay" : "派付"} ${dateInsightText(record.payment_date, language)}` : "",
      ].filter(Boolean).join(" · ");
    }
    if (kind === "action") {
      return [
        dateInsightText(record.date_str || record.date, language),
        firstInsightText(record, ["act_type", "date_type"], language),
      ].filter(Boolean).join(" · ");
    }
    return [
      dateInsightText(record.date || record.publish_time || record.released_at || record.time, language),
      firstInsightText(record, ["type", "source"], language),
    ].filter(Boolean).join(" · ");
  }

  return (
    <InsightBlock icon={icon} section={section} title={title}>
      {records.length > 0 ? (
        <div className="divide-y divide-border/55 border-y border-border/55">
          {records.map((record, index) => {
            const itemTitle = recordTitle(record) || emptyLabel;
            const meta = recordMeta(record);
            return (
              <div className="min-w-0 py-2.5" key={`${itemTitle}-${index}`}>
                <p className="line-clamp-2 text-sm font-semibold">{itemTitle}</p>
                {meta ? <p className="mt-1 truncate text-xs text-muted-foreground">{meta}</p> : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </InsightBlock>
  );
}

function SymbolInsightsPanel({
  canFundamentals,
  error,
  insights,
  language,
  loading,
}: {
  canFundamentals: boolean;
  error: string;
  insights: DashboardSymbolInsightsResponse | null;
  language: AppLanguage;
  loading: boolean;
}) {
  const labels = language === "en"
    ? {
      title: "Longbridge insights",
      subtitle: "Company profile, valuation and events",
      loading: "Loading company data...",
      empty: "No company insight data",
      hidden: "This account cannot view company fundamentals",
      filings: "Filings",
      dividends: "Dividends",
      actions: "Corporate actions",
      refreshing: "Refreshing",
    }
    : {
      title: "长桥公司信息",
      subtitle: "公司资料、估值和事件",
      loading: "加载公司信息中...",
      empty: "暂无公司信息数据",
      hidden: "当前账号无权限查看公司基本面",
      filings: "公告披露",
      dividends: "分红",
      actions: "公司行动",
      refreshing: "刷新中",
    };
  const hasAnyContent = Boolean(insights && [
    insights.company,
    insights.valuation,
    insights.institution_rating,
    insights.dividends,
    insights.corporate_actions,
    insights.filings,
  ].some((section) => sectionHasInsightContent(section) || section.error));

  return (
    <div className="border-t border-border/55 pt-4">
      <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{labels.title}</p>
          <p className="truncate text-xs text-muted-foreground">{labels.subtitle}</p>
        </div>
        {loading && insights ? (
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            {labels.refreshing}
          </span>
        ) : null}
      </div>

      {!canFundamentals ? (
        <InlineState>{labels.hidden}</InlineState>
      ) : loading && !insights ? (
        <InlineState icon={<Loader2 className="size-4 animate-spin" />}>{labels.loading}</InlineState>
      ) : error && !insights ? (
        <InlineState>{error}</InlineState>
      ) : !insights || !hasAnyContent ? (
        <InlineState>{labels.empty}</InlineState>
      ) : (
        <div className="space-y-4">
          <CompanyInsightSection language={language} section={insights.company} />
          <ValuationInsightSection language={language} section={insights.valuation} />
          <RatingInsightSection language={language} section={insights.institution_rating} />
          <ListInsightSection icon={<CalendarDays />} kind="dividend" language={language} section={insights.dividends} title={labels.dividends} />
          <ListInsightSection icon={<Landmark />} kind="action" language={language} section={insights.corporate_actions} title={labels.actions} />
          <ListInsightSection icon={<FileText />} kind="filing" language={language} section={insights.filings} title={labels.filings} />
          {error ? <InlineState>{error}</InlineState> : null}
        </div>
      )}
    </div>
  );
}

function WatchlistSymbolDetail({
  canFundamentals,
  language,
  onBack,
  onOpenChart,
  row,
}: {
  canFundamentals: boolean;
  language: AppLanguage;
  onBack: () => void;
  onOpenChart?: (symbol: string) => void;
  row: DashboardWatchlistRow;
}) {
  const copy = i18n[language].overview;
  const tone = rateTone(row.change_rate || row.change_value);
  const labels = language === "en"
    ? {
      price: "Last",
      change: "Change",
      rate: "Change %",
      open: "Open",
      previousClose: "Prev close",
      high: "High",
      low: "Low",
      volume: "Volume",
      turnover: "Turnover",
      openChart: "Chart",
    }
    : {
      price: "最新价",
      change: "涨跌额",
      rate: "涨跌幅",
      open: "开盘",
      previousClose: "昨收",
      high: "最高",
      low: "最低",
      volume: "成交量",
      turnover: "成交额",
      openChart: "图表",
    };
  const insightFallbackError = language === "en" ? "Failed to load company data" : "公司信息加载失败";
  const [insights, setInsights] = useState<DashboardSymbolInsightsResponse | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState("");

  useEffect(() => {
    setInsights(null);
    setInsightsError("");
    if (!canFundamentals) {
      setInsightsLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    setInsightsLoading(true);
    getDashboardSymbolInsights(row.symbol, { signal: controller.signal })
      .then((payload) => {
        setInsights(payload);
      })
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setInsightsError(caught instanceof Error ? caught.message : insightFallbackError);
      })
      .finally(() => {
        if (!controller.signal.aborted) setInsightsLoading(false);
      });

    return () => controller.abort();
  }, [canFundamentals, insightFallbackError, row.symbol]);

  return (
    <FinanceSection
      action={
        <Button size="sm" variant="ghost" onClick={onBack}>
          <ArrowLeft />
          {copy.backToDashboard}
        </Button>
      }
      icon={<Building2 />}
      subtitle={row.name || copy.companyProfile}
      title={row.symbol}
    >
      <div className="space-y-4">
        <WatchlistSymbolChart language={language} row={row} />
        <CapitalFlowChart
          chartClassName="h-[220px]"
          className="min-h-[318px] rounded-md border border-border/65 bg-card/70"
          language={language}
          symbol={row.symbol}
        />

        <div className="rounded-md border-y border-border/55 py-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">{row.name || copy.companyProfile}</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums">{formatNumeric(row.last_done, language, 3)}</p>
            </div>
            <div className={cn("text-right font-semibold tabular-nums", toneClass(tone))}>
              <p className="text-base">{signedChange(row.change_value, tone, language)}</p>
              <p className="text-sm">{formatPercent(row.change_rate, language)}</p>
            </div>
          </div>
          {onOpenChart ? (
            <Button className="mt-4" size="sm" variant="outline" onClick={() => onOpenChart(row.symbol)}>
              <BarChart2 />
              {labels.openChart}
            </Button>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <SymbolDetailMetric label={labels.price} value={formatNumeric(row.last_done, language, 3)} />
          <SymbolDetailMetric label={labels.change} tone={tone} value={signedChange(row.change_value, tone, language)} />
          <SymbolDetailMetric label={labels.rate} tone={tone} value={formatPercent(row.change_rate, language)} />
          <SymbolDetailMetric label={labels.open} value={formatNumeric(row.open, language, 3)} />
          <SymbolDetailMetric label={labels.previousClose} value={formatNumeric(row.prev_close, language, 3)} />
          <SymbolDetailMetric label={labels.high} value={formatNumeric(row.high, language, 3)} />
          <SymbolDetailMetric label={labels.low} value={formatNumeric(row.low, language, 3)} />
          <SymbolDetailMetric label={labels.volume} value={formatCompactNumeric(row.volume, language)} />
          <SymbolDetailMetric label={labels.turnover} value={formatCompactNumeric(row.turnover, language)} />
        </div>

        <SymbolInsightsPanel
          canFundamentals={canFundamentals}
          error={insightsError}
          insights={insights}
          language={language}
          loading={insightsLoading}
        />
      </div>
    </FinanceSection>
  );
}

function SignalDeck({ language }: { language: AppLanguage }) {
  const copy = i18n[language].overview;
  return (
    <FinanceSection icon={<Activity />} subtitle={copy.signalDeckSubtitle} title={copy.signalDeck}>
      <MarketPulse />
    </FinanceSection>
  );
}

function PermissionHidden({ children }: { children: ReactNode }) {
  return (
    <FinanceSection title={String(children)}>
      <InlineState>{children}</InlineState>
    </FinanceSection>
  );
}

export function DashboardPage({
  canPermission,
  chatExpanded,
  chatPanel,
  isMobileViewport,
  language,
  onOpenChart,
  onOpenMarketConfig,
  onOpenPortfolio,
  onOpenWatchlist,
  refreshInterval,
}: DashboardPageProps) {
  const copy = i18n[language].overview;
  const canMarket = canPermission("market:read");
  const canPortfolio = canPermission("portfolio:read");
  const canWatchlist = canPermission("watchlist:read");
  const canFundamentals = canPermission("fundamentals:read");
  const canChat = canPermission("chat:read");

  const initialSnapshotRef = useRef<DashboardResponse | null | undefined>(undefined);
  if (initialSnapshotRef.current === undefined) {
    initialSnapshotRef.current = readDashboardSnapshot();
  }
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(() => initialSnapshotRef.current ?? null);
  const [moduleStatus, setModuleStatus] = useState<Record<DashboardModuleKey, ModuleStatus>>(() =>
    initialModuleStatuses(initialSnapshotRef.current ?? null),
  );
  const [dashboardError, setDashboardError] = useState("");
  const [selectedWatchlistSymbol, setSelectedWatchlistSymbol] = useState("");
  const dashboardRef = useRef<DashboardResponse | null>(dashboard);
  const modulesAbortRef = useRef<AbortController | null>(null);
  const [, startDashboardTransition] = useTransition();

  useEffect(() => {
    dashboardRef.current = dashboard;
    if (dashboard) writeDashboardSnapshot(dashboard);
  }, [dashboard]);

  const refreshModules = useCallback((quiet = true) => {
    modulesAbortRef.current?.abort();
    const controller = new AbortController();
    modulesAbortRef.current = controller;
    const signal = controller.signal;
    const loaders: Array<[DashboardModuleKey, () => Promise<DashboardResponse[DashboardModuleKey]>]> = [
      ["market", () => getDashboardMarket({ signal })],
      ["watchlist", () => getDashboardWatchlist({ signal })],
      ["portfolio", () => getDashboardPortfolio({ signal })],
    ];

    const tasks = loaders.map(async ([key, loader]) => {
      const hasData = dashboardHasModuleData(dashboardRef.current, key);
      setModuleStatus((previous) => ({
        ...previous,
        [key]: {
          ...previous[key],
          loading: !quiet && !hasData,
          refreshing: quiet || hasData,
          error: quiet ? previous[key].error : "",
        },
      }));

      try {
        const module = await loader();
        if (signal.aborted) return;
        startDashboardTransition(() => {
          setDashboardError("");
          setDashboard((previous) => mergeDashboard(previous, { [key]: module } as Partial<DashboardResponse>));
          setModuleStatus((previous) => ({
            ...previous,
            [key]: moduleStatusFromModule(module),
          }));
        });
      } catch (caught) {
        if (signal.aborted) return;
        const message = caught instanceof Error ? caught.message : copy.loadFailed;
        startDashboardTransition(() => {
          setModuleStatus((previous) => ({
            ...previous,
            [key]: {
              ...previous[key],
              loading: false,
              refreshing: false,
              error: message,
              stale: true,
            },
          }));
        });
      }
    });

    return Promise.allSettled(tasks).finally(() => {
      if (modulesAbortRef.current === controller) modulesAbortRef.current = null;
    });
  }, [copy.loadFailed, startDashboardTransition]);

  useEffect(() => {
    const controller = new AbortController();
    setDashboardError("");
    setModuleStatus((previous) => {
      const next = { ...previous };
      for (const key of DASHBOARD_MODULE_KEYS) {
        const hasData = dashboardHasModuleData(dashboardRef.current, key);
        next[key] = { ...next[key], loading: !hasData, refreshing: hasData, error: "" };
      }
      return next;
    });

    getDashboard("bootstrap", { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;
        startDashboardTransition(() => {
          setDashboardError("");
          setDashboard((previous) => mergeDashboard(previous, response));
          setModuleStatus({
            market: moduleStatusFromModule(response.market),
            watchlist: moduleStatusFromModule(response.watchlist),
            portfolio: moduleStatusFromModule(response.portfolio),
          });
        });
      })
      .catch((caught) => {
        if (controller.signal.aborted) return;
        const message = caught instanceof Error ? caught.message : copy.loadFailed;
        startDashboardTransition(() => {
          setDashboardError(message);
          setModuleStatus((previous) => {
            const next = { ...previous };
            for (const key of DASHBOARD_MODULE_KEYS) {
              next[key] = {
                ...next[key],
                loading: false,
                refreshing: false,
                error: dashboardHasModuleData(dashboardRef.current, key) ? next[key].error : message,
              };
            }
            return next;
          });
        });
      })
      .finally(() => {
        if (!controller.signal.aborted) void refreshModules(true);
      });

    return () => {
      controller.abort();
    };
  }, [copy.loadFailed, refreshModules, startDashboardTransition]);

  useEffect(() => () => modulesAbortRef.current?.abort(), []);

  const refreshMs = useMemo(() => Math.max(8, Number(refreshInterval) || 60) * 1000, [refreshInterval]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const timer = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void refreshModules(true);
    }, refreshMs);
    return () => window.clearInterval(timer);
  }, [refreshModules, refreshMs]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const handleVisibilityChange = () => {
      if (!document.hidden) void refreshModules(true);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [refreshModules]);

  const marketModule = dashboard?.market;
  const watchlistModule = dashboard?.watchlist;
  const portfolioModule = dashboard?.portfolio;
  const watchlistRows = watchlistModule?.items ?? [];
  const selectedWatchlistRow = useMemo(
    () => watchlistRows.find((row) => row.symbol === selectedWatchlistSymbol) ?? null,
    [selectedWatchlistSymbol, watchlistRows],
  );

  useEffect(() => {
    if (selectedWatchlistSymbol && !watchlistRows.some((row) => row.symbol === selectedWatchlistSymbol)) {
      setSelectedWatchlistSymbol("");
    }
  }, [selectedWatchlistSymbol, watchlistRows]);

  return (
    <div className="page-enter flex min-h-0 w-full flex-1 flex-col gap-3 xl:h-full xl:overflow-hidden">
      <div
        className={cn(
          "dashboard-wide-grid grid min-h-0 gap-6 xl:flex-1 xl:grid-cols-[300px_minmax(0,1fr)_minmax(360px,0.88fr)] xl:grid-rows-[minmax(0,1fr)] xl:overflow-hidden 2xl:grid-cols-[320px_minmax(420px,1fr)_minmax(390px,0.86fr)]",
          chatExpanded && "xl:grid-cols-[300px_minmax(0,1fr)_minmax(360px,0.88fr)] 2xl:grid-cols-[320px_minmax(420px,1fr)_minmax(390px,0.86fr)]",
        )}
      >
        <main className="dashboard-scroll-column min-w-0 xl:col-start-1 xl:row-start-1">
          {canWatchlist ? (
            <WatchlistMovers
              error={moduleStatus.watchlist.error || watchlistModule?.error || dashboardError}
              language={language}
              loading={moduleStatus.watchlist.loading}
              module={watchlistModule}
              onOpenChart={canMarket ? onOpenChart : undefined}
              onOpenWatchlist={onOpenWatchlist}
              onSelectSymbol={setSelectedWatchlistSymbol}
              selectedSymbol={selectedWatchlistSymbol}
              subtitle={sectionSubtitle(copy.watchlistMoversSubtitle, moduleStatus.watchlist, language)}
            />
          ) : (
            <PermissionHidden>{copy.watchlistHidden}</PermissionHidden>
          )}
        </main>

        <section
          className={cn(
            "dashboard-secondary-column dashboard-scroll-column min-w-0 xl:col-start-2 xl:row-start-1",
            chatExpanded && "xl:hidden",
          )}
        >
          {selectedWatchlistRow ? (
            <WatchlistSymbolDetail
              canFundamentals={canFundamentals}
              language={language}
              onBack={() => setSelectedWatchlistSymbol("")}
              onOpenChart={canMarket ? onOpenChart : undefined}
              row={selectedWatchlistRow}
            />
          ) : (
            <>
              {canMarket ? (
                <MarketSnapshot
                  error={moduleStatus.market.error || marketModule?.error || dashboardError}
                  indices={marketModule?.indices ?? []}
                  language={language}
                  loading={moduleStatus.market.loading}
                  onOpenMarketConfig={onOpenMarketConfig}
                  subtitle={sectionSubtitle(copy.marketSnapshotSubtitle, moduleStatus.market, language)}
                />
              ) : (
                <PermissionHidden>{copy.marketHidden}</PermissionHidden>
              )}
              {canPortfolio ? (
                <PortfolioSummary
                  error={moduleStatus.portfolio.error || portfolioModule?.error || dashboardError}
                  language={language}
                  loading={moduleStatus.portfolio.loading}
                  module={portfolioModule}
                  onOpenPortfolio={onOpenPortfolio}
                  subtitle={sectionSubtitle(copy.portfolioSubtitle, moduleStatus.portfolio, language)}
                />
              ) : (
                <PermissionHidden>{copy.portfolioHidden}</PermissionHidden>
              )}
              <SignalDeck language={language} />
            </>
          )}
        </section>

        {!isMobileViewport ? (
          <aside
            className={cn(
              "dashboard-chat-column dashboard-scroll-column finance-right-rail flex min-h-[720px] min-w-0 flex-col overflow-hidden xl:col-start-3 xl:row-start-1 xl:min-h-0",
              chatExpanded && "xl:col-start-2 xl:col-span-2",
            )}
          >
            {canChat ? chatPanel : <PermissionHidden>{copy.chatHidden}</PermissionHidden>}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
