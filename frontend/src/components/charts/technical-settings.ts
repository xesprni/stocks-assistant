import {
  type NativeChartTheme
} from "@/components/charts/NativeStockChart";
import { catalogsFor, type AppLanguage } from "@/i18n";

// ── Types ─────────────────────────────────────────────────────────────────────

export type Period = "1D" | "1W" | "1M";

export const MA_PERIODS = [5, 10, 20, 60, 120, 250] as const;

export type MAPeriod = (typeof MA_PERIODS)[number];

export const DEFAULT_MA_PERIODS: readonly MAPeriod[] = [5, 10, 20];

export const MA_SELECTION_STORAGE_KEY = "stocks-assistant.chart-ma-periods";

export function maDefinitions(theme: NativeChartTheme) {
  return [
    { period: 5, color: theme.orange },
    { period: 10, color: theme.blue },
    { period: 20, color: theme.purple },
    { period: 60, color: theme.yellow },
    { period: 120, color: "#06b6d4" },
    { period: 250, color: "#ec4899" },
  ] as const;
}

export type SubIndicatorKey = "MACD" | "KDJ" | "RSI" | "CCI" | "WR" | "DMI" | "OSC" | "ATR" | "OBV" | "ROC";

export type OverlayIndicatorKey = "BOLL" | "BBIBOLL" | "EMA" | "MA" | "VOLMA";

export type IndicatorKey = SubIndicatorKey | OverlayIndicatorKey;

export interface Props {
  language: AppLanguage;
  symbol: string;
  onSymbolChange: (s: string) => void;
  onBack?: () => void;
  embedded?: boolean;
}

export const technicalCopy = catalogsFor("technicalAnalysis");

export type TechnicalCopy = (typeof technicalCopy)[AppLanguage];

// ── Indicator selector + display ──────────────────────────────────────────────

export const SUB_INDICATORS: { key: SubIndicatorKey; label: string; color: string }[] = [
  { key: "ATR", label: "ATR(14)", color: "#d97706" },
  { key: "OBV", label: "OBV", color: "#2563eb" },
  { key: "ROC", label: "ROC(12)", color: "#7c3aed" },
  { key: "MACD", label: "MACD", color: "#2563eb" },
  { key: "KDJ", label: "KDJ", color: "#d97706" },
  { key: "RSI", label: "RSI", color: "#7c3aed" },
  { key: "CCI", label: "CCI", color: "#0f766e" },
  { key: "WR", label: "WR", color: "#be123c" },
  { key: "DMI", label: "DMI", color: "#0284c7" },
  { key: "OSC", label: "OSC", color: "#ea580c" },
];

export const OVERLAY_INDICATORS: { key: OverlayIndicatorKey; label: string; color: string }[] = [
  { key: "MA", label: "MA", color: "#d97706" },
  { key: "VOLMA", label: "VOL MA", color: "#0284c7" },
  { key: "BOLL", label: "BOLL", color: "#ca8a04" },
  { key: "BBIBOLL", label: "BBIBOLL", color: "#ea580c" },
  { key: "EMA", label: "EMA", color: "#7c3aed" },
];
