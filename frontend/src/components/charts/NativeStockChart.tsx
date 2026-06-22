import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent, ReactNode } from "react";

export interface NativeChartTheme {
  background: string;
  text: string;
  mutedText: string;
  border: string;
  grid: string;
  crosshair: string;
  axisBackground: string;
  up: string;
  down: string;
  blue: string;
  orange: string;
  purple: string;
  yellow: string;
}

export interface NativeChartPane {
  id: string;
  label?: string;
  heightWeight: number;
  /**
   * 设置后该 pane 的 Y 轴范围会以此为中心做对称展开，
   * 常用于分时图：以昨收价为中心，上下等幅，使涨跌幅视觉对称。
   */
  centerValue?: number;
}

export interface NativeChartViewport {
  from: number;
  to: number;
}

export interface NativeVisibleRange {
  logical: NativeChartViewport;
  time: { from: number; to: number };
  price: { min: number; max: number } | null;
}

export interface NativeCrosshairState {
  index: number;
  time: number;
  paneId: string | null;
}

export interface NativeCrosshairValueState extends NativeCrosshairState {
  value: number;
}

export interface NativeChartTooltipState extends NativeCrosshairState {
  paneValue: number | null;
  x: number;
  y: number;
}

export interface NativeCandlePoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface NativeLinePoint {
  time: number;
  value: number;
}

export interface NativeHistogramPoint {
  time: number;
  value: number;
  color?: string;
}

interface NativeSeriesBase {
  id: string;
  paneId: string;
  title?: string;
  color?: string;
  lineWidth?: number;
  dashed?: boolean;
}

export type NativeChartSeries =
  | (NativeSeriesBase & {
      type: "candlestick";
      data: NativeCandlePoint[];
    })
  | (NativeSeriesBase & {
      type: "line";
      data: NativeLinePoint[];
    })
  | (NativeSeriesBase & {
      type: "histogram";
      data: NativeHistogramPoint[];
      baseline?: number;
    });

interface CachedSeriesBase {
  id: string;
  paneId: string;
  title?: string;
  color?: string;
  lineWidth?: number;
  dashed?: boolean;
}

type CachedSeries =
  | (CachedSeriesBase & {
      type: "candlestick";
      points: Array<NativeCandlePoint | null>;
    })
  | (CachedSeriesBase & {
      type: "line";
      points: Array<NativeLinePoint | null>;
    })
  | (CachedSeriesBase & {
      type: "histogram";
      points: Array<NativeHistogramPoint | null>;
      baseline: number;
    });

interface PaneLayout {
  id: string;
  label?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  axisX: number;
  axisWidth: number;
  centerValue?: number;
}

type ChartPoint = {
  x: number;
  y: number;
};

type PointerPanMode = "direct" | "scroll";

type PinchState = {
  leftRatio: number;
  panMode: PointerPanMode;
  startCenter: ChartPoint;
  startCenterIndex: number;
  startDistance: number;
  startViewport: NativeChartViewport;
};

interface NativeStockChartProps {
  times: number[];
  panes: NativeChartPane[];
  series: NativeChartSeries[];
  theme: NativeChartTheme;
  fitKey?: string | number;
  primaryRangeSeriesId?: string;
  onVisibleRangeChange?: (range: NativeVisibleRange | null) => void;
  onNearStart?: () => void;
  onNearEnd?: () => void;
  formatCrosshairValueLabel?: (state: NativeCrosshairValueState) => string | null | undefined;
  renderTooltip?: (state: NativeChartTooltipState) => ReactNode;
  enableTouchCrosshairHaptics?: boolean;
  className?: string;
}

const AXIS_WIDTH = 58;
const TIME_AXIS_HEIGHT = 22;
const MIN_VISIBLE_BARS = 36;
const PANE_VERTICAL_PADDING = 6;
const RANGE_PADDING_RATIO = 0.035;
const CENTERED_RANGE_PADDING_RATIO = 0.025;
const FLAT_VALUE_RANGE_RATIO = 0.0005;
const EDGE_LOAD_THRESHOLD = 4;
const TOUCH_LONG_PRESS_MS = 360;
const TOUCH_PAN_THRESHOLD_PX = 8;
const TOUCH_CROSSHAIR_HAPTIC_MS = 8;
const TOUCH_CROSSHAIR_HAPTIC_MIN_INTERVAL_MS = 45;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeViewport(viewport: NativeChartViewport, count: number): NativeChartViewport {
  if (count <= 0) return { from: 0, to: 0 };
  const minVisible = Math.min(MIN_VISIBLE_BARS, count);
  const visibleCount = clamp(viewport.to - viewport.from + 1, minVisible, Math.max(minVisible, count));
  if (visibleCount >= count) return { from: 0, to: count - 1 };
  const maxFrom = count - visibleCount;
  const from = clamp(viewport.from, 0, maxFrom);
  return { from, to: from + visibleCount - 1 };
}

