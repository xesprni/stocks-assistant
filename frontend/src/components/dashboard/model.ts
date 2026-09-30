import { getMessages, i18n, localeFor, type AppLanguage } from "@/i18n";
import type {
  DashboardMarketModule,
  MarketDashboardConfig,
  DashboardModuleSource,
  DashboardPortfolioModule,
  DashboardResponse,
  DashboardWatchlistModule,
  DashboardWatchlistRow,
  DashboardWatchlistView,
  PortfolioMarket,
  WatchlistCategory,
} from "@/types/app";
import { type ReactNode } from "react";

export const WATCHLIST_FILTERS: WatchlistCategory[] = ["US", "A", "H"];

export const WATCHLIST_VIEWS: DashboardWatchlistView[] = ["movers", "gainers", "losers", "active"];

export const DASHBOARD_SNAPSHOT_KEY = "stocks_assistant_dashboard_snapshot_v1";

export const DASHBOARD_SNAPSHOT_MAX_AGE_MS = 10_000;

export const DASHBOARD_ERROR_TOAST_INTERVAL_MS = 15000;

export const DETAIL_CHART_RANGES = ["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "MAX"] as const;

export const EMPTY_MARKET_MODULE: DashboardMarketModule = {
  available: true,
  error: null,
  fetched_at: null,
  stale: false,
  source: "local",
  indices: [],
};

export const EMPTY_WATCHLIST_MODULE: DashboardWatchlistModule = {
  available: true,
  error: null,
  fetched_at: null,
  stale: false,
  source: "local",
  items: [],
  views: { movers: [], gainers: [], losers: [], active: [] },
  counts_by_category: { US: 0, A: 0, H: 0 },
  total: 0,
  quote_error: null,
};

export const EMPTY_PORTFOLIO_MODULE: DashboardPortfolioModule = {
  available: true,
  error: null,
  fetched_at: null,
  stale: false,
  source: "local",
  markets: [],
};

export const EMPTY_DASHBOARD: DashboardResponse = {
  market: EMPTY_MARKET_MODULE,
  watchlist: EMPTY_WATCHLIST_MODULE,
  portfolio: EMPTY_PORTFOLIO_MODULE,
};

export type SymbolRow = DashboardWatchlistRow;

export type Tone = "up" | "down" | "flat";

export type DashboardModuleKey = "market" | "watchlist" | "portfolio";

export type DetailChartRange = (typeof DETAIL_CHART_RANGES)[number];

export const DASHBOARD_MODULE_KEYS: DashboardModuleKey[] = ["market", "watchlist", "portfolio"];

export type ModuleStatus = {
  loading: boolean;
  refreshing: boolean;
  error: string;
  lastUpdated: string;
  stale: boolean;
  source: DashboardModuleSource | null;
};

export type DashboardSnapshot = {
  savedAt: number;
  data: DashboardResponse;
};

export type DashboardPageProps = {
  canPermission: (permission: string) => boolean;
  chatExpanded: boolean;
  chatPanel: ReactNode;
  isMobileViewport: boolean;
  language: AppLanguage;
  onOpenChart: (symbol: string) => void;
  onOpenMarketConfig: () => void;
  onOpenPortfolio: () => void;
  onOpenWatchlist: () => void;
  refreshInterval: number;
  marketConfig?: MarketDashboardConfig | null;
};

export function parseNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatNumeric(value: string | null | undefined, language: AppLanguage, maximumFractionDigits = 2): string {
  const parsed = parseNumber(value);
  if (parsed === null) return value || "-";
  return parsed.toLocaleString(localeFor(language), { maximumFractionDigits });
}

export function formatCompactNumeric(value: string | null | undefined, language: AppLanguage): string {
  const parsed = parseNumber(value);
  if (parsed === null) return value || "-";
  return parsed.toLocaleString(localeFor(language), { maximumFractionDigits: 1, notation: "compact" });
}

export function formatPercent(value: string | null | undefined, language: AppLanguage): string {
  if (!value) return "-";
  if (value.includes("%")) return value;
  const parsed = parseNumber(value);
  if (parsed === null) return value;
  return `${parsed.toLocaleString(localeFor(language), { maximumFractionDigits: 2 })}%`;
}

export function rateTone(rate: string | null | undefined): Tone {
  const parsed = parseNumber(rate);
  if (parsed === null || parsed === 0) return "flat";
  return parsed > 0 ? "up" : "down";
}

export function toneClass(tone: Tone) {
  if (tone === "up") return "text-[var(--color-up)]";
  if (tone === "down") return "text-[var(--color-down)]";
  return "text-muted-foreground";
}

export function signedChange(value: string | null | undefined, tone: Tone, language: AppLanguage): string {
  if (!value) return "-";
  const formatted = formatNumeric(value, language);
  if (tone === "up" && !formatted.startsWith("+")) return `+${formatted}`;
  return formatted;
}

export function marketLabel(market: PortfolioMarket, language: AppLanguage) {
  const labels: Record<PortfolioMarket, string> = {
    US: i18n[language].markets.us,
    A: i18n[language].markets.a,
    H: i18n[language].markets.h,
  };
  return labels[market];
}

export function categoryLabel(category: WatchlistCategory, language: AppLanguage) {
  if (category === "US") return getMessages(language).dashboard.us;
  if (category === "A") return getMessages(language).dashboard.aShare;
  return getMessages(language).dashboard.hk;
}

export function watchlistFilterLabel(filter: WatchlistCategory, language: AppLanguage) {
  return categoryLabel(filter, language);
}

export function watchlistViewLabel(view: DashboardWatchlistView, language: AppLanguage) {
  const labels = getMessages(language).dashboard.movers;
  return labels[view];
}

export function chunkRows<T>(rows: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    pages.push(rows.slice(index, index + size));
  }
  return pages;
}

