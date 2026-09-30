import { formatTemplate } from "@/i18n";
import { ChartHoverCard } from "@/components/charts/ChartHoverCard";
import { ChipDistributionPanel } from "@/components/charts/ChipDistributionPanel";
import { buildKLineChartModel } from "@/components/charts/kline-model";
import {
  NativeStockChart,
  type NativeChartTooltipState,
  type NativeCrosshairValueState,
  type NativeVisibleRange,
} from "@/components/charts/NativeStockChart";
import { TECHNICAL_KLINE_PERIOD_STORAGE_KEY, parseBars } from "@/components/charts/technical-data";
import { changeRate, formatChartNumber, formatCompactVolume, formatHoverTime, formatSignedPercent, toneForRate } from "@/components/charts/technical-format";
import { MA_PERIODS, maDefinitions, type IndicatorKey, type MAPeriod, type Period, type TechnicalCopy } from "@/components/charts/technical-settings";
import { useNativeChartTheme } from "@/components/charts/useNativeChartTheme";
import { i18n, type AppLanguage } from "@/i18n";
import { getCandlesticks } from "@/lib/api";
import { useChartColors } from "@/lib/color-scheme";
import { KLineController } from "@/lib/kline-controller";
import { readStoredValue, writeStoredValue } from "@/lib/local-storage";
import { cn } from "@/lib/utils";
import { RefreshCw } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore
} from "react";

// ── K-line chart ──────────────────────────────────────────────────────────────