function viewportCount(viewport: NativeChartViewport) {
  return Math.max(1, viewport.to - viewport.from + 1);
}

function pointDistance(a: ChartPoint, b: ChartPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: ChartPoint, b: ChartPoint): ChartPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function panDeltaBars(deltaPixels: number, spacing: number, mode: PointerPanMode) {
  const deltaBars = deltaPixels / Math.max(1, spacing);
  return mode === "scroll" ? deltaBars : -deltaBars;
}

function paddedBounds(layout: PaneLayout) {
  const padding = Math.min(PANE_VERTICAL_PADDING, Math.max(2, layout.height * 0.05));
  return {
    top: layout.y + padding,
    bottom: layout.y + layout.height - padding,
    height: Math.max(1, layout.height - padding * 2),
  };
}

function formatNumber(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${(value / 1_000).toFixed(1)}K`;
  if (abs >= 100) return value.toFixed(2);
  if (abs >= 1) return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function formatUtcDateLabel(time: number) {
  const date = new Date(time * 1000);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${month}-${day}`;
}

function isIntradayScale(times: number[]) {
  for (let index = 1; index < times.length; index++) {
    const diff = Math.abs(times[index] - times[index - 1]);
    if (diff > 0 && diff < 12 * 60 * 60) return true;
  }
  return false;
}

