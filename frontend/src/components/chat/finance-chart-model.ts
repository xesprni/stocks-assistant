import type { CSSProperties } from "react";

export type FinanceChartMarker = "circle" | "square" | "triangle" | "pentagon";

export type FinanceChartPoint = {
  label: string;
  value: number;
};

export type FinanceChartSeries = {
  symbol: string;
  name?: string;
  color?: string;
  marker?: FinanceChartMarker;
  points: FinanceChartPoint[];
};

export type FinanceChartRow = {
  symbol: string;
  name?: string;
  price?: string;
  change?: string;
  changeRate?: string;
  previousClose?: string;
  color?: string;
  marker?: FinanceChartMarker;
};

export type FinanceChartPayload = {
  title?: string;
  subtitle?: string;
  unit?: string;
  activeRange?: string;
  ranges?: string[];
  series: FinanceChartSeries[];
  rows?: FinanceChartRow[];
};

export const FINANCE_CHART_COLORS = ["#5b7cfa", "#ffb45c", "#9db7ff", "#f97316", "#f8efe6", "#22c55e"];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function toText(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

export function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.replace(/[%,$]/g, "").trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function normalizeMarker(value: unknown): FinanceChartMarker | undefined {
  if (value === "circle" || value === "square" || value === "triangle" || value === "pentagon") {
    return value;
  }
  return undefined;
}

export function normalizePoint(value: unknown): FinanceChartPoint | null {
  if (Array.isArray(value)) {
    const numberValue = toNumber(value[1]);
    if (numberValue === null) return null;
    return { label: toText(value[0]) ?? "", value: numberValue };
  }
  if (!isRecord(value)) return null;
  const numberValue = toNumber(value.value ?? value.close ?? value.change_rate ?? value.changeRate);
  if (numberValue === null) return null;
  return {
    label: toText(value.label ?? value.date ?? value.time) ?? "",
    value: numberValue,
  };
}

export function parseFinanceChart(raw: string): FinanceChartPayload | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.series)) return null;

    const series = parsed.series
      .map((item, index): FinanceChartSeries | null => {
        if (!isRecord(item)) return null;
        const symbol = toText(item.symbol ?? item.name) ?? `Series ${index + 1}`;
        const rawPoints = Array.isArray(item.points) ? item.points : Array.isArray(item.data) ? item.data : [];
        const points = rawPoints.map(normalizePoint).filter((point): point is FinanceChartPoint => Boolean(point));
        if (!points.length) return null;
        return {
          symbol,
          name: toText(item.name),
          color: toText(item.color),
          marker: normalizeMarker(item.marker),
          points,
        };
      })
      .filter((item): item is FinanceChartSeries => Boolean(item));

    if (!series.length) return null;

    const rows = Array.isArray(parsed.rows)
      ? parsed.rows
        .map((item): FinanceChartRow | null => {
          if (!isRecord(item)) return null;
          const symbol = toText(item.symbol ?? item.name);
          if (!symbol) return null;
          return {
            symbol,
            name: toText(item.name),
            price: toText(item.price),
            change: toText(item.change ?? item.changeValue),
            changeRate: toText(item.changeRate ?? item.change_rate),
            previousClose: toText(item.previousClose ?? item.previous_close),
            color: toText(item.color),
            marker: normalizeMarker(item.marker),
          };
        })
        .filter((item): item is FinanceChartRow => Boolean(item))
      : undefined;

    return {
      title: toText(parsed.title),
      subtitle: toText(parsed.subtitle),
      unit: toText(parsed.unit) ?? "%",
      activeRange: toText(parsed.activeRange ?? parsed.active_range),
      ranges: Array.isArray(parsed.ranges)
        ? parsed.ranges.map(toText).filter((item): item is string => Boolean(item))
        : undefined,
      series,
      rows,
    };
  } catch {
    return null;
  }
}

export function formatAxisLabel(value: number, unit: string): string {
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Number(value.toFixed(1));
  return unit ? `${rounded}${unit}` : String(rounded);
}

export function pointLabel(point: FinanceChartPoint, index: number): string {
  return point.label || String(index + 1);
}

export function buildLinePath(points: FinanceChartPoint[], min: number, max: number, width: number, height: number, left: number, top: number) {
  const range = max - min || 1;
  const step = points.length > 1 ? width / (points.length - 1) : 0;
  return points
    .map((point, index) => {
      const x = left + step * index;
      const y = top + (1 - (point.value - min) / range) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

export function markerStyle(marker: FinanceChartMarker | undefined, color: string): CSSProperties {
  const base: CSSProperties = { backgroundColor: color };
  if (marker === "circle") return { ...base, borderRadius: "999px" };
  if (marker === "triangle") return { ...base, clipPath: "polygon(50% 0, 0 100%, 100% 100%)" };
  if (marker === "pentagon") return { ...base, clipPath: "polygon(50% 0, 100% 38%, 82% 100%, 18% 100%, 0 38%)" };
  return { ...base, borderRadius: "4px" };
}

export function rowToneClass(row: FinanceChartRow): string {
  const value = `${row.change ?? ""} ${row.changeRate ?? ""}`.trim();
  if (value.startsWith("-") || value.includes("↓")) return "text-[var(--color-down)]";
  if (value.startsWith("+") || value.includes("↑")) return "text-[var(--color-up)]";
  return "text-foreground";
}
