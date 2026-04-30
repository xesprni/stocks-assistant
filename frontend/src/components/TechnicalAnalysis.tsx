/**
 * TechnicalAnalysis.tsx
 * Built for lightweight-charts v5 (addSeries + pane system).
 *
 * Layout:
 *  - Left sidebar: symbol list
 *  - Main area: Tab switch (分时 / K线)
 *  - K-line mode: chart | indicator selector | indicator display | chip distribution
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
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
  type ChipBar,
} from "@/lib/indicators";
import { useChartColors } from "@/lib/color-scheme";

// ── Types ─────────────────────────────────────────────────────────────────────

type Period = "1D" | "1W" | "1M";
type SubIndicatorKey = "MACD" | "KDJ" | "RSI" | "CCI" | "WR" | "DMI" | "OSC";
type OverlayIndicatorKey = "BOLL" | "BBIBOLL" | "EMA";
type IndicatorKey = SubIndicatorKey | OverlayIndicatorKey;

interface Props {
  symbol: string;
  onSymbolChange: (s: string) => void;
  onBack?: () => void;
}

// ── Theme ─────────────────────────────────────────────────────────────────────

function makeTheme(isDark: boolean, upColor: string, downColor: string) {
  return isDark ? {
    bg:     "#131722",
    text:   "#d1d5db",
    grid:   "rgba(255,255,255,0.04)",
    border: "#2a2e39",
    up:     upColor,
    down:   downColor,
    blue:   "#2962ff",
    orange: "#ff6d00",
    purple: "#9c27b0",
    yellow: "#f57f17",
  } : {
    bg:     "#ffffff",
    text:   "#1e222d",
    grid:   "rgba(0,0,0,0.06)",
    border: "#dde1eb",
    up:     upColor,
    down:   downColor,
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
      <div className="flex items-center gap-1.5 border-b border-border bg-muted/30 px-3 py-2">
        <TrendingUp size={13} className="text-primary" />
        <span className="text-[11px] font-semibold tracking-wide text-foreground">自选股</span>
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
            {CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>
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
 * Pane 0: Candlestick + MA5/10/20 + optional overlay (BOLL / BBIBOLL / EMA)
 * Pane 1: Volume histogram
 * Pane 2+: Dynamic indicator panes
 */
