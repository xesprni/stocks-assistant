import { localeFor, type AppLanguage } from "@/i18n";

export function changeRate(current: number | null | undefined, base: number | null | undefined) {
  if (current == null || base == null || !Number.isFinite(current) || !Number.isFinite(base) || base === 0) return null;
  return ((current - base) / base) * 100;
}

export function formatSignedPercent(rate: number | null, language: AppLanguage) {
  if (rate == null || !Number.isFinite(rate)) return "-";
  const sign = rate > 0 ? "+" : rate < 0 ? "" : "";
  return `${sign}${rate.toLocaleString(localeFor(language), {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}%`;
}

export function toneForRate(rate: number | null) {
  if (rate == null || rate === 0) return "flat";
  return rate > 0 ? "up" : "down";
}

export function formatChartNumber(value: number | null | undefined, language: AppLanguage, options?: Intl.NumberFormatOptions) {
  if (value == null || !Number.isFinite(value)) return "-";
  return value.toLocaleString(localeFor(language), {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    ...options,
  });
}

export function formatCompactVolume(value: number | null | undefined, language: AppLanguage) {
  if (value == null || !Number.isFinite(value)) return "-";
  return value.toLocaleString(localeFor(language), {
    maximumFractionDigits: 2,
    notation: "compact",
  });
}

export function formatHoverTime(time: number, language: AppLanguage, intraday = false) {
  const date = new Date(time * 1000);
  const locale = localeFor(language);
  if (intraday) {
    return date.toLocaleString(locale, {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return date.toLocaleDateString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}