function formatTimeLabel(time: number, intraday: boolean) {
  if (!intraday) return formatUtcDateLabel(time);
  const date = new Date(time * 1000);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function buildPaneLayouts(width: number, height: number, panes: NativeChartPane[]) {
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

function cacheSeries(times: number[], series: NativeChartSeries[]): CachedSeries[] {
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

function seriesValueRange(series: CachedSeries, from: number, to: number) {
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

function paneValueRange(series: CachedSeries[], paneId: string, from: number, to: number) {
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

function flatRangeHalfSpan(value: number) {
  const magnitude = Math.abs(value);
  if (magnitude === 0) return 1;
  return Math.max(magnitude * FLAT_VALUE_RANGE_RATIO, 0.000001);
}

function paddedRange(range: { min: number; max: number }): { min: number; max: number } {
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
function symmetricRange(
  range: { min: number; max: number },
  center: number,
): { min: number; max: number } {
  const maxDelta = Math.max(Math.abs(range.max - center), Math.abs(center - range.min));
  const padded = Math.max(maxDelta * (1 + CENTERED_RANGE_PADDING_RATIO), flatRangeHalfSpan(center));
  return { min: center - padded, max: center + padded };
}

function visiblePaneRange(
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

function valueToY(value: number, range: { min: number; max: number }, layout: PaneLayout) {
  const span = range.max - range.min || 1;
  const ratio = (value - range.min) / span;
  const bounds = paddedBounds(layout);
  return bounds.bottom - ratio * bounds.height;
}

function createXMapper(layout: PaneLayout, viewport: NativeChartViewport) {
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

function drawLinePath(
  ctx: CanvasRenderingContext2D,
  layout: PaneLayout,
  range: { min: number; max: number },
  xForIndex: (index: number) => number,
  series: Extract<CachedSeries, { type: "line" }>,
  from: number,
  to: number,
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(layout.x, layout.y, layout.width, layout.height);
  ctx.clip();
  ctx.strokeStyle = series.color ?? "#2962ff";
  ctx.lineWidth = series.lineWidth ?? 1.4;
  ctx.setLineDash(series.dashed ? [5, 4] : []);
  ctx.beginPath();
  let active = false;
  for (let index = from; index <= to; index++) {
    const point = series.points[index];
    if (!point) {
      active = false;
      continue;
    }
    const x = xForIndex(index);
    const y = valueToY(point.value, range, layout);
    if (!active) {
      ctx.moveTo(x, y);
      active = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
  ctx.restore();
}

function drawHistogram(
  ctx: CanvasRenderingContext2D,
  layout: PaneLayout,
  range: { min: number; max: number },
  xForIndex: (index: number) => number,
  spacing: number,
  series: Extract<CachedSeries, { type: "histogram" }>,
  from: number,
  to: number,
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(layout.x, layout.y, layout.width, layout.height);
  ctx.clip();
  const barWidth = Math.max(1, Math.min(spacing * 0.72, 10));
  const baselineY = valueToY(series.baseline, range, layout);
  for (let index = from; index <= to; index++) {
    const point = series.points[index];
    if (!point) continue;
    const x = xForIndex(index) - barWidth / 2;
    const y = valueToY(point.value, range, layout);
    ctx.fillStyle = point.color ?? series.color ?? "#2962ff";
    ctx.fillRect(x, Math.min(y, baselineY), barWidth, Math.max(1, Math.abs(baselineY - y)));
  }
  ctx.restore();
}

function drawCandles(
  ctx: CanvasRenderingContext2D,
  layout: PaneLayout,
  range: { min: number; max: number },
  xForIndex: (index: number) => number,
  spacing: number,
  series: Extract<CachedSeries, { type: "candlestick" }>,
  theme: NativeChartTheme,
  from: number,
  to: number,
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(layout.x, layout.y, layout.width, layout.height);
  ctx.clip();
  const bodyWidth = Math.max(1, Math.min(spacing * 0.62, 14));
  for (let index = from; index <= to; index++) {
    const point = series.points[index];
    if (!point) continue;
    const x = xForIndex(index);
    const openY = valueToY(point.open, range, layout);
    const closeY = valueToY(point.close, range, layout);
    const highY = valueToY(point.high, range, layout);
    const lowY = valueToY(point.low, range, layout);
    const color = point.close >= point.open ? theme.up : theme.down;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, highY);
    ctx.lineTo(x, lowY);
    ctx.stroke();
    const bodyY = Math.min(openY, closeY);
    const bodyH = Math.max(1, Math.abs(closeY - openY));
    if (spacing < 3) {
      ctx.fillRect(x - 0.5, bodyY, 1, bodyH);
    } else {
      ctx.fillRect(x - bodyWidth / 2, bodyY, bodyWidth, bodyH);
    }
  }
  ctx.restore();
}

function drawTextPill(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  theme: NativeChartTheme,
  align: CanvasTextAlign = "left",
) {
  ctx.save();
  ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
  const paddingX = 4;
  const width = ctx.measureText(text).width + paddingX * 2;
  const pillX = align === "right" ? x - width : x;
  ctx.fillStyle = theme.axisBackground;
  ctx.fillRect(pillX, y - 8, width, 16);
  ctx.fillStyle = theme.text;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, pillX + paddingX, y);
  ctx.restore();
}

function legendColorForSeries(series: CachedSeries, index: number | null, theme: NativeChartTheme) {
  if (series.type === "candlestick" && index != null) {
    const point = series.points[index];
    if (point) return point.close >= point.open ? theme.up : theme.down;
  }
  if (series.type === "histogram" && index != null) {
    const point = series.points[index];
    if (point?.color) return point.color;
  }
  return series.color ?? theme.mutedText;
}

function legendTextForSeries(series: CachedSeries, index: number | null) {
  const title = series.title ?? series.id;
  if (index == null) return title;
  if (series.type === "candlestick") {
    const point = series.points[index];
    if (!point) return title;
    return `${title} O ${formatNumber(point.open)} H ${formatNumber(point.high)} L ${formatNumber(point.low)} C ${formatNumber(point.close)}`;
  }
  const point = series.points[index];
  if (!point) return title;
  return `${title} ${formatNumber(point.value)}`;
}

function drawPaneLegend(
  ctx: CanvasRenderingContext2D,
  layout: PaneLayout,
  series: CachedSeries[],
  index: number | null,
  theme: NativeChartTheme,
) {
  const paneSeries = series.filter((item) => item.paneId === layout.id && item.title);
  if (!layout.label && paneSeries.length === 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(layout.x + 4, layout.y + 4, Math.max(1, layout.width - 8), Math.max(1, layout.height - 8));
  ctx.clip();
  ctx.font = "11px Inter, ui-sans-serif, system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  let x = layout.x + 8;
  let y = layout.y + 14;
  const maxX = layout.x + layout.width - 8;
  const maxY = layout.y + Math.min(layout.height - 8, 48);

  if (layout.label) {
    ctx.fillStyle = theme.mutedText;
    ctx.fillText(layout.label, x, y);
    x += ctx.measureText(layout.label).width + 12;
  }

  for (const item of paneSeries) {
    const text = legendTextForSeries(item, index);
    const color = legendColorForSeries(item, index, theme);
    const textWidth = ctx.measureText(text).width;
    const entryWidth = 18 + textWidth + 12;
    if (x + entryWidth > maxX && x > layout.x + 8) {
      x = layout.x + 8;
      y += 15;
    }
    if (y > maxY) break;

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1.5, item.lineWidth ?? 1.5);
    ctx.setLineDash(item.dashed ? [5, 4] : []);
    if (item.type === "histogram") {
      ctx.fillRect(x, y - 4, 12, 8);
    } else {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 12, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = theme.text;
    ctx.fillText(text, x + 16, y);
    x += entryWidth;
  }
  ctx.restore();
}

function drawChart(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  times: number[],
  panes: NativeChartPane[],
  series: CachedSeries[],
  theme: NativeChartTheme,
  viewport: NativeChartViewport,
  crosshair: (NativeCrosshairState & { y: number }) | null,
  formatCrosshairValueLabel?: (state: NativeCrosshairValueState) => string | null | undefined,
) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);

  const layouts = buildPaneLayouts(width, height, panes);
  if (times.length === 0) return layouts;

  const normalized = normalizeViewport(viewport, times.length);
  const intradayScale = isIntradayScale(times);
  const from = Math.max(0, Math.floor(normalized.from) - 2);
  const to = Math.min(times.length - 1, Math.ceil(normalized.to) + 2);
  const baseMapper = createXMapper(layouts[0], normalized);
  const xForIndex = baseMapper.indexToX;

  ctx.font = "11px Inter, ui-sans-serif, system-ui, sans-serif";
  ctx.textBaseline = "middle";

  const paneRanges = new Map<string, { min: number; max: number }>();
  for (const layout of layouts) {
    const range = visiblePaneRange(series, layout, Math.max(0, Math.floor(normalized.from)), Math.min(times.length - 1, Math.ceil(normalized.to)));
    paneRanges.set(layout.id, range);

    ctx.fillStyle = theme.background;
    ctx.fillRect(layout.x, layout.y, layout.width + layout.axisWidth, layout.height);
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(layout.x, layout.y + layout.height - 0.5);
    ctx.lineTo(layout.x + layout.width + layout.axisWidth, layout.y + layout.height - 0.5);
    ctx.stroke();

    ctx.strokeStyle = theme.grid;
    const bounds = paddedBounds(layout);
    for (let tick = 1; tick <= 3; tick++) {
      const y = bounds.top + (bounds.height * tick) / 4;
      ctx.beginPath();
      ctx.moveTo(layout.x, y);
      ctx.lineTo(layout.x + layout.width, y);
      ctx.stroke();
    }

    ctx.textAlign = "left";
    for (let tick = 0; tick <= 4; tick++) {
      const value = range.max - ((range.max - range.min) * tick) / 4;
      const y = bounds.top + (bounds.height * tick) / 4;
      ctx.fillStyle = theme.mutedText;
      ctx.fillText(formatNumber(value), layout.axisX + 7, y);
    }
  }

  const targetGridPx = clamp(baseMapper.spacing * 6, 54, 120);
  const verticalTicks = clamp(Math.round(layouts[0].width / targetGridPx), 2, 12);
  ctx.strokeStyle = theme.grid;
  for (let tick = 0; tick <= verticalTicks; tick++) {
    const logical = normalized.from + ((viewportCount(normalized) - 1) * tick) / verticalTicks;
    const index = clamp(Math.round(logical), 0, times.length - 1);
    const x = xForIndex(index);
    for (const layout of layouts) {
      ctx.beginPath();
      ctx.moveTo(x, layout.y);
      ctx.lineTo(x, layout.y + layout.height);
      ctx.stroke();
    }
    ctx.fillStyle = theme.mutedText;
    ctx.textAlign = "center";
    ctx.fillText(formatTimeLabel(times[index], intradayScale), x, height - TIME_AXIS_HEIGHT / 2);
  }

  for (const item of series) {
    const layout = layouts.find((pane) => pane.id === item.paneId);
    const range = paneRanges.get(item.paneId);
    if (!layout || !range) continue;
    if (item.type === "candlestick") drawCandles(ctx, layout, range, xForIndex, baseMapper.spacing, item, theme, from, to);
    if (item.type === "line") drawLinePath(ctx, layout, range, xForIndex, item, from, to);
    if (item.type === "histogram") drawHistogram(ctx, layout, range, xForIndex, baseMapper.spacing, item, from, to);
  }

  if (crosshair && crosshair.index >= 0 && crosshair.index < times.length) {
    const x = xForIndex(crosshair.index);
    ctx.strokeStyle = theme.crosshair;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    const chartBottom = Math.max(...layouts.map((layout) => layout.y + layout.height));
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, chartBottom);
    ctx.stroke();
    ctx.setLineDash([]);

    const activeLayout = layouts.find((layout) => layout.id === crosshair.paneId);
    if (activeLayout) {
      const range = paneRanges.get(activeLayout.id);
      if (range) {
        const bounds = paddedBounds(activeLayout);
        const y = clamp(crosshair.y, bounds.top, bounds.bottom);
        ctx.strokeStyle = theme.crosshair;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(activeLayout.x, y);
        ctx.lineTo(activeLayout.x + activeLayout.width, y);
        ctx.stroke();
        ctx.setLineDash([]);
        const ratio = 1 - (y - bounds.top) / bounds.height;
        const value = range.min + ratio * (range.max - range.min);
        const valueLabel = formatCrosshairValueLabel?.({
          index: crosshair.index,
          time: times[crosshair.index],
          paneId: activeLayout.id,
          value,
        }) || formatNumber(value);
        drawTextPill(ctx, valueLabel, activeLayout.axisX + activeLayout.axisWidth - 4, y, theme, "right");
      }
    }

    drawTextPill(ctx, formatTimeLabel(times[crosshair.index], intradayScale), x + 6, height - TIME_AXIS_HEIGHT / 2, theme);
  }

  const legendIndex = crosshair && crosshair.index >= 0 && crosshair.index < times.length ? crosshair.index : null;
  for (const layout of layouts) {
    drawPaneLegend(ctx, layout, series, legendIndex, theme);
  }

  return layouts;
}

export function NativeStockChart({
  times,
  panes,
  series,
  theme,
  fitKey,
  primaryRangeSeriesId,
  onVisibleRangeChange,
  onNearStart,
  onNearEnd,
  formatCrosshairValueLabel,
  renderTooltip,
  enableTouchCrosshairHaptics = false,
  className,
}: NativeStockChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const viewportRef = useRef<NativeChartViewport>({ from: 0, to: 0 });
  const crosshairRef = useRef<(NativeCrosshairState & { y: number }) | null>(null);
  const dragRef = useRef<{ panMode: PointerPanMode; pointerType: string; startX: number; startY: number; startViewport: NativeChartViewport } | null>(null);
  const activePointersRef = useRef<Map<number, ChartPoint>>(new Map());
  const pinchRef = useRef<PinchState | null>(null);
  const inspectPointerIdRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const layoutsRef = useRef<PaneLayout[]>([]);
  const lastDataRef = useRef<{ fitKey?: string | number; length: number; first?: number; last?: number }>({ length: 0 });
  const lastVisibleSignatureRef = useRef("");
  const nearStartLengthRef = useRef<number | null>(null);
  const nearEndLengthRef = useRef<number | null>(null);
  const lastHapticCrosshairIndexRef = useRef<number | null>(null);
  const lastHapticAtRef = useRef(0);
  const edgeLoadingEnabledRef = useRef(false);
  const callbacksRef = useRef({ onVisibleRangeChange, onNearStart, onNearEnd });
  const wheelHandlerRef = useRef<(event: WheelEvent) => void>(() => {});
  const [tooltipState, setTooltipState] = useState<NativeChartTooltipState | null>(null);

  const cachedSeries = useMemo(() => cacheSeries(times, series), [times, series]);
  const dataRef = useRef({ times, panes, series: cachedSeries, theme, primaryRangeSeriesId });

  function clearLongPressTimer() {
    if (longPressTimerRef.current == null) return;
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  }

  function startTouchInspectTimer(pointerId: number, point: ChartPoint) {
    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      if (!activePointersRef.current.has(pointerId) || activePointersRef.current.size !== 1) return;
      inspectPointerIdRef.current = pointerId;
      dragRef.current = null;
      lastHapticCrosshairIndexRef.current = null;
      updateCrosshair(point.x, point.y, { haptic: true });
      scheduleDraw();
    }, TOUCH_LONG_PRESS_MS);
  }

  useEffect(() => {
    return () => clearLongPressTimer();
  }, []);

  useLayoutEffect(() => {
    dataRef.current = { times, panes, series: cachedSeries, theme, primaryRangeSeriesId };
  }, [cachedSeries, panes, primaryRangeSeriesId, theme, times]);

  useEffect(() => {
    callbacksRef.current = { onVisibleRangeChange, onNearStart, onNearEnd };
  }, [onNearEnd, onNearStart, onVisibleRangeChange]);

  const scheduleDraw = () => {
    if (rafRef.current != null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const { width, height } = sizeRef.current;
      const current = dataRef.current;
      layoutsRef.current = drawChart(
        ctx,
        width,
        height,
        current.times,
        current.panes,
        current.series,
        current.theme,
        viewportRef.current,
        crosshairRef.current,
        formatCrosshairValueLabel,
      );
    });
  };

  const emitVisibleRange = () => {
    const callback = callbacksRef.current.onVisibleRangeChange;
    const current = dataRef.current;
    if (!callback || current.times.length === 0) {
      callback?.(null);
      return;
    }
    const viewport = normalizeViewport(viewportRef.current, current.times.length);
    viewportRef.current = viewport;
    const from = clamp(Math.floor(viewport.from), 0, current.times.length - 1);
    const to = clamp(Math.ceil(viewport.to), 0, current.times.length - 1);
    const primary = current.series.find((item) => item.id === current.primaryRangeSeriesId);
    const primaryPane = primary
      ? current.panes.find((pane) => pane.id === primary.paneId) ?? { id: primary.paneId, heightWeight: 1 }
      : null;
    const price = primaryPane ? visiblePaneRange(current.series, primaryPane, from, to) : null;
    const signature = `${from}:${to}:${price?.min.toFixed(6) ?? "na"}:${price?.max.toFixed(6) ?? "na"}`;
    if (signature !== lastVisibleSignatureRef.current) {
      lastVisibleSignatureRef.current = signature;
      callback({
        logical: viewport,
        time: { from: current.times[from], to: current.times[to] },
        price,
      });
    }
    if (!edgeLoadingEnabledRef.current) return;

    if (viewport.from <= EDGE_LOAD_THRESHOLD && nearStartLengthRef.current !== current.times.length) {
      nearStartLengthRef.current = current.times.length;
      callbacksRef.current.onNearStart?.();
    } else if (viewport.from > EDGE_LOAD_THRESHOLD * 2) {
      nearStartLengthRef.current = null;
    }

    if (current.times.length - 1 - viewport.to <= EDGE_LOAD_THRESHOLD && nearEndLengthRef.current !== current.times.length) {
      nearEndLengthRef.current = current.times.length;
      callbacksRef.current.onNearEnd?.();
    } else if (current.times.length - 1 - viewport.to > EDGE_LOAD_THRESHOLD * 2) {
      nearEndLengthRef.current = null;
    }
  };

  const setViewport = (viewport: NativeChartViewport) => {
    edgeLoadingEnabledRef.current = true;
    viewportRef.current = normalizeViewport(viewport, dataRef.current.times.length);
    emitVisibleRange();
    scheduleDraw();
  };

  useLayoutEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      sizeRef.current = { width, height, dpr };
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      scheduleDraw();
      emitVisibleRange();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    return () => {
      observer.disconnect();
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const prev = lastDataRef.current;
    const first = times[0];
    const last = times[times.length - 1];
    const fitChanged = prev.fitKey !== fitKey;
    if (fitChanged) {
      crosshairRef.current = null;
      setTooltipState(null);
    }
    if (times.length === 0) {
      viewportRef.current = { from: 0, to: 0 };
      crosshairRef.current = null;
      setTooltipState(null);
      lastDataRef.current = { fitKey, length: 0 };
      lastVisibleSignatureRef.current = "";
      callbacksRef.current.onVisibleRangeChange?.(null);
      scheduleDraw();
      return;
    }

    if (fitChanged || prev.length === 0) {
      edgeLoadingEnabledRef.current = false;
      viewportRef.current = { from: 0, to: times.length - 1 };
    } else if (times.length !== prev.length) {
      const current = viewportRef.current;
      const visible = viewportCount(current);
      const prepended = prev.last === last && times.length > prev.length;
      const appended = prev.first === first && times.length > prev.length && prev.last !== last;
      if (prepended) {
        const added = times.length - prev.length;
        viewportRef.current = { from: current.from + added, to: current.to + added };
      } else if (appended && prev.length - 1 - current.to <= 2) {
        viewportRef.current = { from: Math.max(0, times.length - visible), to: times.length - 1 };
      } else {
        viewportRef.current = current;
      }
      viewportRef.current = normalizeViewport(viewportRef.current, times.length);
    } else {
      viewportRef.current = normalizeViewport(viewportRef.current, times.length);
    }

    lastDataRef.current = { fitKey, length: times.length, first, last };
    emitVisibleRange();
    scheduleDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [times, fitKey, cachedSeries]);

  useEffect(() => {
    scheduleDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panes, cachedSeries, theme]);

  const pointFromEvent = (event: PointerEvent<HTMLCanvasElement> | WheelEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const paneForY = (y: number) => {
    const layout = layoutsRef.current.find((pane) => y >= pane.y && y <= pane.y + pane.height);
    return layout?.id ?? null;
  };

  const paneValueForY = (paneId: string | null, y: number) => {
    const current = dataRef.current;
    if (!paneId || current.times.length === 0) return null;
    const layout = layoutsRef.current.find((pane) => pane.id === paneId);
    if (!layout) return null;
    const viewport = normalizeViewport(viewportRef.current, current.times.length);
    const from = clamp(Math.floor(viewport.from), 0, current.times.length - 1);
    const to = clamp(Math.ceil(viewport.to), 0, current.times.length - 1);
    const range = visiblePaneRange(current.series, layout, from, to);
    const bounds = paddedBounds(layout);
    const clampedY = clamp(y, bounds.top, bounds.bottom);
    const ratio = 1 - (clampedY - bounds.top) / bounds.height;
    return range.min + ratio * (range.max - range.min);
  };

  const maybeVibrateTouchCrosshair = (index: number) => {
    if (!enableTouchCrosshairHaptics || typeof navigator.vibrate !== "function") return;
    if (typeof window.matchMedia !== "function") return;
    if (!window.matchMedia("(orientation: landscape)").matches) return;
    if (lastHapticCrosshairIndexRef.current === index) return;
    if (lastHapticCrosshairIndexRef.current == null) {
      lastHapticCrosshairIndexRef.current = index;
      return;
    }
    lastHapticCrosshairIndexRef.current = index;
    const now = window.performance.now();
    if (now - lastHapticAtRef.current < TOUCH_CROSSHAIR_HAPTIC_MIN_INTERVAL_MS) return;
    lastHapticAtRef.current = now;
    navigator.vibrate(TOUCH_CROSSHAIR_HAPTIC_MS);
  };

  const updateCrosshair = (x: number, y: number, options?: { haptic?: boolean }) => {
    const current = dataRef.current;
    if (current.times.length === 0 || layoutsRef.current.length === 0) {
      setTooltipState(null);
      return;
    }
    const mapper = createXMapper(layoutsRef.current[0], normalizeViewport(viewportRef.current, current.times.length));
    const index = clamp(Math.round(mapper.xToIndex(x)), 0, current.times.length - 1);
    const paneId = paneForY(y);
    const next = { index, time: current.times[index], paneId, paneValue: paneValueForY(paneId, y), x, y };
    crosshairRef.current = { index: next.index, time: next.time, paneId: next.paneId, y };
    setTooltipState(next);
    if (options?.haptic) maybeVibrateTouchCrosshair(index);
  };

  const startPinch = () => {
    const current = dataRef.current;
    const points = [...activePointersRef.current.values()];
    if (points.length < 2 || current.times.length === 0 || layoutsRef.current.length === 0) return;
    const [a, b] = points;
    const viewport = normalizeViewport(viewportRef.current, current.times.length);
    const mapper = createXMapper(layoutsRef.current[0], viewport);
    const center = midpoint(a, b);
    const startCenterIndex = clamp(mapper.xToIndex(center.x), 0, current.times.length - 1);
    const count = viewportCount(viewport);
    pinchRef.current = {
      leftRatio: clamp((startCenterIndex - viewport.from) / count, 0, 1),
      panMode: "direct",
      startCenter: center,
      startCenterIndex,
      startDistance: Math.max(1, pointDistance(a, b)),
      startViewport: viewport,
    };
    dragRef.current = null;
    updateCrosshair(center.x, center.y);
  };

  const updatePinch = () => {
    const current = dataRef.current;
    const pinch = pinchRef.current;
    const points = [...activePointersRef.current.values()];
    if (!pinch || points.length < 2 || current.times.length === 0 || layoutsRef.current.length === 0) return false;
    const [a, b] = points;
    const center = midpoint(a, b);
    const distance = Math.max(1, pointDistance(a, b));
    const mapper = createXMapper(layoutsRef.current[0], normalizeViewport(pinch.startViewport, current.times.length));
    const startCount = viewportCount(pinch.startViewport);
    const nextCount = clamp(
      startCount * (pinch.startDistance / distance),
      Math.min(MIN_VISIBLE_BARS, current.times.length),
      current.times.length,
    );
    const deltaBars = panDeltaBars(center.x - pinch.startCenter.x, mapper.spacing, pinch.panMode);
    const centerIndex = pinch.startCenterIndex + deltaBars;
    const nextFrom = centerIndex - pinch.leftRatio * nextCount;
    setViewport({ from: nextFrom, to: nextFrom + nextCount - 1 });
    updateCrosshair(center.x, center.y);
    return true;
  };

  const handleWheel = (event: WheelEvent) => {
    const current = dataRef.current;
    if (current.times.length === 0 || layoutsRef.current.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const point = pointFromEvent(event);
    const viewport = normalizeViewport(viewportRef.current, current.times.length);
    const mapper = createXMapper(layoutsRef.current[0], viewport);
    const deltaUnit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? Math.max(1, sizeRef.current.height)
        : 1;
    const deltaX = event.deltaX * deltaUnit;
    const deltaY = event.deltaY * deltaUnit;
    const horizontalBars = Math.abs(deltaX) > Math.abs(deltaY)
      ? deltaX / Math.max(1, mapper.spacing)
      : 0;
    if (horizontalBars !== 0) {
      setViewport({ from: viewport.from + horizontalBars, to: viewport.to + horizontalBars });
      updateCrosshair(point.x, point.y);
      return;
    }
    const center = clamp(mapper.xToIndex(point.x), 0, current.times.length - 1);
    const currentCount = viewportCount(viewport);
    const factor = Math.exp(clamp(deltaY, -180, 180) * 0.0022);
    const nextCount = clamp(currentCount * factor, Math.min(MIN_VISIBLE_BARS, current.times.length), current.times.length);
    const leftRatio = clamp((center - viewport.from) / currentCount, 0, 1);
    const nextFrom = center - leftRatio * nextCount;
    setViewport({ from: nextFrom, to: nextFrom + nextCount - 1 });
    updateCrosshair(point.x, point.y);
  };
  wheelHandlerRef.current = handleWheel;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const listener = (event: WheelEvent) => wheelHandlerRef.current(event);
    canvas.addEventListener("wheel", listener, { passive: false });
    return () => canvas.removeEventListener("wheel", listener);
  }, []);

  const finishPointer = (event: PointerEvent<HTMLCanvasElement>) => {
    clearLongPressTimer();
    if (inspectPointerIdRef.current === event.pointerId) inspectPointerIdRef.current = null;
    activePointersRef.current.delete(event.pointerId);
    if (activePointersRef.current.size < 2) pinchRef.current = null;
    if (activePointersRef.current.size === 0) dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }
    scheduleDraw();
  };

  const tooltipContent = tooltipState && renderTooltip ? renderTooltip(tooltipState) : null;
  const tooltipStyle: CSSProperties | undefined = tooltipState
    ? {
        left: tooltipState.x > sizeRef.current.width - 220 ? tooltipState.x - 12 : tooltipState.x + 12,
        maxWidth: "min(14rem, calc(100% - 1rem))",
        top: tooltipState.y > sizeRef.current.height - 150 ? tooltipState.y - 12 : tooltipState.y + 12,
        transform: [
          tooltipState.x > sizeRef.current.width - 220 ? "translateX(-100%)" : "",
          tooltipState.y > sizeRef.current.height - 150 ? "translateY(-100%)" : "",
        ].filter(Boolean).join(" ") || undefined,
      }
    : undefined;

  return (
    <div ref={containerRef} className={["native-stock-chart", className].filter(Boolean).join(" ")} style={{ minWidth: 0, position: "relative" }}>
      <canvas
        ref={canvasRef}
        className="native-stock-chart-canvas block h-full w-full"
        style={{ cursor: dragRef.current ? "grabbing" : "crosshair", touchAction: "none" }}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          event.preventDefault();
          if (dataRef.current.times.length === 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          const point = pointFromEvent(event);
          activePointersRef.current.set(event.pointerId, point);
          if (activePointersRef.current.size >= 2) {
            clearLongPressTimer();
            inspectPointerIdRef.current = null;
            lastHapticCrosshairIndexRef.current = null;
            startPinch();
            scheduleDraw();
            return;
          }
          pinchRef.current = null;
          dragRef.current = {
            panMode: "direct",
            pointerType: event.pointerType,
            startX: point.x,
            startY: point.y,
            startViewport: viewportRef.current,
          };
          if (event.pointerType === "touch") {
            startTouchInspectTimer(event.pointerId, point);
          } else {
            updateCrosshair(point.x, point.y);
          }
          scheduleDraw();
        }}
        onPointerMove={(event) => {
          event.preventDefault();
          const point = pointFromEvent(event);
          if (activePointersRef.current.has(event.pointerId)) {
            activePointersRef.current.set(event.pointerId, point);
          }
          if (activePointersRef.current.size >= 2) {
            clearLongPressTimer();
            inspectPointerIdRef.current = null;
            lastHapticCrosshairIndexRef.current = null;
            if (!pinchRef.current) startPinch();
            if (updatePinch()) return;
          }
          if (inspectPointerIdRef.current === event.pointerId) {
            updateCrosshair(point.x, point.y, { haptic: true });
            scheduleDraw();
            return;
          }
          updateCrosshair(point.x, point.y);
          const current = dataRef.current;
          if (dragRef.current && layoutsRef.current.length > 0 && current.times.length > 0) {
            if (dragRef.current.pointerType === "touch" && longPressTimerRef.current != null) {
              const movement = Math.hypot(point.x - dragRef.current.startX, point.y - dragRef.current.startY);
              if (movement <= TOUCH_PAN_THRESHOLD_PX) {
                scheduleDraw();
                return;
              }
              clearLongPressTimer();
            }
            const mapper = createXMapper(layoutsRef.current[0], normalizeViewport(dragRef.current.startViewport, current.times.length));
            const deltaBars = panDeltaBars(point.x - dragRef.current.startX, mapper.spacing, dragRef.current.panMode);
            setViewport({
              from: dragRef.current.startViewport.from + deltaBars,
              to: dragRef.current.startViewport.to + deltaBars,
            });
          } else {
            scheduleDraw();
          }
        }}
        onPointerUp={(event) => {
          finishPointer(event);
        }}
        onPointerCancel={(event) => {
          finishPointer(event);
        }}
        onLostPointerCapture={(event) => {
          clearLongPressTimer();
          if (inspectPointerIdRef.current === event.pointerId) inspectPointerIdRef.current = null;
          lastHapticCrosshairIndexRef.current = null;
          activePointersRef.current.delete(event.pointerId);
          if (activePointersRef.current.size < 2) pinchRef.current = null;
          if (activePointersRef.current.size === 0) dragRef.current = null;
          scheduleDraw();
        }}
        onPointerLeave={() => {
          if (!dragRef.current && activePointersRef.current.size === 0) {
            crosshairRef.current = null;
            setTooltipState(null);
            scheduleDraw();
          }
        }}
      />
      {tooltipContent ? (
        <div className="pointer-events-none absolute z-20 w-max" style={tooltipStyle}>
          {tooltipContent}
        </div>
      ) : null}
    </div>
  );
}
