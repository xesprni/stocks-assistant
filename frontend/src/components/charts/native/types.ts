import type { ReactNode } from "react";

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

export interface NativeSeriesBase {
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

export interface CachedSeriesBase {
  id: string;
  paneId: string;
  title?: string;
  color?: string;
  lineWidth?: number;
  dashed?: boolean;
}

export type CachedSeries =
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

export interface PaneLayout {
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

export type ChartPoint = {
  x: number;
  y: number;
};

export type PointerPanMode = "direct" | "scroll";

export type PinchState = {
  leftRatio: number;
  panMode: PointerPanMode;
  startCenter: ChartPoint;
  startCenterIndex: number;
  startDistance: number;
  startViewport: NativeChartViewport;
};

export interface NativeStockChartProps {
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
