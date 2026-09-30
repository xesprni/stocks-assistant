import { TIME_AXIS_HEIGHT } from "@/components/charts/native/constants";
import { formatNumber, formatTimeLabel, isIntradayScale } from "@/components/charts/native/format";
import {
  buildPaneLayouts,
  clamp,
  createXMapper,
  normalizeViewport,
  paddedBounds,
  valueToY,
  viewportCount,
  visiblePaneRange,
} from "@/components/charts/native/geometry";
import {
  type CachedSeries,
  type NativeChartPane,
  type NativeChartTheme,
  type NativeChartViewport,
  type NativeCrosshairState,
  type NativeCrosshairValueState,
  type PaneLayout,
} from "@/components/charts/native/types";

export function drawLinePath(
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

export function drawHistogram(
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

export function drawCandles(
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

export function drawTextPill(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  theme: NativeChartTheme,
  align: CanvasTextAlign = "left",
  boundsWidth?: number,
) {
  ctx.save();
  ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
  const paddingX = 4;
  const width = ctx.measureText(text).width + paddingX * 2;
  const requestedX = align === "right" ? x - width : x;
  const pillX = boundsWidth == null ? requestedX : clamp(requestedX, 0, Math.max(0, boundsWidth - width));
  ctx.fillStyle = theme.axisBackground;
  ctx.fillRect(pillX, y - 8, width, 16);
  ctx.fillStyle = theme.text;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, pillX + paddingX, y);
  ctx.restore();
}

export function legendColorForSeries(series: CachedSeries, index: number | null, theme: NativeChartTheme) {
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

export function legendTextForSeries(series: CachedSeries, index: number | null) {
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

export function drawPaneLegend(
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

  const startX = layout.x + 8;
  const startY = layout.y + 14;
  const maxX = layout.x + layout.width - 8;
  const maxY = layout.y + layout.height - 8;

  function layoutEntries(valueIndex: number | null) {
    let x = startX + (layout.label ? ctx.measureText(layout.label).width + 12 : 0);
    let y = startY;
    const entries: { item: CachedSeries; text: string; x: number; y: number; marker: boolean }[] = [];
    for (const item of paneSeries) {
      const text = legendTextForSeries(item, valueIndex);
      const point = valueIndex == null ? null : item.points[valueIndex];
      // 窄屏将 OHLC 按完整的字段和值换行，不能把整段文本裁掉或挤掉后面的长周期均线。
      const parts = item.type === "candlestick" && point && "open" in point && ctx.measureText(text).width + 30 > maxX - startX
        ? [item.title ?? item.id, `O ${formatNumber(point.open)}`, `H ${formatNumber(point.high)}`, `L ${formatNumber(point.low)}`, `C ${formatNumber(point.close)}`]
        : [text];
      parts.forEach((part, partIndex) => {
        const marker = partIndex === 0;
        const entryWidth = (marker ? 18 : 0) + ctx.measureText(part).width + 12;
        if (x + entryWidth > maxX && x > startX) {
          x = startX;
          y += 15;
        }
        entries.push({ item, text: part, x, y, marker });
        x += entryWidth;
      });
    }
    return entries;
  }

  let entries = layoutEntries(index);
  // 使用面板实际高度而不是固定三行；极矮副图优先保留全部曲线名称。
  if (entries.some((entry) => entry.y > maxY)) entries = layoutEntries(null);

  if (layout.label) {
    ctx.fillStyle = theme.mutedText;
    ctx.fillText(layout.label, startX, startY);
  }

  for (const { item, text, x, y, marker } of entries) {
    const color = legendColorForSeries(item, index, theme);
    if (y > maxY) break;

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1.5, item.lineWidth ?? 1.5);
    ctx.setLineDash(item.dashed ? [5, 4] : []);
    if (marker && item.type === "histogram") {
      ctx.fillRect(x, y - 4, 12, 8);
    } else if (marker) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 12, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = theme.text;
    ctx.fillText(text, x + (marker ? 16 : 0), y);
  }
  ctx.restore();
}

export function drawChart(
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
  let lastTimeLabelRight = -Infinity;
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
    const label = formatTimeLabel(times[index], intradayScale);
    const halfLabelWidth = ctx.measureText(label).width / 2;
    const labelX = clamp(x, halfLabelWidth + 4, width - halfLabelWidth - 4);
    // 窄屏首尾刻度保持完整；网格可更密，但时间文字不能互相覆盖。
    if (labelX - halfLabelWidth >= lastTimeLabelRight + 8) {
      ctx.fillText(label, labelX, height - TIME_AXIS_HEIGHT / 2);
      lastTimeLabelRight = labelX + halfLabelWidth;
    }
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

    const timeLabel = formatTimeLabel(times[crosshair.index], intradayScale);
    drawTextPill(ctx, timeLabel, x + 6, height - TIME_AXIS_HEIGHT / 2, theme, "left", width);
  }

  const legendIndex = crosshair && crosshair.index >= 0 && crosshair.index < times.length ? crosshair.index : null;
  for (const layout of layouts) {
    drawPaneLegend(ctx, layout, series, legendIndex, theme);
  }

  return layouts;
}
