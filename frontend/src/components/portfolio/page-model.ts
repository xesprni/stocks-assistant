import {
  formatMoney,
  parseNumber
} from "@/components/portfolio/model";
import { catalogsFor, localeFor, type AppLanguage } from "@/i18n";
import type { PortfolioItem, PortfolioItemDraft, PortfolioMarket } from "@/types/app";

export const copyByLanguage = catalogsFor("portfolio");

export type PortfolioSortKey =
  | "symbol"
  | "pe_ttm_ratio"
  | "cost_price"
  | "current_price"
  | "stock_value"
  | "position_ratio"
  | "pnl_ratio"
  | "change_rate"
  | "note";

export type PortfolioAdjustMode = "increase" | "decrease" | "set";

export type PortfolioViewMode = "overview" | "chart" | "manage";

export type PortfolioAdjustmentDraft = {
  mode: PortfolioAdjustMode;
  shares: string;
  price: string;
};

export type PortfolioSellDraft = {
  shares: string;
  price: string;
  note: string;
};

export type PortfolioAdjustmentPreview = {
  currentShares: number;
  nextShares: number | null;
  nextCost: number | null;
  error: "invalid" | "negative" | null;
};

export function getPortfolioMarkets(language: AppLanguage): Array<{ id: PortfolioMarket; label: string; hint: string; placeholder: string }> {
  const markets = copyByLanguage[language].markets;
  return [
    { id: "US", label: markets.us, hint: "USD", placeholder: markets.usPlaceholder },
    { id: "A", label: markets.a, hint: "CNY", placeholder: markets.aPlaceholder },
    { id: "H", label: markets.h, hint: "HKD", placeholder: markets.hPlaceholder },
  ];
}

export function emptyPortfolioDraft(market: PortfolioMarket): PortfolioItemDraft {
  return {
    market,
    symbol: "",
    name: "",
    shares: "",
    cost_price: "",
    note: "",
  };
}

export function cleanOptional(value?: string | null) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

export function formatPlain(value: string | number | null | undefined) {
  if (value == null || value === "") return "-";
  return String(value);
}

export function formatSignedMoney(value: string | number | null | undefined) {
  const numeric = parseNumber(value);
  if (numeric == null) return "-";
  return `${numeric > 0 ? "+" : ""}${formatMoney(numeric)}`;
}

export function formatPercent(value: string | number | null | undefined) {
  const numeric = parseNumber(value);
  if (numeric == null) return "-";
  return `${numeric.toFixed(2)}%`;
}

export function formatSignedPercent(value: string | number | null | undefined) {
  const numeric = parseNumber(value);
  if (numeric == null) return "-";
  return `${numeric > 0 ? "+" : ""}${numeric.toFixed(2)}%`;
}

export function formatDraftDecimal(value: number | null) {
  if (value == null || !Number.isFinite(value)) return null;
  return String(Number(value.toFixed(8)));
}

export function formatDateTime(value: string, language: AppLanguage) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(localeFor(language), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function numericTone(value: string | number | null | undefined) {
  const numeric = parseNumber(value);
  if (numeric == null || numeric === 0) return "text-muted-foreground";
  return numeric > 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]";
}

export function percentTone(value: string | number | null | undefined): "up" | "down" | "flat" {
  const numeric = parseNumber(value);
  if (numeric == null || numeric === 0) return "flat";
  return numeric > 0 ? "up" : "down";
}

export function comparePortfolioItems(a: PortfolioItem, b: PortfolioItem, key: PortfolioSortKey, direction: "asc" | "desc") {
  const numeric = key !== "symbol" && key !== "note";
  const av = numeric ? parseNumber(a[key]) : String(a[key] ?? "").toLocaleLowerCase();
  const bv = numeric ? parseNumber(b[key]) : String(b[key] ?? "").toLocaleLowerCase();
  if (av == null) return bv == null ? 0 : 1;
  if (bv == null) return -1;
  const result = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
  return direction === "asc" ? result : -result;
}

export function emptyAdjustmentDraft(item?: PortfolioItem | null): PortfolioAdjustmentDraft {
  return {
    mode: "increase",
    shares: "",
    price: item?.current_price ?? item?.cost_price ?? "",
  };
}

export function computeAdjustmentPreview(item: PortfolioItem | null, draft: PortfolioAdjustmentDraft): PortfolioAdjustmentPreview {
  const currentShares = parseNumber(item?.shares) ?? 0;
  const currentCost = parseNumber(item?.cost_price);
  if (!item || !draft.shares.trim()) {
    return { currentShares, nextShares: null, nextCost: currentCost, error: null };
  }

  const amount = parseNumber(draft.shares);
  if (amount == null || amount < 0) {
    return { currentShares, nextShares: null, nextCost: currentCost, error: "invalid" };
  }

  const price = parseNumber(draft.price);
  let nextShares = amount;
  let nextCost = currentCost;

  if (draft.mode === "increase") {
    nextShares = currentShares + amount;
    if (price != null && nextShares > 0) {
      const existingCost = currentCost != null ? currentShares * currentCost : 0;
      nextCost = currentShares > 0 && currentCost != null
        ? (existingCost + amount * price) / nextShares
        : price;
    }
  } else if (draft.mode === "decrease") {
    nextShares = currentShares - amount;
    if (nextShares < 0) {
      return { currentShares, nextShares, nextCost, error: "negative" };
    }
  } else if (price != null) {
    nextCost = price;
  }

  return { currentShares, nextShares, nextCost, error: null };
}

export type LoadPortfolioOptions = {
  quiet?: boolean;
  syncCapitalDraft?: boolean;
};

export const PORTFOLIO_AUTO_REFRESH_STORAGE_KEY = "stocks-assistant.portfolio.auto-refresh";

export const PORTFOLIO_HIDE_SENSITIVE_STORAGE_KEY = "stocks-assistant.portfolio.hide-sensitive";

export const PORTFOLIO_MARKET_STORAGE_KEY = "stocks-assistant.portfolio.market";

export const PORTFOLIO_SORT_STORAGE_KEY = "stocks-assistant.portfolio.sort";

export function readStoredSortState(): { key: PortfolioSortKey; direction: "asc" | "desc" } {
  const fallback = { key: "symbol" as PortfolioSortKey, direction: "asc" as const };
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(PORTFOLIO_SORT_STORAGE_KEY);
    if (!stored) return fallback;
    const parsed = JSON.parse(stored) as Partial<{ key: PortfolioSortKey; direction: "asc" | "desc" }>;
    const keys: PortfolioSortKey[] = ["symbol", "pe_ttm_ratio", "cost_price", "current_price", "stock_value", "position_ratio", "pnl_ratio", "change_rate", "note"];
    return parsed.key && keys.includes(parsed.key) && (parsed.direction === "asc" || parsed.direction === "desc")
      ? { key: parsed.key, direction: parsed.direction }
      : fallback;
  } catch {
    return fallback;
  }
}

export function writeStoredSortState(value: { key: PortfolioSortKey; direction: "asc" | "desc" }) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PORTFOLIO_SORT_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // 本地缓存失败不影响表格排序。
  }
}
