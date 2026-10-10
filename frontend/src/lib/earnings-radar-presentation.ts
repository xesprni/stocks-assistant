import { formatTemplate, getMessages, type AppLanguage } from "../i18n";
import type { EarningsHistoryEntry, EarningsOptionDiagnostic, EarningsRadarItem } from "../types/earnings";

export function radarPercent(value: number | null, signed = false): string {
  return value == null ? "—" : `${signed && value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function radarHistory(item: EarningsRadarItem): EarningsHistoryEntry[] {
  return item.history_events ?? item.history.map((move) => ({
    date: move.date, timing: move.timing, period: move.period, move, exclusion_reason: null,
  }));
}

export function optionDiagnosticText(diagnostic: EarningsOptionDiagnostic, language: AppLanguage): string {
  const copy = getMessages(language).earnings;
  return [
    diagnostic.expiry,
    copy.optionStage[diagnostic.stage],
    copy.optionReason[diagnostic.reason],
    diagnostic.error_code == null ? null : formatTemplate(copy.errorCode, { code: diagnostic.error_code }),
  ].filter(Boolean).join(" · ");
}
