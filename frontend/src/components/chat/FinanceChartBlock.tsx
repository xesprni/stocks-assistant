import {
  type FinanceChartPayload,
  buildLinePath,
  FINANCE_CHART_COLORS,
  formatAxisLabel,
  markerStyle,
  pointLabel,
  rowToneClass,
} from "@/components/chat/finance-chart-model";
import type { AppLanguage } from "@/i18n";
import { getMessages } from "@/i18n";
import { cn } from "@/lib/utils";

export function FinanceChartBlock({ chart, language }: { chart: FinanceChartPayload; language: AppLanguage }) {
  const allValues = chart.series.flatMap((series) => series.points.map((point) => point.value));
  const rawMin = Math.min(...allValues, 0);
  const rawMax = Math.max(...allValues, 0);
  const padding = Math.max((rawMax - rawMin) * 0.08, chart.unit === "%" ? 12 : 1);
  const min = rawMin - padding;
  const max = rawMax + padding;
  const svgWidth = 900;
  const svgHeight = 292;
  const left = 58;
  const right = 24;
  const top = 24;
  const bottom = 52;
  const plotWidth = svgWidth - left - right;
  const plotHeight = svgHeight - top - bottom;
  const labels = getMessages(language).chat.chart;
  const firstSeries = chart.series[0];
  const tickIndexes = firstSeries.points.length > 1
    ? Array.from(new Set([0, Math.floor((firstSeries.points.length - 1) / 4), Math.floor((firstSeries.points.length - 1) / 2), Math.floor(((firstSeries.points.length - 1) * 3) / 4), firstSeries.points.length - 1]))
    : [0];
  const yTicks = Array.from({ length: 5 }, (_, index) => max - ((max - min) * index) / 4);
  const ranges = chart.ranges?.length ? chart.ranges : ["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "MAX"];
  const activeRange = chart.activeRange ?? ranges[Math.min(5, ranges.length - 1)];

  return (
    <div className="not-prose my-3 overflow-hidden rounded-2xl bg-muted/30 text-foreground ring-1 ring-border/45">
      <div className="space-y-1 px-4 pb-2 pt-4">
        {chart.title ? <p className="text-sm font-semibold">{chart.title}</p> : null}
        {chart.subtitle ? <p className="text-xs text-muted-foreground">{chart.subtitle}</p> : null}
        <div className="flex flex-wrap gap-2 pt-2">
          {chart.series.map((series, index) => {
            const color = series.color ?? FINANCE_CHART_COLORS[index % FINANCE_CHART_COLORS.length];
            return (
              <span
                className="inline-flex h-8 items-center gap-2 rounded-full border border-border/75 bg-background/55 px-3 text-xs font-semibold text-foreground"
                key={`${series.symbol}-${index}`}
              >
                <span className="size-3 shrink-0" style={markerStyle(series.marker, color)} />
                <span className="max-w-28 truncate">{series.symbol}</span>
              </span>
            );
          })}
        </div>
      </div>
      <div className="overflow-x-auto px-2 pb-1">
        <svg className="h-[280px] min-w-[760px] text-muted-foreground" role="img" viewBox={`0 0 ${svgWidth} ${svgHeight}`}>
          {yTicks.map((tick) => {
            const y = top + (1 - (tick - min) / (max - min || 1)) * plotHeight;
            return (
              <g key={tick.toFixed(4)}>
                <line stroke="currentColor" strokeOpacity="0.14" x1={left} x2={svgWidth - right} y1={y} y2={y} />
                <text fill="currentColor" fontSize="15" x={left - 10} y={y + 5} textAnchor="end">
                  {formatAxisLabel(tick, chart.unit ?? "")}
                </text>
              </g>
            );
          })}
          {tickIndexes.map((pointIndex) => {
            const x = left + (firstSeries.points.length > 1 ? (plotWidth * pointIndex) / (firstSeries.points.length - 1) : 0);
            return (
              <g key={`${pointIndex}-${pointLabel(firstSeries.points[pointIndex], pointIndex)}`}>
                <line stroke="currentColor" strokeOpacity="0.16" x1={x} x2={x} y1={top} y2={top + plotHeight} />
                <text fill="currentColor" fontSize="15" x={x} y={svgHeight - 18} textAnchor="middle">
                  {pointLabel(firstSeries.points[pointIndex], pointIndex)}
                </text>
              </g>
            );
          })}
          <line stroke="currentColor" strokeDasharray="3 8" strokeOpacity="0.5" x1={left} x2={svgWidth - right} y1={top + (1 - (0 - min) / (max - min || 1)) * plotHeight} y2={top + (1 - (0 - min) / (max - min || 1)) * plotHeight} />
          {chart.series.map((series, index) => {
            const color = series.color ?? FINANCE_CHART_COLORS[index % FINANCE_CHART_COLORS.length];
            const path = buildLinePath(series.points, min, max, plotWidth, plotHeight, left, top);
            const last = series.points[series.points.length - 1];
            const lastX = left + (series.points.length > 1 ? plotWidth : 0);
            const lastY = top + (1 - (last.value - min) / (max - min || 1)) * plotHeight;
            return (
              <g key={`${series.symbol}-line-${index}`}>
                <path d={path} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
                <circle cx={lastX} cy={lastY} fill={color} r="5.5" />
              </g>
            );
          })}
        </svg>
      </div>
      <div className="flex overflow-x-auto border-t border-border/45 px-4 py-2 text-sm text-muted-foreground">
        {ranges.map((range) => (
          <span
            className={cn(
              "mr-2 shrink-0 rounded-full px-3 py-1.5 font-medium",
              range === activeRange ? "bg-background/80 text-foreground shadow-sm" : "text-muted-foreground",
            )}
            key={range}
          >
            {range}
          </span>
        ))}
      </div>
      {chart.rows?.length ? (
        <div className="overflow-x-auto border-t border-border/45">
          <table className="w-full min-w-[680px] border-collapse text-sm">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border/45">
                <th className="px-4 py-3 text-left font-medium">{labels.symbol}</th>
                <th className="px-4 py-3 text-right font-medium">{labels.price}</th>
                <th className="px-4 py-3 text-right font-medium">{labels.change}</th>
                <th className="px-4 py-3 text-right font-medium">{labels.rate}</th>
                <th className="px-4 py-3 text-right font-medium">{labels.prev}</th>
              </tr>
            </thead>
            <tbody>
              {chart.rows.map((row, index) => {
                const matchedSeries = chart.series.find((series) => series.symbol === row.symbol);
                const color = row.color ?? matchedSeries?.color ?? FINANCE_CHART_COLORS[index % FINANCE_CHART_COLORS.length];
                return (
                  <tr className="border-b border-border/35 last:border-0" key={`${row.symbol}-${index}`}>
                    <td className="px-4 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="size-3 shrink-0" style={markerStyle(row.marker ?? matchedSeries?.marker, color)} />
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-foreground">{row.symbol}</p>
                          {row.name ? <p className="truncate text-xs text-muted-foreground">{row.name}</p> : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.price ?? "-"}</td>
                    <td className={cn("px-4 py-3 text-right tabular-nums font-semibold", rowToneClass(row))}>{row.change ?? "-"}</td>
                    <td className={cn("px-4 py-3 text-right tabular-nums font-semibold", rowToneClass(row))}>{row.changeRate ?? "-"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.previousClose ?? "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