export function KLineChart({
  symbol,
  activeIndicators,
  activeMAPeriods,
  onToggleMA,
  copy,
  language,
  isDark,
}: {
  symbol: string;
  activeIndicators: Set<IndicatorKey>;
  activeMAPeriods: ReadonlySet<MAPeriod>;
  onToggleMA: (period: MAPeriod) => void;
  copy: TechnicalCopy;
  language: AppLanguage;
  isDark: boolean;
}) {
  const { upColor, downColor } = useChartColors();
  const theme = useNativeChartTheme(isDark, upColor, downColor);
  const [period, setPeriod] = useState<Period>(() =>
    readStoredValue(TECHNICAL_KLINE_PERIOD_STORAGE_KEY, ["1D", "1W", "1M"], "1D"),
  );
  const [controller] = useState(() => new KLineController(getCandlesticks));
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const matches = state.symbol === symbol && state.period === period;
  const loading = !matches || state.loading;
  const bars = useMemo(() => matches ? parseBars(state.bars) : [], [matches, state.bars]);
  const [visiblePriceRange, setVisiblePriceRange] = useState<{ min: number; max: number } | null>(null);
  useEffect(() => {
    writeStoredValue(TECHNICAL_KLINE_PERIOD_STORAGE_KEY, period);
    setVisiblePriceRange(null);
    controller.activate(symbol, period);
    return () => controller.dispose();
  }, [controller, period, symbol]);

  const chartModel = useMemo(
    () => buildKLineChartModel(bars, activeIndicators, activeMAPeriods, theme),
    [activeIndicators, activeMAPeriods, bars, theme],
  );
  const times = useMemo(() => bars.map((bar) => bar.time), [bars]);
  const formatCrosshairValueLabel = useCallback((state: NativeCrosshairValueState) => {
    if (state.paneId !== "price") return null;
    const rate = changeRate(state.value, bars[state.index - 1]?.close);
    const price = formatChartNumber(state.value, language);
    return rate == null ? price : `${price} ${formatSignedPercent(rate, language)}`;
  }, [bars, language]);
  const renderTooltip = useCallback((state: NativeChartTooltipState) => {
    const bar = bars[state.index];
    if (!bar) return null;
    const rate = changeRate(bar.close, bars[state.index - 1]?.close);
    const lineRate = state.paneId === "price" ? changeRate(state.paneValue, bars[state.index - 1]?.close) : null;
    if (state.paneId && state.paneId !== "price") {
      const metrics = chartModel.series.filter((series) => series.paneId === state.paneId && series.type !== "candlestick").map((series) => {
        const point = series.data.find((point) => point.time === bar.time);
        const value = point && "value" in point ? point.value : null;
        return { label: series.title ?? series.id, value: formatChartNumber(value, language) };
      });
      return <ChartHoverCard title={formatHoverTime(bar.time, language)} metrics={metrics} />;
    }
    return (
      <ChartHoverCard
        title={formatHoverTime(bar.time, language)}
        metrics={[
          { label: copy.changeRate, value: formatSignedPercent(rate, language), tone: toneForRate(rate) },
          { label: copy.lineChangeRate, value: formatSignedPercent(lineRate, language), tone: toneForRate(lineRate) },
          { label: copy.open, value: formatChartNumber(bar.open, language) },
          { label: copy.close, value: formatChartNumber(bar.close, language) },
          { label: copy.volume, value: formatCompactVolume(bar.volume, language) },
        ]}
      />
    );
  }, [bars, chartModel.series, copy.changeRate, copy.close, copy.lineChangeRate, copy.open, copy.volume, language]);

  const handleVisibleRangeChange = useCallback((range: NativeVisibleRange | null) => {
    setVisiblePriceRange(range?.price ?? null);
  }, []);

  return (
    <div className="technical-kline-content flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row lg:overflow-hidden">
      <div className="technical-chart-panel flex min-h-[520px] min-w-0 flex-1 flex-col bg-background lg:min-h-0">
        <div className="technical-kline-toolbar flex shrink-0 items-center gap-3 overflow-x-auto border-b border-border bg-background px-3 py-1">
          <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/70">
            {(["1D", "1W", "1M"] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`h-8 border-b-2 px-2.5 text-[11px] font-medium transition-colors ${period === p
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
              >
                {p === "1D" ? copy.daily : p === "1W" ? copy.weekly : copy.monthly}
              </button>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-1" role="group" aria-label={i18n[language].chart.maTitle}>
            {maDefinitions(theme).map(({ period: maPeriod, color }) => {
              const enabled = activeIndicators.has("MA") && activeMAPeriods.has(maPeriod);
              const alias = period === "1D" ? maPeriod === 120 ? i18n[language].chart.halfYear : maPeriod === 250 ? i18n[language].chart.year : "" : "";
              return <button key={maPeriod} type="button" aria-pressed={enabled} aria-label={`MA${maPeriod}`}
                title={i18n[language].chart.maHint}
                onClick={() => onToggleMA(maPeriod)}
                className={cn("flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] transition-colors", enabled ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50")}>
                <span className={cn("h-0.5 w-3", !enabled && "opacity-30")} style={{ background: color }} />
                <span className={cn(!enabled && "line-through opacity-60")}>MA{maPeriod}{alias ? ` · ${alias}` : ""}</span>
              </button>;
            })}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {loading && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <RefreshCw size={10} className="animate-spin" />{copy.loading}
              </span>
            )}
          </div>
        </div>
        {activeIndicators.has("MA") && bars.length > 0 && MA_PERIODS.some((value) => activeMAPeriods.has(value) && bars.length < value) && (
          <p role="status" className="shrink-0 border-b border-border px-3 py-1 text-[10px] text-muted-foreground">
            {formatTemplate(i18n[language].chart.maInsufficient, { lines: MA_PERIODS.filter((value) => activeMAPeriods.has(value) && bars.length < value).map((value) => `MA${value}`).join(" / ") })}
          </p>
        )}
        <NativeStockChart
          times={times}
          panes={chartModel.panes}
          series={chartModel.series}
          theme={theme}
          fitKey={`${symbol}:${period}`}
          primaryRangeSeriesId="candles"
          formatCrosshairValueLabel={formatCrosshairValueLabel}
          onVisibleRangeChange={handleVisibleRangeChange}
          onNearStart={controller.loadMore}
          onNearEnd={controller.refresh}
          renderTooltip={renderTooltip}
          enableTouchCrosshairHaptics
          className="technical-native-chart min-h-[440px] flex-1 lg:min-h-0"
        />
      </div>
      <ChipDistributionPanel bars={bars} period={period} language={language} loading={loading} visibleRange={visiblePriceRange} />
    </div>
  );
}
