import {
  type NativeChartPane,
  type NativeChartSeries,
  type NativeChartTheme
} from "@/components/charts/NativeStockChart";
import { parseBars } from "@/components/charts/technical-data";
import { maDefinitions, type IndicatorKey, type MAPeriod, type SubIndicatorKey } from "@/components/charts/technical-settings";
import {
  calcATR,
  calcBBIBOLL,
  calcBollinger,
  calcCCI,
  calcDMI,
  calcEMAValues,
  calcKDJ,
  calcMA,
  calcMACD,
  calcOBV,
  calcOSC,
  calcROC,
  calcRSI,
  calcWR,
} from "@/lib/indicators";

// ── Native chart data helpers ─────────────────────────────────────────────────

export type ParsedKLineBar = ReturnType<typeof parseBars>[number];

export function colorWithAlpha(color: string, opacity: number) {
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

export function toLinePoints(
  bars: { time: number }[],
  values: (number | null)[],
): Extract<NativeChartSeries, { type: "line" }>["data"] {
  return bars
    .map((bar, index) => (values[index] == null ? null : { time: bar.time, value: values[index]! }))
    .filter((point): point is { time: number; value: number } => point != null);
}

export function makeLineSeries(
  id: string,
  paneId: string,
  title: string,
  color: string,
  bars: { time: number }[],
  values: (number | null)[],
  dashed = false,
): NativeChartSeries {
  return {
    id,
    paneId,
    title,
    type: "line",
    color,
    lineWidth: 1.35,
    dashed,
    data: toLinePoints(bars, values),
  };
}

export function makeHistogramSeries(
  id: string,
  paneId: string,
  title: string,
  bars: { time: number }[],
  values: (number | null)[],
  colorForValue: (value: number, index: number) => string,
): NativeChartSeries {
  return {
    id,
    paneId,
    title,
    type: "histogram",
    baseline: 0,
    data: bars
      .map((bar, index) => {
        const value = values[index];
        return value == null ? null : { time: bar.time, value, color: colorForValue(value, index) };
      })
      .filter((point): point is { time: number; value: number; color: string } => point != null),
  };
}

export function buildKLineChartModel(
  bars: ParsedKLineBar[],
  activeIndicators: Set<IndicatorKey>,
  activeMAPeriods: ReadonlySet<MAPeriod>,
  theme: NativeChartTheme,
): { panes: NativeChartPane[]; series: NativeChartSeries[] } {
  const closes = bars.map((bar) => bar.close);
  const highs = bars.map((bar) => bar.high);
  const lows = bars.map((bar) => bar.low);
  const panes: NativeChartPane[] = [
    { id: "price", label: "PRICE", heightWeight: 3 },
    { id: "volume", label: "VOL", heightWeight: 0.72 },
  ];
  const series: NativeChartSeries[] = [
    {
      id: "candles",
      paneId: "price",
      title: "OHLC",
      type: "candlestick",
      data: bars.map((bar) => ({
        time: bar.time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      })),
    },
    makeHistogramSeries("volume", "volume", "VOL", bars, bars.map((bar) => bar.volume), (_value, index) =>
      bars[index].close >= bars[index].open ? colorWithAlpha(theme.up, 0.36) : colorWithAlpha(theme.down, 0.36),
    ),
  ];

  if (activeIndicators.has("MA")) {
    for (const { period, color } of maDefinitions(theme)) {
      if (activeMAPeriods.has(period) && bars.length >= period) {
        series.push(makeLineSeries(`ma${period}`, "price", `MA${period}`, color, bars, calcMA(closes, period)));
      }
    }
  }
  if (activeIndicators.has("VOLMA")) {
    const volumes = bars.map((bar) => bar.volume);
    series.push(
      makeLineSeries("volma5", "volume", "VOL MA5", theme.orange, bars, calcMA(volumes, 5)),
      makeLineSeries("volma10", "volume", "VOL MA10", theme.blue, bars, calcMA(volumes, 10)),
    );
  }

  if (activeIndicators.has("BOLL")) {
    const boll = calcBollinger(closes);
    series.push(
      makeLineSeries("boll-upper", "price", "BOLL U", theme.yellow, bars, boll.map((point) => point?.upper ?? null)),
      makeLineSeries("boll-middle", "price", "BOLL M", theme.mutedText, bars, boll.map((point) => point?.middle ?? null), true),
      makeLineSeries("boll-lower", "price", "BOLL L", theme.yellow, bars, boll.map((point) => point?.lower ?? null)),
    );
  }

  if (activeIndicators.has("BBIBOLL")) {
    const bbiboll = calcBBIBOLL(closes);
    series.push(
      makeLineSeries("bbiboll-upper", "price", "BBI U", theme.orange, bars, bbiboll.map((point) => point?.upper ?? null), true),
      makeLineSeries("bbiboll-middle", "price", "BBI M", theme.blue, bars, bbiboll.map((point) => point?.middle ?? null)),
      makeLineSeries("bbiboll-lower", "price", "BBI L", theme.orange, bars, bbiboll.map((point) => point?.lower ?? null), true),
    );
  }

  if (activeIndicators.has("EMA")) {
    series.push(
      makeLineSeries("ema12", "price", "EMA12", theme.orange, bars, calcEMAValues(closes, 12)),
      makeLineSeries("ema26", "price", "EMA26", theme.purple, bars, calcEMAValues(closes, 26)),
    );
  }

  for (const key of ["MACD", "KDJ", "RSI", "CCI", "WR", "DMI", "OSC", "ATR", "OBV", "ROC"] as SubIndicatorKey[]) {
    if (!activeIndicators.has(key)) continue;
    const paneId = key.toLowerCase();
    panes.push({ id: paneId, label: key, heightWeight: 0.9 });
    if (key === "MACD") {
      const macd = calcMACD(closes);
      series.push(
        makeHistogramSeries("macd-hist", paneId, "HIST", bars, macd.map((point) => point?.histogram ?? null), (value) =>
          value >= 0 ? colorWithAlpha(theme.up, 0.62) : colorWithAlpha(theme.down, 0.62),
        ),
        makeLineSeries("macd", paneId, "MACD", theme.blue, bars, macd.map((point) => point?.macd ?? null)),
        makeLineSeries("macd-signal", paneId, "SIGNAL", theme.orange, bars, macd.map((point) => point?.signal ?? null)),
      );
    } else if (key === "KDJ") {
      const kdj = calcKDJ(highs, lows, closes);
      series.push(
        makeLineSeries("kdj-k", paneId, "K", theme.blue, bars, kdj.map((point) => point?.k ?? null)),
        makeLineSeries("kdj-d", paneId, "D", theme.orange, bars, kdj.map((point) => point?.d ?? null)),
        makeLineSeries("kdj-j", paneId, "J", theme.purple, bars, kdj.map((point) => point?.j ?? null)),
      );
    } else if (key === "RSI") {
      series.push(makeLineSeries("rsi", paneId, "RSI", theme.blue, bars, calcRSI(closes)));
    } else if (key === "CCI") {
      series.push(makeLineSeries("cci", paneId, "CCI", theme.orange, bars, calcCCI(highs, lows, closes)));
    } else if (key === "WR") {
      series.push(makeLineSeries("wr", paneId, "WR", theme.purple, bars, calcWR(highs, lows, closes)));
    } else if (key === "DMI") {
      const dmi = calcDMI(highs, lows, closes);
      series.push(
        makeLineSeries("dmi-pdi", paneId, "PDI", theme.blue, bars, dmi.map((point) => point?.pdi ?? null)),
        makeLineSeries("dmi-mdi", paneId, "MDI", theme.orange, bars, dmi.map((point) => point?.mdi ?? null)),
        makeLineSeries("dmi-adx", paneId, "ADX", theme.purple, bars, dmi.map((point) => point?.adx ?? null)),
        makeLineSeries("dmi-adxr", paneId, "ADXR", theme.yellow, bars, dmi.map((point) => point?.adxr ?? null), true),
      );
    } else if (key === "ATR") {
      series.push(makeLineSeries("atr", paneId, "ATR14", theme.orange, bars, calcATR(highs, lows, closes)));
    } else if (key === "OBV") {
      series.push(makeLineSeries("obv", paneId, "OBV", theme.blue, bars, calcOBV(closes, bars.map((bar) => bar.volume))));
    } else if (key === "ROC") {
      series.push(makeLineSeries("roc", paneId, "ROC12 %", theme.purple, bars, calcROC(closes)));
    } else if (key === "OSC") {
      const osc = calcOSC(closes);
      series.push(
        makeHistogramSeries("osc-hist", paneId, "HIST", bars, osc.map((point) => point?.histogram ?? null), (value) =>
          value >= 0 ? colorWithAlpha(theme.up, 0.62) : colorWithAlpha(theme.down, 0.62),
        ),
        makeLineSeries("osc", paneId, "OSC", theme.blue, bars, osc.map((point) => point?.osc ?? null)),
        makeLineSeries("maosc", paneId, "MAOSC", theme.orange, bars, osc.map((point) => point?.maosc ?? null)),
      );
    }
  }

  return { panes, series };
}
