import assert from "node:assert/strict";
import { test } from "node:test";
import { drawLinePath, drawPaneLegend } from "../src/components/charts/native/drawing";
import { buildPaneLayouts, cacheSeries, createXMapper, visiblePaneRange } from "../src/components/charts/native/geometry";
import { buildKLineChartModel } from "../src/components/charts/kline-model";
import { MA_PERIODS } from "../src/components/charts/technical-settings";
import type { NativeChartTheme } from "../src/components/charts/native/types";

const theme: NativeChartTheme = {
  background: "white", text: "black", mutedText: "gray", border: "gray", grid: "gray",
  crosshair: "gray", axisBackground: "white", up: "green", down: "red", blue: "blue",
  orange: "orange", purple: "purple", yellow: "yellow",
};
const bars = Array.from({ length: 500 }, (_, i) => ({ time: i, open: 100 + i, high: 103 + i, low: 98 + i, close: 101 + i, volume: 1000 }));
const model = buildKLineChartModel(bars, new Set(["MA"]), new Set(MA_PERIODS), theme);
const series = cacheSeries(bars.map((bar) => bar.time), model.series);

function canvasProbe() {
  const text: { value: string; x: number; y: number; width: number }[] = [];
  const points: { x: number; y: number }[] = [];
  const ctx = {
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, stroke() {}, setLineDash() {}, fillRect() {},
    measureText: (value: string) => ({ width: value.length * 6 }),
    fillText(value: string, x: number, y: number) { text.push({ value, x, y, width: value.length * 6 }); },
    moveTo(x: number, y: number) { points.push({ x, y }); },
    lineTo(x: number, y: number) { points.push({ x, y }); },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, text, points };
}

test("mobile crosshair legends keep all six MA values and OHLC metrics within the price pane", () => {
  for (const width of [294, 358, 363, 634]) {
    const layout = buildPaneLayouts(width, 198, model.panes)[0];
    const { ctx, text } = canvasProbe();
    drawPaneLegend(ctx, layout, series, 499, theme);
    for (const period of MA_PERIODS) {
      assert.ok(text.some((entry) => entry.value.startsWith(`MA${period} `)), `MA${period} value missing at ${width}px`);
    }
    const labels = text.map((entry) => entry.value).join(" ");
    for (const metric of ["O 599.00", "H 602.00", "L 597.00", "C 600.00"]) assert.ok(labels.includes(metric), metric);
    for (const entry of text) {
      assert.ok(entry.x >= layout.x && entry.x + entry.width <= layout.axisX, `Clipped text: ${entry.value}`);
      assert.ok(entry.y >= layout.y && entry.y < layout.y + layout.height, `Text overlaps the next pane: ${entry.value}`);
    }
  }
});

test("short panes retain every MA label when there is not enough room for values", () => {
  const layout = buildPaneLayouts(294, 100, model.panes)[0];
  const { ctx, text } = canvasProbe();
  drawPaneLegend(ctx, layout, series, 499, theme);
  for (const period of MA_PERIODS) assert.ok(text.some((entry) => entry.value === `MA${period}`));
  assert.ok(text.every((entry) => entry.y < layout.height && entry.x + entry.width <= layout.axisX));
});

test("long MA paths keep their warmup alignment and share the candle scale on narrow canvases", () => {
  for (const width of [294, 358]) {
    const layout = buildPaneLayouts(width, 198, model.panes)[0];
    const mapper = createXMapper(layout, { from: 0, to: 499 });
    const range = visiblePaneRange(series, layout, 0, 499);
    for (const period of [60, 120, 250]) {
      const line = series.find((item) => item.id === `ma${period}`);
      assert.ok(line?.type === "line");
      const { ctx, points } = canvasProbe();
      drawLinePath(ctx, layout, range, mapper.indexToX, line, 0, 499);
      assert.equal(points.length, 500 - period + 1);
      assert.equal(points[0].x, mapper.indexToX(period - 1));
      assert.equal(points.at(-1)!.x, mapper.indexToX(499));
      assert.ok(points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x < layout.width && y >= 0 && y < layout.height));
    }
  }
});
