import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Loader2, RefreshCw } from "lucide-react";

import {
  NativeStockChart,
  type NativeChartSeries,
  type NativeChartTheme,
} from "@/components/charts/NativeStockChart";
import { useErrorToast } from "@/components/common/Toast";
import { Button } from "@/components/ui/button";
import { getCapitalFlow } from "@/lib/api";
import { useChartColors } from "@/lib/color-scheme";
import { localeFor, type AppLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { CapitalFlowItem } from "@/types/app";

type ParsedCapitalFlowPoint = {
  time: number;
  inflow: number;
};

type Tone = "up" | "down" | "flat";

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

function useCapitalFlowChartTheme(): NativeChartTheme {
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
      background: cssHsl(styles, "--background", isDark ? 0.82 : 0.72),
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

function parseNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCapitalFlow(lines: CapitalFlowItem[]): ParsedCapitalFlowPoint[] {
  return lines
    .map((line): ParsedCapitalFlowPoint | null => {
      const inflow = parseNumber(line.inflow);
      if (inflow === null) return null;
      return { time: line.timestamp, inflow };
    })
    .filter((line): line is ParsedCapitalFlowPoint => line !== null)
    .sort((a, b) => a.time - b.time);
}

function formatSignedCompact(value: number | null | undefined, language: AppLanguage) {
  if (value == null || !Number.isFinite(value)) return "-";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const formatted = Math.abs(value).toLocaleString(localeFor(language), {
    maximumFractionDigits: 2,
    notation: "compact",
  });
  return `${sign}${formatted}`;
}

function formatTime(value: number | null, language: AppLanguage) {
  if (!value) return "";
  return new Date(value * 1000).toLocaleTimeString(localeFor(language), {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function toneFor(value: number | null | undefined): Tone {
  if (value == null || value === 0) return "flat";
  return value > 0 ? "up" : "down";
}

function toneClass(tone: Tone) {
  if (tone === "up") return "text-[var(--color-up)]";
  if (tone === "down") return "text-[var(--color-down)]";
  return "text-muted-foreground";
}

function MiniMetric({
  label,
  tone,
  value,
}: {
  label: string;
  tone?: Tone;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-md bg-muted/20 px-2.5 py-2">
      <p className="truncate text-[10px] text-muted-foreground">{label}</p>
      <p className={cn("mt-1 truncate text-sm font-semibold tabular-nums", tone ? toneClass(tone) : undefined)}>
        {value}
      </p>
    </div>
  );
}

export function CapitalFlowChart({
  chartClassName,
  className,
  language,
  symbol,
}: {
  chartClassName?: string;
  className?: string;
  language: AppLanguage;
  symbol: string;
}) {
  const labels = language === "en"
    ? {
      title: "Capital flow",
      subtitle: "Longbridge intraday net inflow",
      latest: "Latest",
      high: "High",
      low: "Low",
      empty: "No capital flow data",
      loading: "Loading capital flow",
      refresh: "Refresh capital flow",
      updated: "Updated",
      netInflow: "Net inflow",
      zero: "Zero",
    }
    : {
      title: "资金流向",
      subtitle: "长桥当日资金净流入时序",
      latest: "最新净流入",
      high: "盘中高点",
      low: "盘中低点",
      empty: "暂无资金流向数据",
      loading: "加载资金流向中",
      refresh: "刷新资金流向",
      updated: "更新",
      netInflow: "净流入",
      zero: "零轴",
    };
  const theme = useCapitalFlowChartTheme();
  const requestSeqRef = useRef(0);
  const [points, setPoints] = useState<ParsedCapitalFlowPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");
  useErrorToast(error, labels.title);

  const load = useCallback((signal?: AbortSignal) => {
    const requestSymbol = symbol.trim();
    if (!requestSymbol) {
      setPoints([]);
      setError("");
      setLoading(false);
      return;
    }

    const requestId = requestSeqRef.current + 1;
    requestSeqRef.current = requestId;
    setLoading(true);
    setError("");

    getCapitalFlow(requestSymbol, signal ? { signal } : undefined)
      .then((payload) => {
        if (requestSeqRef.current !== requestId) return;
        const nextPoints = parseCapitalFlow(payload.lines);
        setPoints(nextPoints);
        setLastUpdated(formatTime(nextPoints[nextPoints.length - 1]?.time ?? null, language));
      })
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        if (requestSeqRef.current !== requestId) return;
        setError(caught instanceof Error ? caught.message : labels.empty);
        setPoints([]);
        setLastUpdated("");
      })
      .finally(() => {
        if (signal?.aborted) return;
        if (requestSeqRef.current === requestId) setLoading(false);
      });
  }, [labels.empty, language, symbol]);

  useEffect(() => {
    const controller = new AbortController();
    setPoints([]);
    setLastUpdated("");
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const latest = points[points.length - 1]?.inflow ?? null;
  const high = points.length > 0 ? Math.max(...points.map((point) => point.inflow)) : null;
  const low = points.length > 0 ? Math.min(...points.map((point) => point.inflow)) : null;
  const latestTone = toneFor(latest);
  const times = useMemo(() => points.map((point) => point.time), [points]);
  const panes = useMemo(() => [{ id: "flow", label: labels.netInflow.toUpperCase(), heightWeight: 1 }], [labels.netInflow]);
  const series = useMemo<NativeChartSeries[]>(() => {
    if (points.length === 0) return [];
    return [
      {
        id: "flow-bars",
        paneId: "flow",
        type: "histogram",
        title: labels.netInflow,
        baseline: 0,
        data: points.map((point) => ({
          time: point.time,
          value: point.inflow,
          color: colorWithAlpha(point.inflow >= 0 ? theme.up : theme.down, 0.42),
        })),
      },
      {
        id: "zero",
        paneId: "flow",
        type: "line",
        title: labels.zero,
        color: theme.mutedText,
        dashed: true,
        lineWidth: 1,
        data: points.map((point) => ({ time: point.time, value: 0 })),
      },
      {
        id: "flow-line",
        paneId: "flow",
        type: "line",
        title: labels.netInflow,
        color: latestTone === "down" ? theme.down : latestTone === "up" ? theme.up : theme.blue,
        lineWidth: 2,
        data: points.map((point) => ({ time: point.time, value: point.inflow })),
      },
    ];
  }, [labels.netInflow, labels.zero, latestTone, points, theme]);

  return (
    <div className={cn("technical-chart-panel technical-capital-flow-panel flex min-h-[320px] flex-col overflow-hidden bg-background", className)}>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-background px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            <Activity className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{labels.title}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {lastUpdated ? `${labels.updated} ${lastUpdated} · ${labels.subtitle}` : labels.subtitle}
            </p>
          </div>
        </div>
        <Button
          aria-label={labels.refresh}
          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-primary"
          disabled={loading}
          onClick={() => load()}
          size="icon"
          title={labels.refresh}
          type="button"
          variant="ghost"
        >
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
        </Button>
      </div>

      <div className="grid shrink-0 grid-cols-3 gap-1.5 border-b border-border/55 bg-background/45 p-2">
        <MiniMetric label={labels.latest} tone={latestTone} value={formatSignedCompact(latest, language)} />
        <MiniMetric label={labels.high} tone={toneFor(high)} value={formatSignedCompact(high, language)} />
        <MiniMetric label={labels.low} tone={toneFor(low)} value={formatSignedCompact(low, language)} />
      </div>

      <div className={cn("min-h-[220px] flex-1", chartClassName)}>
        {loading && points.length === 0 ? (
          <div className="flex h-full min-h-[220px] items-center justify-center p-3">
            <div className="flex items-center gap-2 rounded-md bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {labels.loading}
            </div>
          </div>
        ) : points.length === 0 ? (
          <div className="flex h-full min-h-[220px] items-center justify-center p-3">
            <div className="rounded-md bg-muted/20 px-3 py-2 text-sm text-muted-foreground">{labels.empty}</div>
          </div>
        ) : (
          <NativeStockChart
            className="h-full w-full"
            fitKey={`${symbol}:capital-flow:${points.length}`}
            panes={panes}
            primaryRangeSeriesId="flow-line"
            series={series}
            theme={theme}
            times={times}
          />
        )}
      </div>
    </div>
  );
}
