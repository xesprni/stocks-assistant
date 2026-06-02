/**
 * TechnicalAnalysis.tsx
 * Native Canvas charts tuned for the app theme.
 *
 * Layout:
 *  - Left sidebar: symbol list
 *  - Main area: Tab switch (分时 / K线)
 *  - K-line mode: chart | indicator selector | indicator display | chip distribution
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { BarChart2, RefreshCw, TrendingUp } from "lucide-react";
import {
  NativeStockChart,
  type NativeChartPane,
  type NativeChartSeries,
  type NativeChartTheme,
  type NativeVisibleRange,
} from "@/components/charts/NativeStockChart";
import { getCandlesticks, getIntraday, listWatchlist } from "@/lib/api";
import { readStoredValue, writeStoredValue } from "@/lib/local-storage";
import type { CandlestickItem, IntradayItem, WatchlistItem } from "@/types/app";
import {
  calcMA,
  calcMACD,
  calcKDJ,
  calcRSI,
  calcBollinger,
  calcCCI,
  calcWR,
  calcEMAValues,
  calcBBIBOLL,
  calcDMI,
  calcOSC,
  calcChipDistribution,
} from "@/lib/indicators";
import { useChartColors } from "@/lib/color-scheme";

// ── Types ─────────────────────────────────────────────────────────────────────

type Period = "1D" | "1W" | "1M";
type SubIndicatorKey = "MACD" | "KDJ" | "RSI" | "CCI" | "WR" | "DMI" | "OSC";
type OverlayIndicatorKey = "BOLL" | "BBIBOLL" | "EMA";
type IndicatorKey = SubIndicatorKey | OverlayIndicatorKey;

interface Props {
  language: AppLanguage;
  symbol: string;
  onSymbolChange: (s: string) => void;
  onBack?: () => void;
  embedded?: boolean;
}

type AppLanguage = "zh" | "en";

const technicalCopy = {
  zh: {
    title: "技术分析",
    watchlist: "自选股",
    noData: "暂无数据",
    us: "美股",
    a: "A股",
    h: "港股",
    daily: "日K",
    weekly: "周K",
    monthly: "月K",
    loading: "加载中",
    auto: "自动",
    refreshIntervalAria: "自动刷新间隔秒数",
    updated: "更新 {time}",
    refresh: "刷新",
    chipDistribution: "筹码分布",
    profitRatio: "获利比例",
    locked: "套牢 {value}%",
    profit: "获利 {value}%",
    kline: "K线",
    intraday: "分时",
    subIndicators: "副图",
    overlays: "叠加",
  },
  en: {
    title: "Technical Analysis",
    watchlist: "Watchlist",
    noData: "No data",
    us: "US",
    a: "A-share",
    h: "HK",
    daily: "Daily",
    weekly: "Weekly",
    monthly: "Monthly",
    loading: "Loading",
    auto: "Auto",
    refreshIntervalAria: "Auto-refresh interval in seconds",
    updated: "Updated {time}",
    refresh: "Refresh",
    chipDistribution: "Chip Distribution",
    profitRatio: "Profit Ratio",
    locked: "Locked {value}%",
    profit: "Profit {value}%",
    kline: "K-line",
    intraday: "Intraday",
    subIndicators: "Sub",
    overlays: "Overlay",
  },
} as const;

type TechnicalCopy = (typeof technicalCopy)[AppLanguage];

function formatTemplate(text: string, values: Record<string, string | number>) {
  return text.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
}

// ── Theme ─────────────────────────────────────────────────────────────────────

function useIsDark() {
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains("dark")
  );
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setIsDark(document.documentElement.classList.contains("dark"))
    );
    obs.observe(document.documentElement, { attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return isDark;
}

function cssHsl(styles: CSSStyleDeclaration, name: string, alpha?: number) {
  const value = styles.getPropertyValue(name).trim();
  if (!value) return alpha == null ? "transparent" : `rgb(0 0 0 / ${alpha})`;
  return alpha == null ? `hsl(${value})` : `hsl(${value} / ${alpha})`;
}

function useNativeChartTheme(isDark: boolean, upColor: string, downColor: string): NativeChartTheme {
  return useMemo(() => {
    const styles = getComputedStyle(document.documentElement);
    return {
      background: cssHsl(styles, "--background"),
      text: cssHsl(styles, "--foreground"),
      mutedText: cssHsl(styles, "--muted-foreground"),
      border: cssHsl(styles, "--border"),
      grid: styles.getPropertyValue("--grid-line").trim() || cssHsl(styles, "--border", isDark ? 0.28 : 0.36),
      crosshair: cssHsl(styles, "--muted-foreground", isDark ? 0.72 : 0.62),
      axisBackground: cssHsl(styles, "--background", 0.92),
      up: upColor,
      down: downColor,
      blue: cssHsl(styles, "--primary"),
      orange: cssHsl(styles, "--secondary"),
      purple: isDark ? "#c58af9" : "#7e57c2",
      yellow: isDark ? "#fdd663" : "#b7791f",
    };
  }, [isDark, upColor, downColor]);
}

// ── Data helpers ───────────────────────────────────────────────────────────────

function parseBars(bars: CandlestickItem[]) {
  return bars.map((b) => ({
    time: b.timestamp,
    open: parseFloat(b.open),
    high: parseFloat(b.high),
    low: parseFloat(b.low),
    close: parseFloat(b.close),
    volume: parseFloat(b.volume),
  }));
}

function parseIntraday(bars: IntradayItem[]) {
  return bars
    .map((b) => ({
      time: b.timestamp,
      price: parseFloat(b.price),
      volume: parseFloat(b.volume),
      avg_price: parseFloat(b.avg_price),
    }))
    .sort((a, b) => Number(a.time) - Number(b.time));
}

type ParsedIntradayBar = ReturnType<typeof parseIntraday>[number];

const DEFAULT_INTRADAY_REFRESH_SECONDS = 5;
const INTRADAY_REFRESH_STORAGE_KEY = "stocks-assistant.intraday-refresh-seconds";
const TECHNICAL_WATCHLIST_TAB_STORAGE_KEY = "stocks-assistant.technical.watchlist-tab";
const TECHNICAL_ACTIVE_TAB_STORAGE_KEY = "stocks-assistant.technical.active-tab";
const TECHNICAL_KLINE_PERIOD_STORAGE_KEY = "stocks-assistant.technical.kline-period";

function clampIntradayRefreshSeconds(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_INTRADAY_REFRESH_SECONDS;
  return Math.min(10, Math.max(1, Math.round(value)));
}

function loadStoredIntradayRefreshSeconds() {
  try {
    const stored = localStorage.getItem(INTRADAY_REFRESH_STORAGE_KEY);
    return stored == null ? DEFAULT_INTRADAY_REFRESH_SECONDS : clampIntradayRefreshSeconds(Number(stored));
  } catch {
    return DEFAULT_INTRADAY_REFRESH_SECONDS;
  }
}

function sameLocalDate(a: number, b: number) {
  return new Date(a * 1000).toDateString() === new Date(b * 1000).toDateString();
}

function sameIntradayBar(a: ParsedIntradayBar, b: ParsedIntradayBar) {
  return (
    Number(a.time) === Number(b.time) &&
    a.price === b.price &&
    a.volume === b.volume &&
    a.avg_price === b.avg_price
  );
}

function mergeIntradayBars(current: ParsedIntradayBar[], incoming: ParsedIntradayBar[]) {
  if (current.length === 0) {
    return { bars: incoming, changedStart: 0, replace: true };
  }
  if (incoming.length === 0) {
    return { bars: current, changedStart: current.length, replace: false };
  }

  const firstIncomingTime = Number(incoming[0].time);
  const currentFirstTime = Number(current[0].time);
  const currentLastTime = Number(current[current.length - 1].time);

  if (firstIncomingTime < currentFirstTime || !sameLocalDate(firstIncomingTime, currentLastTime)) {
    return { bars: incoming, changedStart: 0, replace: true };
  }

  let start = current.findIndex((bar) => Number(bar.time) >= firstIncomingTime);
  if (start === -1) start = current.length;

  const next = [...current];
  let changedStart = current.length;
  let cursor = start;

  for (const bar of incoming) {
    const barTime = Number(bar.time);
    while (cursor < next.length && Number(next[cursor].time) < barTime) {
      cursor++;
    }

    if (cursor < next.length && Number(next[cursor].time) === barTime) {
      if (!sameIntradayBar(next[cursor], bar)) {
        next[cursor] = bar;
        changedStart = Math.min(changedStart, cursor);
      }
      cursor++;
      continue;
    }

    next.splice(cursor, 0, bar);
    changedStart = Math.min(changedStart, cursor);
    cursor++;
  }

  const canTailUpdate = changedStart >= current.length - 1;
  return {
    bars: next,
    changedStart,
    replace: !canTailUpdate,
  };
}

// ── Watchlist sidebar ─────────────────────────────────────────────────────────

function watchlistDisplayName(item: WatchlistItem, language: AppLanguage) {
  return language === "en"
    ? (item.name_en || item.name_cn || item.name || item.symbol)
    : (item.name_cn || item.name || item.symbol);
}

function SymbolSideNav({
  active,
  copy,
  language,
  onSelect,
}: {
  active: string;
  copy: TechnicalCopy;
  language: AppLanguage;
  onSelect: (s: string, name: string) => void;
}) {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [tab, setTab] = useState<"US" | "A" | "H">(() =>
    readStoredValue(TECHNICAL_WATCHLIST_TAB_STORAGE_KEY, ["US", "A", "H"], "US"),
  );
  const categoryLabels: Record<"US" | "A" | "H", string> = { US: copy.us, A: copy.a, H: copy.h };

  useEffect(() => {
    writeStoredValue(TECHNICAL_WATCHLIST_TAB_STORAGE_KEY, tab);
  }, [tab]);

  useEffect(() => {
    listWatchlist(tab)
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  }, [tab]);

  return (
    <aside className="flex w-full shrink-0 flex-col overflow-hidden border-b border-border bg-card md:max-h-none md:w-40 md:border-b-0 md:border-r">
      <div className="flex items-center gap-1.5 border-b border-border bg-muted/30 px-3 py-2">
        <TrendingUp size={13} className="text-primary" />
        <span className="text-[11px] font-semibold tracking-wide text-foreground">{copy.watchlist}</span>
      </div>
      <div className="flex border-b border-border">
        {(["US", "A", "H"] as const).map((c) => (
          <button
            key={c}
            onClick={() => setTab(c)}
            className={`flex-1 py-1.5 text-[11px] font-medium transition-all ${
              tab === c
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {categoryLabels[c]}
          </button>
        ))}
      </div>
      <div className="flex overflow-x-auto md:block md:flex-1 md:overflow-y-auto">
        {items.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">{copy.noData}</div>
        ) : (
          items.map((item) => {
            const displayName = watchlistDisplayName(item, language);
            return (
              <button
                key={item.id}
                onClick={() => onSelect(item.symbol, displayName)}
                className={`group relative w-36 shrink-0 border-r border-border/50 px-3 py-2.5 text-left transition-colors md:w-full md:border-b md:border-r-0 ${
                  item.symbol === active
                    ? "bg-primary/5"
                    : "hover:bg-muted/50"
                }`}
              >
                {item.symbol === active && (
                  <span className="absolute inset-y-0 left-0 w-0.5 rounded-full bg-primary" />
                )}
                <div className={`truncate text-xs font-semibold ${
                  item.symbol === active ? "text-primary" : "text-foreground"
                }`}>
                  {item.symbol}
                </div>
                <div className="truncate text-[10px] text-muted-foreground group-hover:text-foreground/70">
                  {displayName}
                </div>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}

// ── Native chart data helpers ─────────────────────────────────────────────────

type ParsedKLineBar = ReturnType<typeof parseBars>[number];

function colorWithAlpha(color: string, opacity: number) {
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    return `${color}${Math.round(Math.min(1, Math.max(0, opacity)) * 255)
      .toString(16)
      .padStart(2, "0")}`;
  }
  if (color.startsWith("hsl(") && !color.includes("/")) {
    return color.replace(/\)$/, ` / ${opacity})`);
  }
  return color;
}

function toLinePoints(
  bars: { time: number }[],
  values: (number | null)[],
): Extract<NativeChartSeries, { type: "line" }>["data"] {
  return bars
    .map((bar, index) => (values[index] == null ? null : { time: bar.time, value: values[index]! }))
    .filter((point): point is { time: number; value: number } => point != null);
}

function makeLineSeries(
  id: string,
  paneId: string,
  title: string,
  color: string,
  bars: { time: number }[],
  values: (number | null)[],
  dashed = false,
): NativeChartSeries {
  return {
    id,
    paneId,
    title,
    type: "line",
    color,
    lineWidth: 1.35,
    dashed,
    data: toLinePoints(bars, values),
  };
}

function makeHistogramSeries(
  id: string,
  paneId: string,
  title: string,
  bars: { time: number }[],
  values: (number | null)[],
  colorForValue: (value: number, index: number) => string,
): NativeChartSeries {
  return {
    id,
    paneId,
    title,
    type: "histogram",
    baseline: 0,
    data: bars
      .map((bar, index) => {
        const value = values[index];
        return value == null ? null : { time: bar.time, value, color: colorForValue(value, index) };
      })
      .filter((point): point is { time: number; value: number; color: string } => point != null),
  };
}

function buildKLineChartModel(
  bars: ParsedKLineBar[],
  activeIndicators: Set<IndicatorKey>,
  theme: NativeChartTheme,
): { panes: NativeChartPane[]; series: NativeChartSeries[] } {
  const closes = bars.map((bar) => bar.close);
  const highs = bars.map((bar) => bar.high);
  const lows = bars.map((bar) => bar.low);
  const panes: NativeChartPane[] = [
    { id: "price", label: "PRICE", heightWeight: 3 },
    { id: "volume", label: "VOL", heightWeight: 0.72 },
  ];
  const series: NativeChartSeries[] = [
    {
      id: "candles",
      paneId: "price",
      title: "OHLC",
      type: "candlestick",
      data: bars.map((bar) => ({
        time: bar.time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      })),
    },
    makeLineSeries("ma5", "price", "MA5", theme.orange, bars, calcMA(closes, 5)),
    makeLineSeries("ma10", "price", "MA10", theme.blue, bars, calcMA(closes, 10)),
    makeLineSeries("ma20", "price", "MA20", theme.purple, bars, calcMA(closes, 20)),
    makeHistogramSeries("volume", "volume", "VOL", bars, bars.map((bar) => bar.volume), (_value, index) =>
      bars[index].close >= bars[index].open ? colorWithAlpha(theme.up, 0.36) : colorWithAlpha(theme.down, 0.36),
    ),
  ];

  if (activeIndicators.has("BOLL")) {
    const boll = calcBollinger(closes);
    series.push(
      makeLineSeries("boll-upper", "price", "BOLL U", theme.yellow, bars, boll.map((point) => point?.upper ?? null)),
      makeLineSeries("boll-middle", "price", "BOLL M", theme.mutedText, bars, boll.map((point) => point?.middle ?? null), true),
      makeLineSeries("boll-lower", "price", "BOLL L", theme.yellow, bars, boll.map((point) => point?.lower ?? null)),
    );
  }

  if (activeIndicators.has("BBIBOLL")) {
    const bbiboll = calcBBIBOLL(closes);
    series.push(
      makeLineSeries("bbiboll-upper", "price", "BBI U", theme.orange, bars, bbiboll.map((point) => point?.upper ?? null), true),
      makeLineSeries("bbiboll-middle", "price", "BBI M", theme.blue, bars, bbiboll.map((point) => point?.middle ?? null)),
      makeLineSeries("bbiboll-lower", "price", "BBI L", theme.orange, bars, bbiboll.map((point) => point?.lower ?? null), true),
    );
  }

  if (activeIndicators.has("EMA")) {
    series.push(
      makeLineSeries("ema12", "price", "EMA12", theme.orange, bars, calcEMAValues(closes, 12)),
      makeLineSeries("ema26", "price", "EMA26", theme.purple, bars, calcEMAValues(closes, 26)),
    );
  }

  for (const key of ["MACD", "KDJ", "RSI", "CCI", "WR", "DMI", "OSC"] as SubIndicatorKey[]) {
    if (!activeIndicators.has(key)) continue;
    const paneId = key.toLowerCase();
    panes.push({ id: paneId, label: key, heightWeight: 0.9 });
    if (key === "MACD") {
      const macd = calcMACD(closes);
      series.push(
        makeHistogramSeries("macd-hist", paneId, "HIST", bars, macd.map((point) => point?.histogram ?? null), (value) =>
          value >= 0 ? colorWithAlpha(theme.up, 0.62) : colorWithAlpha(theme.down, 0.62),
        ),
        makeLineSeries("macd", paneId, "MACD", theme.blue, bars, macd.map((point) => point?.macd ?? null)),
        makeLineSeries("macd-signal", paneId, "SIGNAL", theme.orange, bars, macd.map((point) => point?.signal ?? null)),
      );
    } else if (key === "KDJ") {
      const kdj = calcKDJ(highs, lows, closes);
      series.push(
        makeLineSeries("kdj-k", paneId, "K", theme.blue, bars, kdj.map((point) => point?.k ?? null)),
        makeLineSeries("kdj-d", paneId, "D", theme.orange, bars, kdj.map((point) => point?.d ?? null)),
        makeLineSeries("kdj-j", paneId, "J", theme.purple, bars, kdj.map((point) => point?.j ?? null)),
      );
    } else if (key === "RSI") {
      series.push(makeLineSeries("rsi", paneId, "RSI", theme.blue, bars, calcRSI(closes)));
    } else if (key === "CCI") {
      series.push(makeLineSeries("cci", paneId, "CCI", theme.orange, bars, calcCCI(highs, lows, closes)));
    } else if (key === "WR") {
      series.push(makeLineSeries("wr", paneId, "WR", theme.purple, bars, calcWR(highs, lows, closes)));
    } else if (key === "DMI") {
      const dmi = calcDMI(highs, lows, closes);
      series.push(
        makeLineSeries("dmi-pdi", paneId, "PDI", theme.blue, bars, dmi.map((point) => point?.pdi ?? null)),
        makeLineSeries("dmi-mdi", paneId, "MDI", theme.orange, bars, dmi.map((point) => point?.mdi ?? null)),
        makeLineSeries("dmi-adx", paneId, "ADX", theme.purple, bars, dmi.map((point) => point?.adx ?? null)),
        makeLineSeries("dmi-adxr", paneId, "ADXR", theme.yellow, bars, dmi.map((point) => point?.adxr ?? null), true),
      );
    } else if (key === "OSC") {
      const osc = calcOSC(closes);
      series.push(
        makeHistogramSeries("osc-hist", paneId, "HIST", bars, osc.map((point) => point?.histogram ?? null), (value) =>
          value >= 0 ? colorWithAlpha(theme.up, 0.62) : colorWithAlpha(theme.down, 0.62),
        ),
        makeLineSeries("osc", paneId, "OSC", theme.blue, bars, osc.map((point) => point?.osc ?? null)),
        makeLineSeries("maosc", paneId, "MAOSC", theme.orange, bars, osc.map((point) => point?.maosc ?? null)),
      );
    }
  }

  return { panes, series };
}

// ── K-line chart ──────────────────────────────────────────────────────────────

function KLineChart({
  symbol,
  activeIndicators,
  copy,
  isDark,
  onParsedBars,
  onVisibleRangeChange,
}: {
  symbol: string;
  activeIndicators: Set<IndicatorKey>;
  copy: TechnicalCopy;
  isDark: boolean;
  onParsedBars: (bars: ReturnType<typeof parseBars>) => void;
  onVisibleRangeChange: (range: { min: number; max: number } | null) => void;
}) {
  const { upColor, downColor } = useChartColors();
  const theme = useNativeChartTheme(isDark, upColor, downColor);
  const [period, setPeriod] = useState<Period>(() =>
    readStoredValue(TECHNICAL_KLINE_PERIOD_STORAGE_KEY, ["1D", "1W", "1M"], "1D"),
  );
  const [loading, setLoading] = useState(false);
  const [bars, setBars] = useState<ReturnType<typeof parseBars>>([]);
  const symbolRef = useRef(symbol);
  const periodRef = useRef(period);
  const dataCountRef = useRef(200);
  const isLoadingMoreRef = useRef(false);
  const isRefreshingLatestRef = useRef(false);
  const allDataLoadedRef = useRef(false);

  useEffect(() => { symbolRef.current = symbol; }, [symbol]);
  useEffect(() => { periodRef.current = period; }, [period]);
  useEffect(() => {
    writeStoredValue(TECHNICAL_KLINE_PERIOD_STORAGE_KEY, period);
  }, [period]);

  const chartModel = useMemo(
    () => buildKLineChartModel(bars, activeIndicators, theme),
    [activeIndicators, bars, theme],
  );
  const times = useMemo(() => bars.map((bar) => bar.time), [bars]);

  const loadMore = useCallback(() => {
    if (!symbolRef.current || isLoadingMoreRef.current || allDataLoadedRef.current || bars.length === 0) return;
    isLoadingMoreRef.current = true;
    const currentCount = dataCountRef.current;
    const nextCount = currentCount + 200;
    getCandlesticks(symbolRef.current, periodRef.current, nextCount)
      .then((res) => {
        const nextBars = parseBars(res.bars);
        if (nextBars.length <= currentCount) {
          allDataLoadedRef.current = true;
          return;
        }
        dataCountRef.current = nextCount;
        setBars(nextBars);
        onParsedBars(nextBars);
      })
      .catch(() => {})
      .finally(() => {
        isLoadingMoreRef.current = false;
      });
  }, [bars.length, onParsedBars]);

  const refreshLatest = useCallback(() => {
    if (!symbolRef.current || isRefreshingLatestRef.current || bars.length === 0) return;
    isRefreshingLatestRef.current = true;
    const currentCount = Math.max(dataCountRef.current, bars.length);
    getCandlesticks(symbolRef.current, periodRef.current, currentCount)
      .then((res) => {
        const nextBars = parseBars(res.bars);
        if (nextBars.length === 0) return;
        const currentLast = bars[bars.length - 1]?.time;
        const nextLast = nextBars[nextBars.length - 1]?.time;
        const currentFirst = bars[0]?.time;
        const nextFirst = nextBars[0]?.time;
        if (nextLast !== currentLast || nextFirst !== currentFirst || nextBars.length !== bars.length) {
          dataCountRef.current = Math.max(currentCount, nextBars.length);
          setBars(nextBars);
          onParsedBars(nextBars);
        }
      })
      .catch(() => {})
      .finally(() => {
        isRefreshingLatestRef.current = false;
      });
  }, [bars, onParsedBars]);

  useEffect(() => {
    if (!symbol) {
      setBars([]);
      onParsedBars([]);
      onVisibleRangeChange(null);
      return;
    }
    let cancelled = false;
    dataCountRef.current = 200;
    allDataLoadedRef.current = false;
    setLoading(true);
    getCandlesticks(symbol, period)
      .then((res) => {
        if (cancelled) return;
        const parsed = parseBars(res.bars);
        setBars(parsed);
        onParsedBars(parsed);
      })
      .catch(() => {
        if (!cancelled) {
          setBars([]);
          onParsedBars([]);
          onVisibleRangeChange(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [onParsedBars, onVisibleRangeChange, period, symbol]);

  const handleVisibleRangeChange = useCallback((range: NativeVisibleRange | null) => {
    onVisibleRangeChange(range?.price ?? null);
  }, [onVisibleRangeChange]);

  return (
    <div className="technical-chart-panel flex min-h-[520px] flex-1 flex-col bg-background lg:min-h-0">
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-background px-3">
        <div className="flex h-8 items-center gap-1 border-b border-border/70">
          {(["1D", "1W", "1M"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`h-8 border-b-2 px-2.5 text-[11px] font-medium transition-colors ${
                period === p
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {p === "1D" ? copy.daily : p === "1W" ? copy.weekly : copy.monthly}
            </button>
          ))}
        </div>
        <div className="ml-3 flex items-center gap-2.5">
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className="h-px w-3 bg-orange-500" />MA5
          </span>
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className="h-px w-3 bg-blue-600" />MA10
          </span>
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className="h-px w-3 bg-purple-600" />MA20
          </span>
        </div>
        {loading && (
          <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
            <RefreshCw size={10} className="animate-spin" />{copy.loading}
          </span>
        )}
      </div>
      <NativeStockChart
        times={times}
        panes={chartModel.panes}
        series={chartModel.series}
        theme={theme}
        fitKey={`${symbol}:${period}`}
        primaryRangeSeriesId="candles"
        onVisibleRangeChange={handleVisibleRangeChange}
        onNearStart={loadMore}
        onNearEnd={refreshLatest}
        enableTouchCrosshairHaptics
        className="technical-native-chart min-h-[440px] flex-1 lg:min-h-0"
      />
    </div>
  );
}

// ── Intraday chart ────────────────────────────────────────────────────────────

function buildIntradayChartModel(
  bars: ParsedIntradayBar[],
  theme: NativeChartTheme,
): { panes: NativeChartPane[]; series: NativeChartSeries[] } {
  const closes = bars.map((bar) => bar.price);
  const macd = calcMACD(closes);
  const panes: NativeChartPane[] = [
    { id: "price", label: "PRICE", heightWeight: 3 },
    { id: "volume", label: "VOL", heightWeight: 0.6 },
    { id: "macd", label: "MACD", heightWeight: 0.75 },
  ];
  const series: NativeChartSeries[] = [
    makeLineSeries("price", "price", "PRICE", theme.blue, bars, bars.map((bar) => bar.price)),
    makeLineSeries("avg", "price", "AVG", theme.orange, bars, bars.map((bar) => bar.avg_price), true),
    makeHistogramSeries("volume", "volume", "VOL", bars, bars.map((bar) => bar.volume), () =>
      colorWithAlpha(theme.blue, 0.42),
    ),
    makeHistogramSeries("macd-hist", "macd", "HIST", bars, macd.map((point) => point?.histogram ?? null), (value) =>
      value >= 0 ? colorWithAlpha(theme.up, 0.62) : colorWithAlpha(theme.down, 0.62),
    ),
    makeLineSeries("macd", "macd", "MACD", theme.blue, bars, macd.map((point) => point?.macd ?? null)),
    makeLineSeries("signal", "macd", "SIGNAL", theme.orange, bars, macd.map((point) => point?.signal ?? null)),
  ];
  return { panes, series };
}

function IntradayCharts({
  symbol,
  copy,
  language,
  isDark,
}: {
  symbol: string;
  copy: TechnicalCopy;
  language: AppLanguage;
  isDark: boolean;
}) {
  const { upColor, downColor } = useChartColors();
  const theme = useNativeChartTheme(isDark, upColor, downColor);

  const barsRef = useRef<ParsedIntradayBar[]>([]);
  const lastTimestampRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const requestSeqRef = useRef(0);
  const symbolRef = useRef(symbol);

  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshSeconds, setRefreshSeconds] = useState(loadStoredIntradayRefreshSeconds);
  const [bars, setBars] = useState<ParsedIntradayBar[]>([]);
  const [fitKey, setFitKey] = useState(0);

  useEffect(() => { symbolRef.current = symbol; }, [symbol]);

  useEffect(() => {
    return () => {
      requestSeqRef.current += 1;
      inFlightRef.current = false;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(INTRADAY_REFRESH_STORAGE_KEY, String(refreshSeconds));
    } catch {
      // Ignore storage failures; the in-memory setting still works.
    }
  }, [refreshSeconds]);

  const applyBars = useCallback((incoming: ParsedIntradayBar[], replaceAll: boolean) => {
    const merged = replaceAll
      ? { bars: incoming, changedStart: 0, replace: true }
      : mergeIntradayBars(barsRef.current, incoming);

    barsRef.current = merged.bars;
    const last = merged.bars[merged.bars.length - 1];
    lastTimestampRef.current = last ? Number(last.time) : null;

    if (merged.replace || merged.changedStart < merged.bars.length) {
      setBars(merged.bars);
      if (replaceAll || merged.replace) setFitKey((value) => value + 1);
    }
  }, []);

  const chartModel = useMemo(() => buildIntradayChartModel(bars, theme), [bars, theme]);
  const times = useMemo(() => bars.map((bar) => bar.time), [bars]);

  const load = useCallback((mode: "full" | "incremental" = "incremental") => {
    if (!symbol) return;
    if (mode === "incremental" && inFlightRef.current) return;

    const requestId = requestSeqRef.current + 1;
    requestSeqRef.current = requestId;
    const requestSymbol = symbol;
    const since = mode === "incremental" ? lastTimestampRef.current : null;

    inFlightRef.current = true;
    setLoading(true);
    getIntraday(requestSymbol, since)
      .then((res) => {
        if (requestSeqRef.current !== requestId || symbolRef.current !== requestSymbol) return;
        const bars = parseIntraday(res.bars);
        applyBars(bars, mode === "full");
        setLastUpdated(new Date().toLocaleTimeString(language === "en" ? "en-US" : "zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }));
      })
      .catch(() => {})
      .finally(() => {
        if (requestSeqRef.current === requestId) {
          inFlightRef.current = false;
          setLoading(false);
        }
      });
  }, [applyBars, language, symbol]);

  useEffect(() => {
    barsRef.current = [];
    lastTimestampRef.current = null;
    setBars([]);
    setLastUpdated("");
    load("full");
  }, [symbol]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => load("incremental"), refreshSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, load, refreshSeconds]);

  return (
    <div className="technical-chart-panel technical-intraday-panel flex min-h-[560px] flex-1 flex-col bg-background lg:min-h-0">
      <div className="flex items-center gap-2 border-b border-border bg-background px-3 py-1.5">
        <span className="border-l-2 border-primary/60 pl-1.5 text-[10px] font-medium text-muted-foreground">VOL</span>
        <span className="border-l-2 border-secondary/70 pl-1.5 text-[10px] font-medium text-muted-foreground">MACD</span>
        <label className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.currentTarget.checked)}
            className="size-3 accent-primary"
          />
          {copy.auto}
        </label>
        <input
          type="number"
          min={1}
          max={10}
          value={refreshSeconds}
          disabled={!autoRefresh}
          onChange={(e) => setRefreshSeconds(clampIntradayRefreshSeconds(e.currentTarget.valueAsNumber))}
          className="h-6 w-11 border border-border bg-background px-1 text-right text-[10px] text-foreground outline-none transition-colors focus:border-primary disabled:opacity-50"
          aria-label={copy.refreshIntervalAria}
        />
        <span className="text-[10px] text-muted-foreground">s</span>
        {lastUpdated && (
          <span className="text-[10px] text-muted-foreground">{formatTemplate(copy.updated, { time: lastUpdated })}</span>
        )}
        <button
          onClick={() => load("incremental")}
          disabled={loading}
          title={copy.refresh}
          className="p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
        >
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
        </button>
      </div>
      <NativeStockChart
        times={times}
        panes={chartModel.panes}
        series={chartModel.series}
        theme={theme}
        fitKey={`${symbol}:${fitKey}`}
        className="technical-native-chart min-h-[500px] w-full flex-1 lg:min-h-0"
      />
    </div>
  );
}

// ── Chip Distribution Panel ───────────────────────────────────────────────────

function ChipDistributionPanel({
  bars,
  copy,
  isDark,
  visibleRange,
}: {
  bars: ReturnType<typeof parseBars>;
  copy: TechnicalCopy;
  isDark: boolean;
  visibleRange: { min: number; max: number } | null;
}) {
  const { upColor, downColor } = useChartColors();
  const result = useMemo(() => {
    if (bars.length === 0) return { chips: [], profitRatio: 0 };
    const lastClose = bars[bars.length - 1].close;
    let step = 0.01;
    if (lastClose > 100) step = 0.5;
    if (lastClose > 500) step = 1;
    if (lastClose > 1000) step = 2;
    if (lastClose > 5000) step = 5;
    if (lastClose > 10000) step = 10;
    return calcChipDistribution(bars, step, 0.95, 50);
  }, [bars]);

  const lastClose = bars.length > 0 ? bars[bars.length - 1].close : 0;

  // Filter chips to visible range and compute layout
  const { visibleChips, priceMin, priceMax } = useMemo(() => {
    const all = result.chips;
    if (all.length === 0) return { visibleChips: [], priceMin: 0, priceMax: 0 };
    const lo = visibleRange ? visibleRange.min : Math.min(...all.map((c) => c.price));
    const hi = visibleRange ? visibleRange.max : Math.max(...all.map((c) => c.price));
    const margin = (hi - lo) * 0.05;
    const pMin = lo - margin;
    const pMax = hi + margin;
    const filtered = all.filter((c) => c.price >= pMin && c.price <= pMax);
    return { visibleChips: filtered, priceMin: pMin, priceMax: pMax };
  }, [result.chips, visibleRange]);

  const maxPercent = visibleChips.length > 0 ? Math.max(...visibleChips.map((c) => c.percent)) : 1;
  const priceSpan = priceMax - priceMin || 1;

  const profitColor = upColor;
  const lossColor = downColor;

  return (
    <div className="technical-chip-panel flex h-44 w-full shrink-0 flex-col border-t border-border/70 bg-background/80 lg:h-full lg:w-40 lg:border-l lg:border-t-0">
      <div className="shrink-0 border-b border-border/60 bg-muted/10 px-3 py-2">
        <div className="text-[11px] font-semibold text-foreground">{copy.chipDistribution}</div>
      </div>

      <div className="shrink-0 border-b border-border/60 px-3 py-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">{copy.profitRatio}</span>
          <span
            className="text-sm font-bold"
            style={{ color: result.profitRatio >= 50 ? profitColor : lossColor }}
          >
            {result.profitRatio.toFixed(1)}%
          </span>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted/45">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.min(100, result.profitRatio)}%`,
              background: `linear-gradient(90deg, ${profitColor}, ${profitColor}88)`,
            }}
          />
        </div>
        <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
          <span style={{ color: lossColor }}>{formatTemplate(copy.locked, { value: (100 - result.profitRatio).toFixed(0) })}</span>
          <span style={{ color: profitColor }}>{formatTemplate(copy.profit, { value: result.profitRatio.toFixed(0) })}</span>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden bg-card/30">
        {lastClose >= priceMin && lastClose <= priceMax && (
          <div
            className="absolute left-2 right-2 border-t border-dashed border-primary/55"
            style={{ bottom: `${((lastClose - priceMin) / priceSpan) * 100}%` }}
          >
            <span className="absolute -top-2.5 right-0 rounded-sm bg-background/95 px-1 font-mono text-[8px] text-primary">
              {lastClose.toFixed(2)}
            </span>
          </div>
        )}
        {visibleChips.map((chip) => {
          const widthPct = maxPercent > 0 ? (chip.percent / maxPercent) * 100 : 0;
          const isProfit = chip.price <= lastClose;
          // Position from bottom: price maps to bottom%
          const bottomPct = ((chip.price - priceMin) / priceSpan) * 100;
          const barHeight = Math.max(2, (100 / visibleChips.length) * 0.8);
          return (
            <div
              key={chip.price.toFixed(4)}
              className="absolute left-2 right-8 flex items-center"
              style={{ bottom: `${bottomPct}%`, height: `${barHeight}%` }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${widthPct}%`,
                  backgroundColor: isProfit ? profitColor + "88" : lossColor + "88",
                  minWidth: widthPct > 0 ? 2 : 0,
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Indicator selector + display ──────────────────────────────────────────────

const SUB_INDICATORS: { key: SubIndicatorKey; label: string; color: string }[] = [
  { key: "MACD", label: "MACD", color: "#2563eb" },
  { key: "KDJ",  label: "KDJ",  color: "#d97706" },
  { key: "RSI",  label: "RSI",  color: "#7c3aed" },
  { key: "CCI",  label: "CCI",  color: "#0f766e" },
  { key: "WR",   label: "WR",   color: "#be123c" },
  { key: "DMI",  label: "DMI",  color: "#0284c7" },
  { key: "OSC",  label: "OSC",  color: "#ea580c" },
];
const OVERLAY_INDICATORS: { key: OverlayIndicatorKey; label: string; color: string }[] = [
  { key: "BOLL",    label: "BOLL",    color: "#ca8a04" },
  { key: "BBIBOLL", label: "BBIBOLL", color: "#ea580c" },
  { key: "EMA",     label: "EMA",     color: "#7c3aed" },
];

// ── Main ──────────────────────────────────────────────────────────────────────

export default function TechnicalAnalysis({ language, symbol, onSymbolChange, onBack, embedded = false }: Props) {
  const copy = technicalCopy[language];
  const isDark = useIsDark();
  const [displayName, setDisplayName] = useState("");
  const [activeIndicators, setActiveIndicators] = useState<Set<IndicatorKey>>(new Set());
  const [activeTab, setActiveTab] = useState<"kline" | "intraday">(() =>
    readStoredValue(TECHNICAL_ACTIVE_TAB_STORAGE_KEY, ["kline", "intraday"], "kline"),
  );
  const [parsedBars, setParsedBars] = useState<ReturnType<typeof parseBars>>([]);
  const [visiblePriceRange, setVisiblePriceRange] = useState<{ min: number; max: number } | null>(null);

  useEffect(() => {
    if (!displayName && symbol) setDisplayName(symbol);
  }, [symbol, displayName]);

  useEffect(() => {
    writeStoredValue(TECHNICAL_ACTIVE_TAB_STORAGE_KEY, activeTab);
  }, [activeTab]);

  function toggleIndicator(key: IndicatorKey) {
    setActiveIndicators((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Active sub-indicator descriptions for display
  const activeSubLabels = SUB_INDICATORS.filter((i) => activeIndicators.has(i.key));
  const activeOverlayLabels = OVERLAY_INDICATORS.filter((i) => activeIndicators.has(i.key));

  return (
    <div className="technical-analysis-root flex min-h-0 flex-col bg-background text-foreground lg:h-full lg:overflow-hidden">
      {/* ── Header ── */}
      {!embedded ? (
        <header className="flex shrink-0 items-center gap-2 border-b border-border bg-card/90 px-4 py-2 backdrop-blur">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 ring-1 ring-primary/20">
            <BarChart2 size={14} className="text-primary" />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">
              {displayName || symbol || copy.title}
            </div>
            {symbol && displayName && displayName !== symbol && (
              <div className="text-[10px] leading-tight text-muted-foreground">{symbol}</div>
            )}
          </div>
        </header>
      ) : null}

      {/* ── Body ── */}
      <div className={`technical-analysis-body flex min-h-0 flex-1 flex-col lg:overflow-hidden ${embedded ? "" : "md:flex-row"}`}>
        {/* Sidebar */}
        {!embedded ? (
          <SymbolSideNav
            active={symbol}
            copy={copy}
            language={language}
            onSelect={(s, name) => {
              setDisplayName(name);
              onSymbolChange(s);
            }}
          />
        ) : null}

        {/* Main content */}
        <div className="technical-main-content flex min-h-0 flex-1 flex-col lg:overflow-hidden">
          {/* Tab switch: 分时 / K线 */}
          <div className="technical-tab-bar flex shrink-0 items-center gap-2 border-b border-border bg-background px-3">
            <div className="flex h-9 items-center gap-1 border-b border-border/70">
              <button
                onClick={() => setActiveTab("kline")}
                className={`h-9 border-b-2 px-3 text-[11px] font-medium transition-colors ${
                  activeTab === "kline"
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {copy.kline}
              </button>
              <button
                onClick={() => setActiveTab("intraday")}
                className={`h-9 border-b-2 px-3 text-[11px] font-medium transition-colors ${
                  activeTab === "intraday"
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {copy.intraday}
              </button>
            </div>
          </div>

          {activeTab === "kline" ? (
            <div className="technical-kline-layout flex min-h-[640px] flex-1 flex-col lg:min-h-0 lg:flex-row lg:overflow-hidden">
              {/* Left: indicator selector + chart */}
              <div className="technical-chart-column flex min-h-0 flex-1 flex-col lg:overflow-hidden">
                {/* Indicator selector (above chart) */}
                <div className="technical-indicator-bar flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-background px-3 py-2">
                  <span className="mr-0.5 text-[10px] font-medium text-muted-foreground">{copy.subIndicators}</span>
                  {SUB_INDICATORS.map(({ key, label, color }) => (
                    <button
                      key={key}
                      onClick={() => toggleIndicator(key)}
                      className={`inline-flex h-7 items-center gap-1.5 border-b-2 px-1 text-[11px] font-medium transition-colors ${
                        activeIndicators.has(key)
                          ? "border-primary text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                      {label}
                    </button>
                  ))}
                  <div className="mx-1.5 h-3 w-px bg-border" />
                  <span className="text-[10px] font-medium text-muted-foreground">{copy.overlays}</span>
                  {OVERLAY_INDICATORS.map(({ key, label, color }) => (
                    <button
                      key={key}
                      onClick={() => toggleIndicator(key)}
                      className={`inline-flex h-7 items-center gap-1.5 border-b-2 px-1 text-[11px] font-medium transition-colors ${
                        activeIndicators.has(key)
                          ? "border-primary text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                      {label}
                    </button>
                  ))}

                  {/* Active indicator tags inline */}
                  {(activeSubLabels.length > 0 || activeOverlayLabels.length > 0) && (
                    <>
                      <div className="mx-1.5 h-3 w-px bg-border" />
                      {activeOverlayLabels.map(({ key, label, color }) => (
                        <span key={key} className="flex items-center gap-1 border-l border-border/80 pl-1.5 text-[10px] text-muted-foreground">
                          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                          <span className="font-medium">{label}</span>
                        </span>
                      ))}
                      {activeSubLabels.map(({ key, label, color }) => (
                        <span key={key} className="flex items-center gap-1 border-l border-border/80 pl-1.5 text-[10px] text-muted-foreground">
                          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                          <span className="font-medium">{label}</span>
                        </span>
                      ))}
                    </>
                  )}
                </div>

                {/* Chart area (flex-1 fills remaining space) */}
                <KLineChart
                  symbol={symbol}
                  activeIndicators={activeIndicators}
                  copy={copy}
                  isDark={isDark}
                  onParsedBars={setParsedBars}
                  onVisibleRangeChange={setVisiblePriceRange}
                />
              </div>

              {/* Right: Chip distribution */}
              {parsedBars.length > 0 && (
                <ChipDistributionPanel bars={parsedBars} copy={copy} isDark={isDark} visibleRange={visiblePriceRange} />
              )}
            </div>
          ) : (
            /* Intraday mode */
            <IntradayCharts symbol={symbol} copy={copy} language={language} isDark={isDark} />
          )}
        </div>
      </div>
    </div>
  );
}
