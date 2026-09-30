import { type QuoteItem } from "@/types/market";
import { type PortfolioItem, type PortfolioMarket } from "@/types/portfolio";

// ── Dashboard aggregate ────────────────────────────────────────────────────

export type DashboardWatchlistView = "movers" | "gainers" | "losers" | "active";

export type DashboardModuleSource = "local" | "cache" | "live";

export interface DashboardModule {
  available: boolean;
  error: string | null;
  fetched_at?: string | null;
  stale?: boolean;
  source?: DashboardModuleSource | null;
}

export interface DashboardWatchlistRow extends QuoteItem {
  id?: number;
  name_cn?: string;
  name_en?: string;
  name_hk?: string;
  exchange?: string;
  currency?: string;
  lot_size?: string;
  board?: string;
  security_type?: string;
  note?: string;
  created_at?: string;
  updated_at?: string;
}

export interface DashboardWatchlistViews {
  movers: DashboardWatchlistRow[];
  gainers: DashboardWatchlistRow[];
  losers: DashboardWatchlistRow[];
  active: DashboardWatchlistRow[];
}

export interface DashboardWatchlistModule extends DashboardModule {
  items: DashboardWatchlistRow[];
  views: DashboardWatchlistViews;
  counts_by_category: Record<string, number>;
  total: number;
  quote_error: string | null;
}

export type DashboardPortfolioPosition = PortfolioItem;

export interface DashboardPortfolioMarket {
  market: PortfolioMarket;
  total_assets: string;
  market_value: string;
  cash_amount: string;
  cash_ratio: string | null;
  cost_value: string;
  unrealized_pnl_value: string | null;
  unrealized_pnl_ratio: string | null;
  day_change_value: string | null;
  day_change_rate: string | null;
  position_count: number;
  quote_error: string | null;
  top_positions: DashboardPortfolioPosition[];
}

export interface DashboardPortfolioModule extends DashboardModule {
  markets: DashboardPortfolioMarket[];
}

export interface DashboardMarketModule extends DashboardModule {
  indices: QuoteItem[];
}

export interface DashboardSymbolInsightSection {
  available: boolean;
  error: string | null;
  data: Record<string, unknown>;
  items: unknown[];
  total: number;
}

export interface DashboardSymbolInsightsResponse {
  symbol: string;
  source: string;
  fetched_at: string;
  filings: DashboardSymbolInsightSection;
  company: DashboardSymbolInsightSection;
  dividends: DashboardSymbolInsightSection;
  institution_rating: DashboardSymbolInsightSection;
  corporate_actions: DashboardSymbolInsightSection;
}

export interface DashboardResponse {
  market: DashboardMarketModule;
  watchlist: DashboardWatchlistModule;
  portfolio: DashboardPortfolioModule;
}
