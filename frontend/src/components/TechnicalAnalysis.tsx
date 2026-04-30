/**
 * TechnicalAnalysis.tsx
 * Built for lightweight-charts v5 (addSeries + pane system).
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  type LineData,
  type HistogramData,
  type Time,
  type MouseEventParams,
  ColorType,
  CrosshairMode,
  LineStyle,
} from "lightweight-charts";
import { BarChart2, RefreshCw, TrendingUp } from "lucide-react";
import { getCandlesticks, getIntraday, listWatchlist } from "@/lib/api";
import type { CandlestickItem, IntradayItem, WatchlistItem } from "@/types/app";
import { calcMA, calcMACD, calcKDJ, calcRSI, calcBollinger, calcCCI, calcWR } from "@/lib/indicators";

// ── Types ─────────────────────────────────────────────────────────────────────

type Period = "1D" | "1W" | "1M";
type IndicatorKey = "MACD" | "KDJ" | "RSI" | "CCI" | "WR" | "BOLL";

interface Props {
  symbol: string;
  onSymbolChange: (s: string) => void;
  onBack?: () => void;
}

// ── Theme ─────────────────────────────────────────────────────────────────────

function makeTheme(isDark: boolean) {
  return isDark ? {
    bg:     "#131722",
    text:   "#d1d5db",
    grid:   "rgba(255,255,255,0.04)",
    border: "#2a2e39",
    up:     "#089981",
    down:   "#f23645",
    blue:   "#2962ff",
    orange: "#ff6d00",
    purple: "#9c27b0",
    yellow: "#f57f17",
  } : {
    bg:     "#ffffff",
    text:   "#1e222d",
    grid:   "rgba(0,0,0,0.06)",
    border: "#dde1eb",
    up:     "#089981",
    down:   "#f23645",
    blue:   "#2962ff",
    orange: "#ff6d00",
    purple: "#9c27b0",
    yellow: "#f57f17",
  };
}

type ChartTheme = ReturnType<typeof makeTheme>;

function chartLayoutOpts(T: ChartTheme) {
  return {
    layout: {
      background: { type: ColorType.Solid, color: T.bg },
      textColor: T.text,
    },
    grid: {
      vertLines: { color: T.grid },
      horzLines: { color: T.grid },
    },
    timeScale: { borderColor: T.border, timeVisible: true, secondsVisible: false },
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: { borderColor: T.border },
  };
}

function chartOpts(height: number, T: ChartTheme) {
  return { height, ...chartLayoutOpts(T) };
}

/** Watch the `dark` class on <html> and re-render when it changes. */
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

// ── Data helpers ───────────────────────────────────────────────────────────────

function parseBars(bars: CandlestickItem[]) {
  return bars.map((b) => ({
    time: b.timestamp as Time,
    open: parseFloat(b.open),
    high: parseFloat(b.high),
    low: parseFloat(b.low),
    close: parseFloat(b.close),
    volume: parseFloat(b.volume),
  }));
}

function parseIntraday(bars: IntradayItem[]) {
  return bars.map((b) => ({
    time: b.timestamp as Time,
    price: parseFloat(b.price),
    volume: parseFloat(b.volume),
    avg_price: parseFloat(b.avg_price),
  }));
}

// ── Watchlist sidebar ─────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<"US" | "A" | "H", string> = { US: "美股", A: "A股", H: "港股" };

