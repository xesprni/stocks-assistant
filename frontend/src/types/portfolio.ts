// ── Portfolio ───────────────────────────────────────────────────────────────

export type PortfolioMarket = "US" | "A" | "H";

export interface PortfolioItem {
  id: number;
  market: PortfolioMarket;
  symbol: string;
  name: string;
  shares: string | null;
  cost_price: string | null;
  note: string;
  currency: string;
  pe_ttm_ratio: string | null;
  current_price: string | null;
  change_value: string | null;
  change_rate: string | null;
  stock_value: string | null;
  position_ratio: string | null;
  pnl_ratio: string | null;
  valuation_price_source: "live" | "cost" | "unavailable";
  created_at: string;
  updated_at: string;
}

export interface PortfolioItemDraft {
  market: PortfolioMarket;
  symbol: string;
  name: string;
  shares?: string | null;
  cost_price?: string | null;
  note: string;
}

export interface PortfolioListResponse {
  market: PortfolioMarket;
  total_capital: string;
  total_assets: string;
  cash_ratio: string | null;
  items: PortfolioItem[];
  total: number;
  quote_error?: string | null;
  valuation_complete: boolean;
  unpriced_symbols: string[];
}

export interface PortfolioSellDraft {
  shares: string;
  price: string;
  note?: string;
}

export interface PortfolioTransaction {
  id: number;
  market: PortfolioMarket;
  symbol: string;
  name: string;
  side: "buy" | "sell" | "adjust";
  shares: string;
  price: string;
  amount: string;
  realized_pnl: string | null;
  note: string;
  created_at: string;
}

export interface PortfolioTransactionListResponse {
  market: PortfolioMarket;
  transactions: PortfolioTransaction[];
  total: number;
}

export interface PortfolioSellResponse {
  item: PortfolioItem;
  transaction: PortfolioTransaction;
  total_capital: string;
}

export interface PortfolioSearchResult {
  market: PortfolioMarket;
  symbol: string;
  name: string;
  currency: string;
  last_done: string | null;
  change_rate: string | null;
}

export interface PortfolioSearchResponse {
  results: PortfolioSearchResult[];
  total: number;
}
