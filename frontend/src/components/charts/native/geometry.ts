import {
  AXIS_WIDTH,
  CENTERED_RANGE_PADDING_RATIO,
  FLAT_VALUE_RANGE_RATIO,
  MIN_VISIBLE_BARS,
  PANE_VERTICAL_PADDING,
  RANGE_PADDING_RATIO,
  TIME_AXIS_HEIGHT,
} from "@/components/charts/native/constants";
import {
  type CachedSeries,
  type ChartPoint,
  type NativeCandlePoint,
  type NativeChartPane,
  type NativeChartSeries,
  type NativeChartViewport,
  type NativeHistogramPoint,
  type NativeLinePoint,
  type PaneLayout,
  type PointerPanMode,
} from "@/components/charts/native/types";

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeViewport(viewport: NativeChartViewport, count: number): NativeChartViewport {
  if (count <= 0) return { from: 0, to: 0 };
  const minVisible = Math.min(MIN_VISIBLE_BARS, count);
  const visibleCount = clamp(viewport.to - viewport.from + 1, minVisible, Math.max(minVisible, count));
  if (visibleCount >= count) return { from: 0, to: count - 1 };
  const maxFrom = count - visibleCount;
  const from = clamp(viewport.from, 0, maxFrom);
  return { from, to: from + visibleCount - 1 };
}

export function viewportCount(viewport: NativeChartViewport) {
  return Math.max(1, viewport.to - viewport.from + 1);
}

export function pointDistance(a: ChartPoint, b: ChartPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: ChartPoint, b: ChartPoint): ChartPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function panDeltaBars(deltaPixels: number, spacing: number, mode: PointerPanMode) {
  const deltaBars = deltaPixels / Math.max(1, spacing);
  return mode === "scroll" ? deltaBars : -deltaBars;
}

export function paddedBounds(layout: PaneLayout) {
  const padding = Math.min(PANE_VERTICAL_PADDING, Math.max(2, layout.height * 0.05));
  return {
    top: layout.y + padding,
    bottom: layout.y + layout.height - padding,
    height: Math.max(1, layout.height - padding * 2),
  };
}

export function buildPaneLayouts(width: number, height: number, panes: NativeChartPane[]) {
  const safePanes = panes.length > 0 ? panes : [{ id: "main", heightWeight: 1 }];
  const axisWidth = Math.min(AXIS_WIDTH, Math.max(54, width * 0.22));
  const plotWidth = Math.max(1, width - axisWidth);
  const paneHeight = Math.max(1, height - TIME_AXIS_HEIGHT);
  const totalWeight = safePanes.reduce((sum, pane) => sum + Math.max(0.1, pane.heightWeight), 0);
  let y = 0;
  return safePanes.map((pane, index): PaneLayout => {
    const isLast = index === safePanes.length - 1;
    const h = isLast ? paneHeight - y : Math.round((paneHeight * Math.max(0.1, pane.heightWeight)) / totalWeight);
    const layout = {
      id: pane.id,
      label: pane.label,
      x: 0,
      y,
      width: plotWidth,
      height: Math.max(1, h),
      axisX: plotWidth,
      axisWidth,
      centerValue: pane.centerValue,
    };
    y += layout.height;
    return layout;
  });
}

export function cacheSeries(times: number[], series: NativeChartSeries[]): CachedSeries[] {
  const timeToIndex = new Map<number, number>();
  times.forEach((time, index) => timeToIndex.set(time, index));

  return series.map((item): CachedSeries => {
    if (item.type === "candlestick") {
      const points: Array<NativeCandlePoint | null> = new Array(times.length).fill(null);
      item.data.forEach((point) => {
        const index = timeToIndex.get(point.time);
        if (index != null) points[index] = point;
      });
      return { ...item, points };
    }
    if (item.type === "line") {
      const points: Array<NativeLinePoint | null> = new Array(times.length).fill(null);
      item.data.forEach((point) => {
        const index = timeToIndex.get(point.time);
        if (index != null) points[index] = point;
      });
      return { ...item, points };
    }

    const points: Array<NativeHistogramPoint | null> = new Array(times.length).fill(null);
    item.data.forEach((point) => {
      const index = timeToIndex.get(point.time);
      if (index != null) points[index] = point;
    });
    return { ...item, baseline: item.baseline ?? 0, points };
  });
}

export function seriesValueRange(series: CachedSeries, from: number, to: number) {
  let min = Infinity;
  let max = -Infinity;
  for (let index = from; index <= to; index++) {
    if (series.type === "candlestick") {
      const point = series.points[index];
      if (!point) continue;
      min = Math.min(min, point.low);
      max = Math.max(max, point.high);
    } else if (series.type === "line") {
      const point = series.points[index];
      if (!point) continue;
      min = Math.min(min, point.value);
      max = Math.max(max, point.value);
    } else {
      const point = series.points[index];
      if (!point) continue;
      min = Math.min(min, point.value, series.baseline);
      max = Math.max(max, point.value, series.baseline);
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { min, max };
}

export function paneValueRange(series: CachedSeries[], paneId: string, from: number, to: number) {
  let min = Infinity;
  let max = -Infinity;
  for (const item of series) {
    if (item.paneId !== paneId) continue;
    const range = seriesValueRange(item, from, to);
    if (!range) continue;
    min = Math.min(min, range.min);
    max = Math.max(max, range.max);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  return { min, max };
}

export function flatRangeHalfSpan(value: number) {
  const magnitude = Math.abs(value);
  if (magnitude === 0) return 1;
  return Math.max(magnitude * FLAT_VALUE_RANGE_RATIO, 0.000001);
}

export function paddedRange(range: { min: number; max: number }): { min: number; max: number } {
  if (range.min === range.max) {
    const pad = flatRangeHalfSpan(range.min);
    return { min: range.min - pad, max: range.max + pad };
  }
  const pad = (range.max - range.min) * RANGE_PADDING_RATIO;
  return { min: range.min - pad, max: range.max + pad };
}

/**
 * 以 center 为中心构建对称 Y 轴范围。
 * 取数据范围两端到 center 的最大偏移作为半幅，使涨跌对称显示。
 * 常量辅助线不参与额外放大，避免小涨跌幅被昨收线撑出大留白。
 */
export function symmetricRange(
  range: { min: number; max: number },
  center: number,
): { min: number; max: number } {
  const maxDelta = Math.max(Math.abs(range.max - center), Math.abs(center - range.min));
  const padded = Math.max(maxDelta * (1 + CENTERED_RANGE_PADDING_RATIO), flatRangeHalfSpan(center));
  return { min: center - padded, max: center + padded };
}

export function visiblePaneRange(
  series: CachedSeries[],
  pane: { id: string; centerValue?: number },
  from: number,
  to: number,
) {
  const rawRange = paneValueRange(series, pane.id, from, to);
  return pane.centerValue != null && Number.isFinite(pane.centerValue)
    ? symmetricRange(rawRange, pane.centerValue)
    : paddedRange(rawRange);
}

export function valueToY(value: number, range: { min: number; max: number }, layout: PaneLayout) {
  const span = range.max - range.min || 1;
  const ratio = (value - range.min) / span;
  const bounds = paddedBounds(layout);
  return bounds.bottom - ratio * bounds.height;
}

export function createXMapper(layout: PaneLayout, viewport: NativeChartViewport) {
  const count = viewportCount(viewport);
  const spacing = layout.width / count;
  return {
    spacing,
    indexToX(index: number) {
      return layout.x + (index - viewport.from + 0.5) * spacing;
    },
    xToIndex(x: number) {
      return viewport.from + (x - layout.x) / spacing - 0.5;
    },
  };
}
