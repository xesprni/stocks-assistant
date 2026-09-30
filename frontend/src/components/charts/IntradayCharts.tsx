import { formatTemplate } from "@/i18n";
import { ChartHoverCard } from "@/components/charts/ChartHoverCard";
import { buildIntradayChartModel } from "@/components/charts/intraday-model";
import {
  NativeStockChart,
  type NativeChartTooltipState,
  type NativeCrosshairValueState
} from "@/components/charts/NativeStockChart";
import {
  clampIntradayRefreshSeconds,
  INTRADAY_REFRESH_STORAGE_KEY,
  loadStoredIntradayRefreshSeconds,
  mergeIntradayBars,
  parseIntraday,
  type ParsedIntradayBar,
} from "@/components/charts/technical-data";
import { changeRate, formatChartNumber, formatHoverTime, formatSignedPercent, toneForRate } from "@/components/charts/technical-format";
import { type TechnicalCopy } from "@/components/charts/technical-settings";
import { useNativeChartTheme } from "@/components/charts/useNativeChartTheme";
import { localeFor, type AppLanguage } from "@/i18n";
import { getIntraday } from "@/lib/api";
import { useChartColors } from "@/lib/color-scheme";
import { RefreshCw } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

export function IntradayCharts({
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
  const [prevClose, setPrevClose] = useState<number | null>(null);
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

  const chartModel = useMemo(() => buildIntradayChartModel(bars, theme, prevClose), [bars, theme, prevClose]);
  const times = useMemo(() => bars.map((bar) => bar.time), [bars]);
  const changeRateBase = prevClose ?? bars[0]?.price;
  const formatCrosshairValueLabel = useCallback((state: NativeCrosshairValueState) => {
    if (state.paneId !== "price") return null;
    const rate = changeRate(state.value, changeRateBase);
    const price = formatChartNumber(state.value, language);
    return rate == null ? price : `${price} ${formatSignedPercent(rate, language)}`;
  }, [changeRateBase, language]);
  const renderTooltip = useCallback((state: NativeChartTooltipState) => {
    const bar = bars[state.index];
    if (!bar) return null;
    const rate = changeRate(bar.price, changeRateBase);
    const lineRate = state.paneId === "price" ? changeRate(state.paneValue, changeRateBase) : null;
    return (
      <ChartHoverCard
        title={formatHoverTime(bar.time, language, true)}
        metrics={[
          { label: copy.price, value: formatChartNumber(bar.price, language) },
          { label: copy.changeRate, value: formatSignedPercent(rate, language), tone: toneForRate(rate) },
          { label: copy.lineChangeRate, value: formatSignedPercent(lineRate, language), tone: toneForRate(lineRate) },
        ]}
      />
    );
  }, [bars, changeRateBase, copy.changeRate, copy.lineChangeRate, copy.price, language]);

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
        if (mode === "full" && res.prev_close) {
          const parsed = parseFloat(res.prev_close);
          setPrevClose(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
        }
        setLastUpdated(new Date().toLocaleTimeString(localeFor(language), {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }));
      })
      .catch(() => { })
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
    setPrevClose(null);
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
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-background px-3 py-1.5">
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
        formatCrosshairValueLabel={formatCrosshairValueLabel}
        renderTooltip={renderTooltip}
        className="technical-native-chart min-h-[500px] w-full flex-1 lg:min-h-0"
      />
    </div>
  );
}