function SymbolSideNav({
  active,
  onSelect,
}: {
  active: string;
  onSelect: (s: string, name: string) => void;
}) {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [tab, setTab] = useState<"US" | "A" | "H">("US");

  useEffect(() => {
    listWatchlist(tab)
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  }, [tab]);

  return (
    <aside className="flex w-40 shrink-0 flex-col overflow-hidden border-r border-border bg-card">
      {/* Sidebar header */}
      <div className="flex items-center gap-1.5 border-b border-border bg-muted/30 px-3 py-2">
        <TrendingUp size={13} className="text-primary" />
        <span className="text-[11px] font-semibold tracking-wide text-foreground">自选股</span>
      </div>
      {/* Market tabs */}
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
            {CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>
      {/* Symbol list */}
      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">暂无数据</div>
        ) : (
          items.map((item) => (
            <button
              key={item.id}
              onClick={() => onSelect(item.symbol, item.name_cn || item.name)}
              className={`group relative w-full border-b border-border/50 px-3 py-2.5 text-left transition-colors ${
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
                {item.name_cn || item.name}
              </div>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}

// ── K-line chart ──────────────────────────────────────────────────────────────

/**
 * Single IChartApi with v5 pane system:
 *   Pane 0: Candlestick + MA5/10/20 + optional BOLL overlay
 *   Pane 1: Volume histogram (always shown)
 *   Pane 2+: Dynamic indicator panes (MACD / KDJ / RSI)
 */
function KLineChart({
  symbol,
  activeIndicators,
  isDark,
  onCrosshairMove,
  registerChart,
}: {
  symbol: string;
  activeIndicators: Set<IndicatorKey>;
  isDark: boolean;
  onCrosshairMove: (params: MouseEventParams) => void;
  registerChart: (chart: IChartApi | null, primarySeries: ISeriesApi<SeriesType> | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const ma5Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ma10Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ma20Ref = useRef<ISeriesApi<"Line"> | null>(null);

  const indicatorSeriesRef = useRef<Map<IndicatorKey, ISeriesApi<SeriesType>[]>>(new Map());
  const bollSeriesRef = useRef<ISeriesApi<"Line">[]>([]);

  const parsedRef = useRef<ReturnType<typeof parseBars>>([]);

  const [period, setPeriod] = useState<Period>("1D");
  const [loading, setLoading] = useState(false);

  // Build chart once
  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const T = makeTheme(isDark);
    const chart = createChart(containerRef.current, {
      ...chartOpts(400, T),
      width: containerRef.current.clientWidth,
    });
    chartRef.current = chart;

    // Pane 0: candles
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: T.up,
      downColor: T.down,
      borderUpColor: T.up,
      borderDownColor: T.down,
      wickUpColor: T.up,
      wickDownColor: T.down,
    });
    candleRef.current = candle;

    // Pane 0: MA overlays
    ma5Ref.current = chart.addSeries(LineSeries, {
      color: T.orange, lineWidth: 1, priceLineVisible: false,
      lastValueVisible: false, crosshairMarkerVisible: false, title: "MA5",
    });
    ma10Ref.current = chart.addSeries(LineSeries, {
      color: T.blue, lineWidth: 1, priceLineVisible: false,
      lastValueVisible: false, crosshairMarkerVisible: false, title: "MA10",
    });
    ma20Ref.current = chart.addSeries(LineSeries, {
      color: T.purple, lineWidth: 1, priceLineVisible: false,
      lastValueVisible: false, crosshairMarkerVisible: false, title: "MA20",
    });

    // Pane 1: volume
    const vol = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      color: T.blue + "55",
    }, 1);
    volRef.current = vol;
    chart.panes()[1]?.setStretchFactor(0.25);

    registerChart(chart, candle);
    chart.subscribeCrosshairMove(onCrosshairMove);

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volRef.current = null;
      ma5Ref.current = null;
      ma10Ref.current = null;
      ma20Ref.current = null;
      indicatorSeriesRef.current.clear();
      bollSeriesRef.current = [];
      registerChart(null, null);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Rebuild indicator panes
  const rebuildIndicators = useCallback(() => {
    const chart = chartRef.current;
    if (!chart || parsedRef.current.length === 0) return;

    const T = makeTheme(isDark);
    const parsed = parsedRef.current;
    const closes = parsed.map((b) => b.close);
    const highs = parsed.map((b) => b.high);
    const lows = parsed.map((b) => b.low);

    // Remove existing indicator series
    for (const seriesList of indicatorSeriesRef.current.values()) {
      for (const s of seriesList) {
        try { chart.removeSeries(s); } catch { /* ignore */ }
      }
    }
    indicatorSeriesRef.current.clear();

    // Remove existing BOLL overlays
    for (const s of bollSeriesRef.current) {
      try { chart.removeSeries(s); } catch { /* ignore */ }
    }
    bollSeriesRef.current = [];

    // Remove indicator panes (keep pane 0 and 1)
    while (chart.panes().length > 2) {
      chart.removePane(chart.panes().length - 1);
    }

    // BOLL overlay on pane 0
    if (activeIndicators.has("BOLL")) {
      const boll = calcBollinger(closes);
      const bollLines: ISeriesApi<"Line">[] = [];
      (["upper", "middle", "lower"] as const).forEach((k, idx) => {
        const colors = [T.yellow, T.text, T.yellow];
        const s = chart.addSeries(LineSeries, {
          color: colors[idx],
          lineWidth: 1,
          lineStyle: k === "middle" ? LineStyle.Dashed : LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        s.setData(
          parsed
            .map((b, i) => boll[i] != null ? { time: b.time, value: boll[i]![k] } : null)
            .filter((v): v is LineData => v != null)
        );
        bollLines.push(s);
      });
      bollSeriesRef.current = bollLines;
    }

    // Indicator sub-panes
    let paneIdx = 2;
    for (const key of ["MACD", "KDJ", "RSI", "CCI", "WR"] as IndicatorKey[]) {
      if (!activeIndicators.has(key)) continue;
      const seriesList: ISeriesApi<SeriesType>[] = [];

      if (key === "MACD") {
        const macd = calcMACD(closes);
        const hist = chart.addSeries(HistogramSeries, { priceLineVisible: false }, paneIdx);
        const macdLine = chart.addSeries(LineSeries, {
          color: T.blue, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
        }, paneIdx);
        const signalLine = chart.addSeries(LineSeries, {
          color: T.orange, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
        }, paneIdx);
        hist.setData(
          parsed.map((b, i) => macd[i] ? {
            time: b.time, value: macd[i]!.histogram,
            color: macd[i]!.histogram >= 0 ? T.up + "99" : T.down + "99",
          } : null).filter(v => v !== null) as HistogramData[]
        );
        macdLine.setData(
          parsed.map((b, i) => macd[i] ? { time: b.time, value: macd[i]!.macd } : null)
            .filter((v): v is LineData => v != null)
        );
        signalLine.setData(
          parsed.map((b, i) => macd[i] ? { time: b.time, value: macd[i]!.signal } : null)
            .filter((v): v is LineData => v != null)
        );
        seriesList.push(hist, macdLine, signalLine);
      } else if (key === "KDJ") {
        const kdj = calcKDJ(highs, lows, closes);
        const kS = chart.addSeries(LineSeries, { color: T.blue, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: "K" }, paneIdx);
        const dS = chart.addSeries(LineSeries, { color: T.orange, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: "D" }, paneIdx);
        const jS = chart.addSeries(LineSeries, { color: T.purple, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: "J" }, paneIdx);
        kS.setData(parsed.map((b, i) => kdj[i] ? { time: b.time, value: kdj[i]!.k } : null).filter((v): v is LineData => v != null));
        dS.setData(parsed.map((b, i) => kdj[i] ? { time: b.time, value: kdj[i]!.d } : null).filter((v): v is LineData => v != null));
        jS.setData(parsed.map((b, i) => kdj[i] ? { time: b.time, value: kdj[i]!.j } : null).filter((v): v is LineData => v != null));
        seriesList.push(kS, dS, jS);
      } else if (key === "RSI") {
        const rsi = calcRSI(closes);
        const rsiS = chart.addSeries(LineSeries, { color: T.blue, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: "RSI" }, paneIdx);
        rsiS.setData(parsed.map((b, i) => rsi[i] != null ? { time: b.time, value: rsi[i]! } : null).filter((v): v is LineData => v != null));
        seriesList.push(rsiS);
      } else if (key === "CCI") {
        const cci = calcCCI(highs, lows, closes);
        const cciS = chart.addSeries(LineSeries, { color: T.orange, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: "CCI" }, paneIdx);
        cciS.setData(parsed.map((b, i) => cci[i] != null ? { time: b.time, value: cci[i]! } : null).filter((v): v is LineData => v != null));
        seriesList.push(cciS);
      } else if (key === "WR") {
        const wr = calcWR(highs, lows, closes);
        const wrS = chart.addSeries(LineSeries, { color: T.purple, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: "WR" }, paneIdx);
        wrS.setData(parsed.map((b, i) => wr[i] != null ? { time: b.time, value: wr[i]! } : null).filter((v): v is LineData => v != null));
        seriesList.push(wrS);
      }

      chart.panes()[paneIdx]?.setStretchFactor(0.3);
      indicatorSeriesRef.current.set(key, seriesList);
      paneIdx++;
    }
  }, [activeIndicators, isDark]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-run when indicators toggle (data already in parsedRef)
  useEffect(() => {
    rebuildIndicators();
  }, [rebuildIndicators]);

  // Update chart colors when theme changes
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions(chartLayoutOpts(makeTheme(isDark)));
    }
  }, [isDark]);

  // Load data on symbol / period change
  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    getCandlesticks(symbol, period)
      .then((res) => {
        const parsed = parseBars(res.bars);
        parsedRef.current = parsed;
        const closes = parsed.map((b) => b.close);

        candleRef.current?.setData(
          parsed.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close }))
        );
        volRef.current?.setData(
          parsed.map((b) => ({
            time: b.time, value: b.volume,
            color: b.close >= b.open ? makeTheme(isDark).up + "55" : makeTheme(isDark).down + "55",
          }))
        );
        const ma5 = calcMA(closes, 5);
        const ma10 = calcMA(closes, 10);
        const ma20 = calcMA(closes, 20);
        ma5Ref.current?.setData(parsed.map((b, i) => ma5[i] != null ? { time: b.time, value: ma5[i]! } : null).filter((v): v is LineData => v != null));
        ma10Ref.current?.setData(parsed.map((b, i) => ma10[i] != null ? { time: b.time, value: ma10[i]! } : null).filter((v): v is LineData => v != null));
        ma20Ref.current?.setData(parsed.map((b, i) => ma20[i] != null ? { time: b.time, value: ma20[i]! } : null).filter((v): v is LineData => v != null));

        rebuildIndicators();
        chartRef.current?.timeScale().fitContent();
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [symbol, period]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col bg-background">
      {/* K-line toolbar */}
      <div className="flex items-center gap-0.5 border-b border-border bg-card px-3 py-1.5">
        {/* Period buttons */}
        <div className="flex rounded bg-muted p-0.5">
          {(["1D", "1W", "1M"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded px-2.5 py-0.5 text-[11px] font-medium transition-all ${
                period === p
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p === "1D" ? "日K" : p === "1W" ? "周K" : "月K"}
            </button>
          ))}
        </div>
        {/* MA legend */}
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
            <RefreshCw size={10} className="animate-spin" />加载中
          </span>
        )}
      </div>
      <div ref={containerRef} className="w-full" />
    </div>
  );
}

// ── Intraday chart ────────────────────────────────────────────────────────────

/**
 * Single IChartApi with 2 panes:
 *   Pane 0: Price line + avg price line
 *   Pane 1: Volume histogram + MACD lines
 */
function IntradayCharts({
  symbol,
  isDark,
  onCrosshairMove,
  registerChart,
}: {
  symbol: string;
  isDark: boolean;
  onCrosshairMove: (params: MouseEventParams) => void;
  registerChart: (chart: IChartApi | null, primarySeries: ISeriesApi<SeriesType> | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const priceSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const avgSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const volSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const macdSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const signalSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const histSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState("");

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const T = makeTheme(isDark);
    const chart = createChart(containerRef.current, {
      ...chartOpts(380, T),
      width: containerRef.current.clientWidth,
    });
    chartRef.current = chart;

    // Pane 0: price + avg
    priceSeriesRef.current = chart.addSeries(LineSeries, {
      color: T.blue, lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
    });
    avgSeriesRef.current = chart.addSeries(LineSeries, {
      color: T.orange, lineWidth: 1, lineStyle: LineStyle.Dashed,
      priceLineVisible: false, lastValueVisible: false,
    });

    // Pane 1: volume + MACD
    volSeriesRef.current = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      color: T.blue + "66",
    }, 1);
    macdSeriesRef.current = chart.addSeries(LineSeries, {
      color: T.blue, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
    }, 1);
    signalSeriesRef.current = chart.addSeries(LineSeries, {
      color: T.orange, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
    }, 1);
    histSeriesRef.current = chart.addSeries(HistogramSeries, { priceLineVisible: false }, 1);
    chart.panes()[1]?.setStretchFactor(0.4);

    registerChart(chart, priceSeriesRef.current);
    chart.subscribeCrosshairMove(onCrosshairMove);

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      priceSeriesRef.current = null;
      avgSeriesRef.current = null;
      volSeriesRef.current = null;
      macdSeriesRef.current = null;
      signalSeriesRef.current = null;
      histSeriesRef.current = null;
      registerChart(null, null);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update chart colors when theme changes
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions(chartLayoutOpts(makeTheme(isDark)));
    }
  }, [isDark]);

  const load = useCallback(() => {
    if (!symbol) return;
    setLoading(true);
    getIntraday(symbol)
      .then((res) => {
        const bars = parseIntraday(res.bars);
        if (!priceSeriesRef.current) return;
        const closes = bars.map((b) => b.price);
        const macd = calcMACD(closes);

        priceSeriesRef.current.setData(bars.map((b) => ({ time: b.time, value: b.price })) as LineData[]);
        avgSeriesRef.current?.setData(bars.map((b) => ({ time: b.time, value: b.avg_price })) as LineData[]);
        volSeriesRef.current?.setData(bars.map((b) => ({ time: b.time, value: b.volume, color: makeTheme(isDark).blue + "66" })) as HistogramData[]);
        macdSeriesRef.current?.setData(bars.map((b, i) => macd[i] ? { time: b.time, value: macd[i]!.macd } : null).filter((v): v is LineData => v != null));
        signalSeriesRef.current?.setData(bars.map((b, i) => macd[i] ? { time: b.time, value: macd[i]!.signal } : null).filter((v): v is LineData => v != null));
        histSeriesRef.current?.setData(
          bars.map((b, i) => macd[i] ? {
            time: b.time, value: macd[i]!.histogram,
            color: macd[i]!.histogram >= 0 ? makeTheme(isDark).up + "99" : makeTheme(isDark).down + "99",
          } : null).filter(v => v !== null) as HistogramData[]
        );
        chartRef.current?.timeScale().fitContent();
        setLastUpdated(new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [symbol]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="flex flex-col bg-background">
      {/* Intraday toolbar */}
      <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-1.5">
        <TrendingUp size={12} className="text-muted-foreground" />
        <span className="text-[11px] font-medium text-foreground">分时</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">VOL</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">MACD</span>
        {lastUpdated && (
          <span className="ml-auto text-[10px] text-muted-foreground">更新 {lastUpdated}</span>
        )}
        <button
          onClick={load}
          disabled={loading}
          title="刷新"
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
        </button>
      </div>
      <div ref={containerRef} className="w-full" />
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

const SUB_INDICATORS: { key: IndicatorKey; label: string; color: string }[] = [
  { key: "MACD", label: "MACD", color: "#2962ff" },
  { key: "KDJ",  label: "KDJ",  color: "#ff6d00" },
  { key: "RSI",  label: "RSI",  color: "#9c27b0" },
  { key: "CCI",  label: "CCI",  color: "#00897b" },
  { key: "WR",   label: "WR",   color: "#c62828" },
];
const OVERLAY_INDICATORS: { key: IndicatorKey; label: string; color: string }[] = [
  { key: "BOLL", label: "布林带", color: "#f57f17" },
];

export default function TechnicalAnalysis({ symbol, onSymbolChange, onBack }: Props) {
  const isDark = useIsDark();
  const [displayName, setDisplayName] = useState("");
  const [activeIndicators, setActiveIndicators] = useState<Set<IndicatorKey>>(new Set());

  const klineChartRef = useRef<IChartApi | null>(null);
  const klinePrimaryRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const intradayChartRef = useRef<IChartApi | null>(null);
  const intradayPrimaryRef = useRef<ISeriesApi<SeriesType> | null>(null);

  useEffect(() => {
    if (!displayName && symbol) setDisplayName(symbol);
  }, [symbol, displayName]);

  const registerKLine = useCallback(
    (chart: IChartApi | null, primary: ISeriesApi<SeriesType> | null) => {
      klineChartRef.current = chart;
      klinePrimaryRef.current = primary;
    },
    []
  );

  const registerIntraday = useCallback(
    (chart: IChartApi | null, primary: ISeriesApi<SeriesType> | null) => {
      intradayChartRef.current = chart;
      intradayPrimaryRef.current = primary;
    },
    []
  );

  const syncToIntraday = useCallback((params: MouseEventParams) => {
    if (!params.time || !intradayChartRef.current || !intradayPrimaryRef.current) return;
    try {
      intradayChartRef.current.setCrosshairPosition(0, params.time, intradayPrimaryRef.current);
    } catch { /* chart removed */ }
  }, []);

  const syncToKLine = useCallback((params: MouseEventParams) => {
    if (!params.time || !klineChartRef.current || !klinePrimaryRef.current) return;
    try {
      klineChartRef.current.setCrosshairPosition(0, params.time, klinePrimaryRef.current);
    } catch { /* chart removed */ }
  }, []);

  function toggleIndicator(key: IndicatorKey) {
    setActiveIndicators((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      {/* ── Header ── */}
      <header className="flex shrink-0 items-center gap-2 border-b border-border bg-card/90 px-4 py-2 backdrop-blur">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 ring-1 ring-primary/20">
          <BarChart2 size={14} className="text-primary" />
        </div>
        <div>
          <div className="text-sm font-semibold leading-tight">
            {displayName || symbol || "技术分析"}
          </div>
          {symbol && displayName && displayName !== symbol && (
            <div className="text-[10px] leading-tight text-muted-foreground">{symbol}</div>
          )}
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <SymbolSideNav
          active={symbol}
          onSelect={(s, name) => {
            setDisplayName(name);
            onSymbolChange(s);
          }}
        />

        {/* Charts */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: K-line + indicator bar */}
          <div className="flex flex-1 flex-col overflow-hidden border-r border-border">
            <KLineChart
              symbol={symbol}
              activeIndicators={activeIndicators}
              isDark={isDark}
              onCrosshairMove={syncToIntraday}
              registerChart={registerKLine}
            />
            {/* ─ Indicator selector bar ─ */}
            <div className="flex shrink-0 flex-wrap items-center gap-1 border-t border-border bg-muted/40 px-3 py-1.5">
              <span className="mr-0.5 text-[10px] font-medium text-muted-foreground">副图</span>
              {SUB_INDICATORS.map(({ key, label, color }) => (
                <button
                  key={key}
                  onClick={() => toggleIndicator(key)}
                  className={`rounded border px-2 py-0.5 text-[11px] font-medium transition-all ${
                    activeIndicators.has(key)
                      ? "border-transparent text-white"
                      : "border-border bg-card text-muted-foreground hover:border-muted-foreground hover:text-foreground"
                  }`}
                  style={activeIndicators.has(key) ? { background: color, borderColor: color } : {}}
                >
                  {label}
                </button>
              ))}
              <div className="mx-1.5 h-3 w-px bg-border" />
              <span className="text-[10px] font-medium text-muted-foreground">叠加</span>
              {OVERLAY_INDICATORS.map(({ key, label, color }) => (
                <button
                  key={key}
                  onClick={() => toggleIndicator(key)}
                  className={`rounded border px-2 py-0.5 text-[11px] font-medium transition-all ${
                    activeIndicators.has(key)
                      ? "border-transparent text-white"
                      : "border-border bg-card text-muted-foreground hover:border-muted-foreground hover:text-foreground"
                  }`}
                  style={activeIndicators.has(key) ? { background: color, borderColor: color } : {}}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {/* Right: Intraday */}
          <div className="flex flex-1 flex-col overflow-y-auto">
            <IntradayCharts
              symbol={symbol}
              isDark={isDark}
              onCrosshairMove={syncToKLine}
              registerChart={registerIntraday}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
