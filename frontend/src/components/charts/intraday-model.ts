import { colorWithAlpha, makeHistogramSeries, makeLineSeries } from "@/components/charts/kline-model";
import {
  type NativeChartPane,
  type NativeChartSeries,
  type NativeChartTheme
} from "@/components/charts/NativeStockChart";
import { type ParsedIntradayBar } from "@/components/charts/technical-data";
import {
  calcMACD
} from "@/lib/indicators";

// ── Intraday chart ────────────────────────────────────────────────────────────

export function buildIntradayChartModel(
  bars: ParsedIntradayBar[],
  theme: NativeChartTheme,
  prevClose?: number | null,
): { panes: NativeChartPane[]; series: NativeChartSeries[] } {
  const closes = bars.map((bar) => bar.price);
  const macd = calcMACD(closes);
  const hasPrevClose = prevClose != null && Number.isFinite(prevClose) && prevClose > 0;
  const panes: NativeChartPane[] = [
    // 有昨收价时以昨收为中心做 Y 轴对称，使涨跌幅上下等幅显示
    { id: "price", label: "PRICE", heightWeight: 3, centerValue: hasPrevClose ? prevClose! : undefined },
    { id: "volume", label: "VOL", heightWeight: 0.6 },
    { id: "macd", label: "MACD", heightWeight: 0.75 },
  ];
  const series: NativeChartSeries[] = [];
  if (hasPrevClose) {
    series.push({
      id: "prev-close",
      paneId: "price",
      type: "line",
      title: "PREV CLOSE",
      color: theme.mutedText,
      lineWidth: 1,
      dashed: true,
      data: bars.map((bar) => ({ time: bar.time, value: prevClose })),
    });
  }
  series.push(
    makeLineSeries("price", "price", "PRICE", theme.blue, bars, bars.map((bar) => bar.price)),
    makeLineSeries("avg", "price", "AVG", theme.orange, bars, bars.map((bar) => bar.avg_price), true),
    makeHistogramSeries("volume", "volume", "VOL", bars, bars.map((bar) => bar.volume), () =>
      colorWithAlpha(theme.blue, 0.42),
    ),
    makeHistogramSeries("macd-hist", "macd", "HIST", bars, macd.map((point) => point?.histogram ?? null), (value) =>
      value >= 0 ? colorWithAlpha(theme.up, 0.62) : colorWithAlpha(theme.down, 0.62),
    ),
    makeLineSeries("macd", "macd", "MACD", theme.blue, bars, macd.map((point) => point?.macd ?? null)),
    makeLineSeries("signal", "macd", "SIGNAL", theme.orange, bars, macd.map((point) => point?.signal ?? null)),
  );
  return { panes, series };
}