export function readDashboardSnapshot(): DashboardResponse | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(DASHBOARD_SNAPSHOT_KEY);
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as DashboardSnapshot;
    if (!snapshot?.data || Date.now() - snapshot.savedAt > DASHBOARD_SNAPSHOT_MAX_AGE_MS) return null;
    return snapshot.data;
  } catch {
    return null;
  }
}

export function writeDashboardSnapshot(data: DashboardResponse) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(DASHBOARD_SNAPSHOT_KEY, JSON.stringify({ savedAt: Date.now(), data }));
  } catch {
    // Snapshot cache is only a render accelerator; quota failures can be ignored.
  }
}

export function moduleStatusFromModule(
  module: { error?: string | null; fetched_at?: string | null; stale?: boolean; source?: DashboardModuleSource | null } | null | undefined,
  loading = false,
): ModuleStatus {
  return {
    loading,
    refreshing: false,
    error: module?.error || "",
    lastUpdated: module?.fetched_at || "",
    stale: Boolean(module?.stale),
    source: module?.source ?? null,
  };
}

export function initialModuleStatuses(snapshot: DashboardResponse | null): Record<DashboardModuleKey, ModuleStatus> {
  const loading = !snapshot;
  return {
    market: moduleStatusFromModule(snapshot?.market, loading),
    watchlist: moduleStatusFromModule(snapshot?.watchlist, loading),
    portfolio: moduleStatusFromModule(snapshot?.portfolio, loading),
  };
}

export function mergeDashboard(prev: DashboardResponse | null, patch: Partial<DashboardResponse>): DashboardResponse {
  return {
    market: patch.market ?? prev?.market ?? EMPTY_DASHBOARD.market,
    watchlist: patch.watchlist ?? prev?.watchlist ?? EMPTY_DASHBOARD.watchlist,
    portfolio: patch.portfolio ?? prev?.portfolio ?? EMPTY_DASHBOARD.portfolio,
  };
}

export function dashboardHasModuleData(data: DashboardResponse | null, key: DashboardModuleKey): boolean {
  if (!data) return false;
  if (key === "market") return data.market.indices.length > 0;
  if (key === "watchlist") return data.watchlist.total > 0 || data.watchlist.items.length > 0;
  return data.portfolio.markets.length > 0;
}

export function formatModuleTime(value: string, language: AppLanguage): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(localeFor(language), { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function moduleStatusLabel(status: ModuleStatus, language: AppLanguage): string {
  const sourceLabels: Record<DashboardModuleSource, string> = getMessages(language).dashboard.sourceLabels;
  const parts: string[] = [];
  if (status.refreshing) parts.push(getMessages(language).dashboard.refreshing);
  const updatedAt = formatModuleTime(status.lastUpdated, language);
  if (updatedAt) parts.push(updatedAt);
  if (status.source) parts.push(sourceLabels[status.source]);
  if (status.stale) parts.push(getMessages(language).dashboard.stale);
  return parts.join(" · ");
}

export function sectionSubtitle(base: string, status: ModuleStatus, language: AppLanguage): string {
  const meta = moduleStatusLabel(status, language);
  return meta ? `${base} · ${meta}` : base;
}

export function dashboardToastTitle(scope: DashboardModuleKey | "dashboard" | "quote", language: AppLanguage) {
  return getMessages(language).dashboard.toastTitle[scope];
}