function KLineChart({
  symbol,
  activeIndicators,
  isDark,
  onCrosshairMove,
  registerChart,
  onParsedBars,
  onVisibleRangeChange,
}: {
  symbol: string;
  activeIndicators: Set<IndicatorKey>;
  isDark: boolean;
  onCrosshairMove: (params: MouseEventParams) => void;
  registerChart: (chart: IChartApi | null, primarySeries: ISeriesApi<SeriesType> | null) => void;
  onParsedBars: (bars: ReturnType<typeof parseBars>) => void;
  onVisibleRangeChange: (range: { min: number; max: number } | null) => void;
}) {
  const { upColor, downColor } = useChartColors();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const ma5Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ma10Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ma20Ref = useRef<ISeriesApi<"Line"> | null>(null);

  const [period, setPeriod] = useState<Period>("1D");
  const [loading, setLoading] = useState(false);

  const indicatorSeriesRef = useRef<Map<IndicatorKey, ISeriesApi<SeriesType>[]>>(new Map());
  const overlaySeriesRef = useRef<ISeriesApi<SeriesType>[]>([]);
  const symbolRef = useRef(symbol);
  const periodRef = useRef(period);
  const isDarkRef = useRef(isDark);
  const upColorRef = useRef(upColor);
  const downColorRef = useRef(downColor);

  // Keep refs in sync with props/state
  useEffect(() => { symbolRef.current = symbol; }, [symbol]);
  useEffect(() => { periodRef.current = period; }, [period]);
  useEffect(() => { isDarkRef.current = isDark; }, [isDark]);
  useEffect(() => { upColorRef.current = upColor; }, [upColor]);
  useEffect(() => { downColorRef.current = downColor; }, [downColor]);

  const parsedRef = useRef<ReturnType<typeof parseBars>>([]);
  const dataCountRef = useRef(200);
  const isLoadingMoreRef = useRef(false);
  const allDataLoadedRef = useRef(false);

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const T = makeTheme(isDark, upColor, downColor);
    const height = containerRef.current.clientHeight || 400;
    const chart = createChart(containerRef.current, {
      ...chartOpts(height, T),
      width: containerRef.current.clientWidth,
    });
    chartRef.current = chart;

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: T.up,
      downColor: T.down,
      borderUpColor: T.up,
      borderDownColor: T.down,
      wickUpColor: T.up,
      wickDownColor: T.down,
    });
    candleRef.current = candle;

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

    const vol = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      color: T.blue + "55",
    }, 1);
    volRef.current = vol;
    chart.panes()[1]?.setStretchFactor(0.25);

    registerChart(chart, candle);
    chart.subscribeCrosshairMove(onCrosshairMove);

    // Visible price range sync for chip distribution + load more on scroll left
    const ts = chart.timeScale();
    ts.subscribeVisibleLogicalRangeChange((logicalRange: { from: number; to: number } | null) => {
      if (!logicalRange) return;
      const ts = chart.timeScale();

      // Sync visible price range
      const vr = ts.getVisibleRange();
      if (vr && candleRef.current) {
        const bars = parsedRef.current;
        if (bars.length === 0) { onVisibleRangeChange(null); }
        else {
          const fromT = vr.from as number;
          const toT = vr.to as number;
          const visBars = bars.filter((b) => (b.time as number) >= fromT && (b.time as number) <= toT);
          if (visBars.length === 0) { onVisibleRangeChange(null); }
          else {
            let lo = Infinity, hi = -Infinity;
            for (const b of visBars) { if (b.low < lo) lo = b.low; if (b.high > hi) hi = b.high; }
            onVisibleRangeChange({ min: lo, max: hi });
          }
        }
      } else {
        onVisibleRangeChange(null);
      }

      // Load more when scrolled near left edge
      if (
        logicalRange.from < 5 &&
        !isLoadingMoreRef.current &&
        !allDataLoadedRef.current &&
        parsedRef.current.length > 0
      ) {
        isLoadingMoreRef.current = true;
        const currentCount = dataCountRef.current;
        const nextCount = currentCount + 200;
        const currentSymbol = symbolRef.current;
        const currentPeriod = periodRef.current;
        const T = makeTheme(isDarkRef.current, upColorRef.current, downColorRef.current);

        getCandlesticks(currentSymbol, currentPeriod, nextCount)
          .then((res) => {
            const newBars = parseBars(res.bars);
            if (newBars.length <= currentCount) {
              allDataLoadedRef.current = true;
              return;
            }
            parsedRef.current = newBars;
            dataCountRef.current = nextCount;
            onParsedBars(newBars);

            const closes = newBars.map((b) => b.close);
            candleRef.current?.setData(newBars.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close })));
            volRef.current?.setData(newBars.map((b) => ({
              time: b.time, value: b.volume,
              color: b.close >= b.open ? T.up + "55" : T.down + "55",
            })));
            ma5Ref.current?.setData(newBars.map((b, i) => { const v = calcMA(closes, 5)[i]; return v != null ? { time: b.time, value: v } : null; }).filter((v): v is LineData => v != null));
            ma10Ref.current?.setData(newBars.map((b, i) => { const v = calcMA(closes, 10)[i]; return v != null ? { time: b.time, value: v } : null; }).filter((v): v is LineData => v != null));
            ma20Ref.current?.setData(newBars.map((b, i) => { const v = calcMA(closes, 20)[i]; return v != null ? { time: b.time, value: v } : null; }).filter((v): v is LineData => v != null));
          })
          .catch(() => {})
          .finally(() => { isLoadingMoreRef.current = false; });
      }
    });

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
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
      overlaySeriesRef.current = [];
      registerChart(null, null);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Rebuild indicator panes + overlays
  const rebuildIndicators = useCallback(() => {
    const chart = chartRef.current;
    if (!chart || parsedRef.current.length === 0) return;

    const T = makeTheme(isDark, upColor, downColor);
    const parsed = parsedRef.current;
    const closes = parsed.map((b) => b.close);
    const highs = parsed.map((b) => b.high);
    const lows = parsed.map((b) => b.low);

    // Remove existing indicator + overlay series
    for (const seriesList of indicatorSeriesRef.current.values()) {
      for (const s of seriesList) {
        try { chart.removeSeries(s); } catch { /* ignore */ }
      }
    }
    indicatorSeriesRef.current.clear();

    for (const s of overlaySeriesRef.current) {
      try { chart.removeSeries(s); } catch { /* ignore */ }
    }
    overlaySeriesRef.current = [];

    // Remove indicator panes (keep pane 0 and 1)
    while (chart.panes().length > 2) {
      chart.removePane(chart.panes().length - 1);
    }

    // ── Overlay indicators on pane 0 ──
    if (activeIndicators.has("BOLL")) {
      const boll = calcBollinger(closes);
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
        overlaySeriesRef.current.push(s);
      });
    }

    if (activeIndicators.has("BBIBOLL")) {
      const bbiboll = calcBBIBOLL(closes);
      (["upper", "middle", "lower"] as const).forEach((k, idx) => {
        const colors = [T.orange, T.blue, T.orange];
        const s = chart.addSeries(LineSeries, {
          color: colors[idx],
          lineWidth: 1,
          lineStyle: k === "middle" ? LineStyle.Solid : LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        s.setData(
          parsed
            .map((b, i) => bbiboll[i] != null ? { time: b.time, value: bbiboll[i]![k] } : null)
            .filter((v): v is LineData => v != null)
        );
        overlaySeriesRef.current.push(s);
      });
    }

    if (activeIndicators.has("EMA")) {
      const ema12 = calcEMAValues(closes, 12);
      const ema26 = calcEMAValues(closes, 26);
      const ema12S = chart.addSeries(LineSeries, {
        color: T.orange, lineWidth: 1, priceLineVisible: false,
        lastValueVisible: false, crosshairMarkerVisible: false, title: "EMA12",
      });
      const ema26S = chart.addSeries(LineSeries, {
        color: T.purple, lineWidth: 1, priceLineVisible: false,
        lastValueVisible: false, crosshairMarkerVisible: false, title: "EMA26",
      });
      ema12S.setData(parsed.map((b, i) => ema12[i] != null ? { time: b.time, value: ema12[i]! } : null).filter((v): v is LineData => v != null));
      ema26S.setData(parsed.map((b, i) => ema26[i] != null ? { time: b.time, value: ema26[i]! } : null).filter((v): v is LineData => v != null));
      overlaySeriesRef.current.push(ema12S, ema26S);
    }

    // ── Sub-indicator panes ──
    let paneIdx = 2;
    for (const key of ["MACD", "KDJ", "RSI", "CCI", "WR", "DMI", "OSC"] as SubIndicatorKey[]) {
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
      } else if (key === "DMI") {
        const dmi = calcDMI(highs, lows, closes);
        const pdiS = chart.addSeries(LineSeries, { color: T.blue, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: "PDI" }, paneIdx);
        const mdiS = chart.addSeries(LineSeries, { color: T.orange, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: "MDI" }, paneIdx);
        const adxS = chart.addSeries(LineSeries, { color: T.purple, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: "ADX" }, paneIdx);
        const adxrS = chart.addSeries(LineSeries, { color: T.yellow, lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, title: "ADXR" }, paneIdx);
        pdiS.setData(parsed.map((b, i) => dmi[i] ? { time: b.time, value: dmi[i]!.pdi } : null).filter((v): v is LineData => v != null));
        mdiS.setData(parsed.map((b, i) => dmi[i] ? { time: b.time, value: dmi[i]!.mdi } : null).filter((v): v is LineData => v != null));
        adxS.setData(parsed.map((b, i) => dmi[i] ? { time: b.time, value: dmi[i]!.adx } : null).filter((v): v is LineData => v != null));
        adxrS.setData(parsed.map((b, i) => dmi[i] ? { time: b.time, value: dmi[i]!.adxr } : null).filter((v): v is LineData => v != null));
        seriesList.push(pdiS, mdiS, adxS, adxrS);
      } else if (key === "OSC") {
        const osc = calcOSC(closes);
        const histS = chart.addSeries(HistogramSeries, { priceLineVisible: false }, paneIdx);
        const difS = chart.addSeries(LineSeries, {
          color: T.blue, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: "DIF",
        }, paneIdx);
        const deaS = chart.addSeries(LineSeries, {
          color: T.orange, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: "DEA",
        }, paneIdx);
        histS.setData(
          parsed.map((b, i) => osc[i] ? {
            time: b.time, value: osc[i]!.osc,
            color: osc[i]!.osc >= 0 ? T.up + "99" : T.down + "99",
          } : null).filter(v => v !== null) as HistogramData[]
        );
        difS.setData(parsed.map((b, i) => osc[i] ? { time: b.time, value: osc[i]!.dif } : null).filter((v): v is LineData => v != null));
        deaS.setData(parsed.map((b, i) => osc[i] ? { time: b.time, value: osc[i]!.dea } : null).filter((v): v is LineData => v != null));
        seriesList.push(histS, difS, deaS);
      }

      chart.panes()[paneIdx]?.setStretchFactor(0.4);
      indicatorSeriesRef.current.set(key, seriesList);
      paneIdx++;
    }
  }, [activeIndicators, isDark]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    rebuildIndicators();
  }, [rebuildIndicators]);

  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions(chartLayoutOpts(makeTheme(isDark, upColor, downColor)));
    }
  }, [isDark, upColor, downColor]);

  useEffect(() => {
    if (!symbol) return;
    // Reset load-more state on symbol/period change
    dataCountRef.current = 200;
    allDataLoadedRef.current = false;
    setLoading(true);
    getCandlesticks(symbol, period)
      .then((res) => {
        const parsed = parseBars(res.bars);
        parsedRef.current = parsed;
        onParsedBars(parsed);
        const closes = parsed.map((b) => b.close);

        candleRef.current?.setData(
          parsed.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close }))
        );
        volRef.current?.setData(
          parsed.map((b) => ({
            time: b.time, value: b.volume,
            color: b.close >= b.open ? makeTheme(isDark, upColor, downColor).up + "55" : makeTheme(isDark, upColor, downColor).down + "55",
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
    <div className="flex flex-1 flex-col bg-background">
      <div className="flex shrink-0 items-center gap-0.5 border-b border-border bg-card px-3 py-1.5">
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
      <div ref={containerRef} className="min-h-0 flex-1" />
    </div>
  );
}

// ── Intraday chart ────────────────────────────────────────────────────────────

function IntradayCharts({
  symbol,
  isDark,
}: {
  symbol: string;
  isDark: boolean;
}) {
  const { upColor, downColor } = useChartColors();
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
    const T = makeTheme(isDark, upColor, downColor);
    const chart = createChart(containerRef.current, {
      ...chartOpts(500, T),
      width: containerRef.current.clientWidth,
    });
    chartRef.current = chart;

    priceSeriesRef.current = chart.addSeries(LineSeries, {
      color: T.blue, lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
    });
    avgSeriesRef.current = chart.addSeries(LineSeries, {
      color: T.orange, lineWidth: 1, lineStyle: LineStyle.Dashed,
      priceLineVisible: false, lastValueVisible: false,
    });

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
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions(chartLayoutOpts(makeTheme(isDark, upColor, downColor)));
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
        volSeriesRef.current?.setData(bars.map((b) => ({ time: b.time, value: b.volume, color: makeTheme(isDark, upColor, downColor).blue + "66" })) as HistogramData[]);
        macdSeriesRef.current?.setData(bars.map((b, i) => macd[i] ? { time: b.time, value: macd[i]!.macd } : null).filter((v): v is LineData => v != null));
        signalSeriesRef.current?.setData(bars.map((b, i) => macd[i] ? { time: b.time, value: macd[i]!.signal } : null).filter((v): v is LineData => v != null));
        histSeriesRef.current?.setData(
          bars.map((b, i) => macd[i] ? {
            time: b.time, value: macd[i]!.histogram,
            color: macd[i]!.histogram >= 0 ? makeTheme(isDark, upColor, downColor).up + "99" : makeTheme(isDark, upColor, downColor).down + "99",
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
    <div className="flex flex-1 flex-col bg-background">
      <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-1.5">
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
      <div ref={containerRef} className="w-full flex-1" />
    </div>
  );
}

// ── Chip Distribution Panel ───────────────────────────────────────────────────

function ChipDistributionPanel({
  bars,
  isDark,
  visibleRange,
}: {
  bars: ReturnType<typeof parseBars>;
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
    <div className="flex h-full w-36 shrink-0 flex-col border-l border-border bg-card">
      <div className="shrink-0 border-b border-border px-2 py-1.5">
        <div className="text-[11px] font-semibold">筹码分布</div>
      </div>

      {/* Profit ratio */}
      <div className="shrink-0 border-b border-border px-2 py-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">获利比例</span>
          <span
            className="text-sm font-bold"
            style={{ color: result.profitRatio >= 50 ? profitColor : lossColor }}
          >
            {result.profitRatio.toFixed(1)}%
          </span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.min(100, result.profitRatio)}%`,
              background: `linear-gradient(90deg, ${profitColor}, ${profitColor}88)`,
            }}
          />
        </div>
        <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
          <span style={{ color: lossColor }}>套牢 {(100 - result.profitRatio).toFixed(0)}%</span>
          <span style={{ color: profitColor }}>获利 {result.profitRatio.toFixed(0)}%</span>
        </div>
      </div>

      {/* Chip bars - positioned to match chart price axis */}
      <div className="relative flex-1 overflow-hidden">
        {/* Current price line */}
        {lastClose >= priceMin && lastClose <= priceMax && (
          <div
            className="absolute left-0 right-0 border-t border-dashed border-primary/50"
            style={{ bottom: `${((lastClose - priceMin) / priceSpan) * 100}%` }}
          >
            <span className="absolute -top-2.5 right-1 text-[8px] font-mono text-primary">
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
              className="absolute left-1 right-8 flex items-center"
              style={{ bottom: `${bottomPct}%`, height: `${barHeight}%` }}
            >
              <div
                className="h-full rounded-sm"
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
  { key: "MACD", label: "MACD", color: "#2962ff" },
  { key: "KDJ",  label: "KDJ",  color: "#ff6d00" },
  { key: "RSI",  label: "RSI",  color: "#9c27b0" },
  { key: "CCI",  label: "CCI",  color: "#00897b" },
  { key: "WR",   label: "WR",   color: "#c62828" },
  { key: "DMI",  label: "DMI",  color: "#1565c0" },
  { key: "OSC",  label: "OSC",  color: "#e65100" },
];
const OVERLAY_INDICATORS: { key: OverlayIndicatorKey; label: string; color: string }[] = [
  { key: "BOLL",    label: "BOLL",    color: "#f57f17" },
  { key: "BBIBOLL", label: "BBIBOLL", color: "#ff6d00" },
  { key: "EMA",     label: "EMA",     color: "#9c27b0" },
];

// ── Main ──────────────────────────────────────────────────────────────────────

export default function TechnicalAnalysis({ symbol, onSymbolChange, onBack }: Props) {
  const isDark = useIsDark();
  const [displayName, setDisplayName] = useState("");
  const [activeIndicators, setActiveIndicators] = useState<Set<IndicatorKey>>(new Set());
  const [activeTab, setActiveTab] = useState<"kline" | "intraday">("kline");
  const [parsedBars, setParsedBars] = useState<ReturnType<typeof parseBars>>([]);
  const [visiblePriceRange, setVisiblePriceRange] = useState<{ min: number; max: number } | null>(null);

  const klineChartRef = useRef<IChartApi | null>(null);
  const klinePrimaryRef = useRef<ISeriesApi<SeriesType> | null>(null);

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

        {/* Main content */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Tab switch: 分时 / K线 */}
          <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-4 py-1">
            <div className="flex rounded-md border border-border/80 bg-muted/40 p-0.5">
              <button
                onClick={() => setActiveTab("kline")}
                className={`rounded-sm px-3 py-1 text-[11px] font-medium transition-all ${
                  activeTab === "kline"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                K线
              </button>
              <button
                onClick={() => setActiveTab("intraday")}
                className={`rounded-sm px-3 py-1 text-[11px] font-medium transition-all ${
                  activeTab === "intraday"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                分时
              </button>
            </div>
          </div>

          {activeTab === "kline" ? (
            <div className="flex flex-1 overflow-hidden">
              {/* Left: indicator selector + chart */}
              <div className="flex flex-1 flex-col overflow-hidden">
                {/* Indicator selector (above chart) */}
                <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border bg-muted/40 px-3 py-1.5">
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

                  {/* Active indicator tags inline */}
                  {(activeSubLabels.length > 0 || activeOverlayLabels.length > 0) && (
                    <>
                      <div className="mx-1.5 h-3 w-px bg-border" />
                      {activeOverlayLabels.map(({ key, label, color }) => (
                        <span key={key} className="flex items-center gap-1 rounded-md bg-muted/50 px-1.5 py-0.5 text-[10px]">
                          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                          <span className="font-medium">{label}</span>
                        </span>
                      ))}
                      {activeSubLabels.map(({ key, label, color }) => (
                        <span key={key} className="flex items-center gap-1 rounded-md bg-muted/50 px-1.5 py-0.5 text-[10px]">
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
                  isDark={isDark}
                  onCrosshairMove={() => {}}
                  registerChart={registerKLine}
                  onParsedBars={setParsedBars}
                  onVisibleRangeChange={setVisiblePriceRange}
                />
              </div>

              {/* Right: Chip distribution */}
              {parsedBars.length > 0 && (
                <ChipDistributionPanel bars={parsedBars} isDark={isDark} visibleRange={visiblePriceRange} />
              )}
            </div>
          ) : (
            /* Intraday mode */
            <IntradayCharts symbol={symbol} isDark={isDark} />
          )}
        </div>
      </div>
    </div>
  );
}
