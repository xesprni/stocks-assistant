import {
  NativeStockChart,
  type NativeChartSeries,
  type NativeChartTheme,
} from "@/components/charts/NativeStockChart";
import { useErrorToast } from "@/components/common/Toast";
import { DETAIL_CHART_RANGES, formatCompactNumeric, parseNumber, toneClass, type DetailChartRange, type Tone } from "@/components/dashboard/model";
import { InlineState } from "@/components/dashboard/shared";
import { getMessages, localeFor, type AppLanguage } from "@/i18n";
import {
  getCandlesticks,
  getIntraday
} from "@/lib/api";
import { useChartColors } from "@/lib/color-scheme";
import { cn } from "@/lib/utils";
import type {
  CandlestickItem,
  DashboardWatchlistRow,
  IntradayItem
} from "@/types/app";
import {
  Loader2
} from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";

export type ParsedDetailChartBar = {
  time: number;
  price: number;
  volume: number;
  open?: number;
};

export function detailRangeLabel(range: DetailChartRange, language: AppLanguage) {
  const labels: Record<DetailChartRange, string> = getMessages(language).dashboard.chartRanges;
  return labels[range];
}

export function ytdDailyCount() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const elapsedDays = Math.ceil((now.getTime() - start.getTime()) / 86_400_000) + 5;
  return Math.min(260, Math.max(30, elapsedDays));
}

export function detailChartRequest(range: DetailChartRange): { kind: "intraday" } | { kind: "candlestick"; period: "1D" | "1W" | "1M"; count: number } {
  if (range === "1D") return { kind: "intraday" };
  if (range === "5D") return { kind: "candlestick", period: "1D", count: 5 };
  if (range === "1M") return { kind: "candlestick", period: "1D", count: 30 };
  if (range === "6M") return { kind: "candlestick", period: "1D", count: 126 };
  if (range === "YTD") return { kind: "candlestick", period: "1D", count: ytdDailyCount() };
  if (range === "1Y") return { kind: "candlestick", period: "1D", count: 252 };
  if (range === "5Y") return { kind: "candlestick", period: "1W", count: 260 };
  return { kind: "candlestick", period: "1M", count: 600 };
}

export function cssHsl(styles: CSSStyleDeclaration, name: string, alpha?: number) {
  const value = styles.getPropertyValue(name).trim();
  if (!value) return alpha == null ? "transparent" : `rgb(0 0 0 / ${alpha})`;
  return alpha == null ? `hsl(${value})` : `hsl(${value} / ${alpha})`;
}

export function useIsDarkTheme() {
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

export function useDashboardChartTheme(): NativeChartTheme {
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

export function colorWithAlpha(color: string, alpha: number) {
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

export function parseDetailIntradayBars(bars: IntradayItem[]): ParsedDetailChartBar[] {
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

export function parseDetailCandlestickBars(bars: CandlestickItem[]): ParsedDetailChartBar[] {
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

export function formatNumberValue(value: number | null | undefined, language: AppLanguage, maximumFractionDigits = 2) {
  if (value == null || !Number.isFinite(value)) return "-";
  return value.toLocaleString(localeFor(language), { maximumFractionDigits });
}

export function formatSignedPercentValue(value: number | null | undefined, language: AppLanguage) {
  if (value == null || !Number.isFinite(value)) return "-";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const absolute = Math.abs(value).toLocaleString(localeFor(language), { maximumFractionDigits: 2 });
  return `${sign}${absolute}%`;
}

export function chartChangePercent(bars: ParsedDetailChartBar[], row: DashboardWatchlistRow, range: DetailChartRange) {
  const rowRate = range === "1D" ? parseNumber(row.change_rate) : null;
  if (rowRate !== null) return rowRate;
  const first = bars[0]?.price;
  const latest = bars[bars.length - 1]?.price;
  if (!first || latest == null) return null;
  return ((latest - first) / first) * 100;
}

export const WatchlistSymbolChart = memo(function WatchlistSymbolChart({ language, row }: { language: AppLanguage; row: DashboardWatchlistRow }) {
  const [range, setRange] = useState<DetailChartRange>("1D");
  const [bars, setBars] = useState<ParsedDetailChartBar[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const theme = useDashboardChartTheme();
  const labels = getMessages(language).dashboard.chart;
  useErrorToast(error, row.symbol);

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
  const prevClose = parseNumber(row.prev_close);
  const times = useMemo(() => bars.map((bar) => bar.time), [bars]);
  const priceCenter = range === "1D" && prevClose != null && prevClose > 0 ? prevClose : undefined;
  const panes = useMemo(() => [
    { id: "price", label: labels.price.toUpperCase(), heightWeight: 3, centerValue: priceCenter },
    { id: "volume", label: "VOL", heightWeight: 0.72 },
  ], [labels.price, priceCenter]);
  const series = useMemo<NativeChartSeries[]>(() => {
    if (bars.length === 0) return [];
    const lineColor = tone === "up" ? theme.up : tone === "down" ? theme.down : theme.blue;
    const next: NativeChartSeries[] = [];
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
    // 只依赖实际用到的 theme 字段，避免 theme 对象引用变化时不必要重建。
  }, [bars, labels.prevClose, labels.price, prevClose, theme.up, theme.down, theme.blue, theme.mutedText, tone]);

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
});
