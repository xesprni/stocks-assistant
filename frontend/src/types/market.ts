// ── Market dashboard ────────────────────────────────────────────────────────

export interface IndexConfig {
  symbol: string;
  name: string;
  enabled: boolean;
}

export interface MarketDashboardConfig {
  indices: IndexConfig[];
  refresh_interval: number;
}

export interface QuoteItem {
  symbol: string;
  name: string;
  category: string;
  last_done: string | null;
  prev_close: string | null;
  open: string | null;
  high: string | null;
  low: string | null;
  volume: string | null;
  turnover: string | null;
  change_value: string | null;
  change_rate: string | null;
}

export interface MarketQuotesResponse {
  quotes: QuoteItem[];
  total: number;
}

// ── Technical analysis ───────────────────────────────────────────────────────

export interface CandlestickItem {
  timestamp: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  turnover: string;
}

export interface CandlesticksResponse {
  symbol: string;
  period: string;
  bars: CandlestickItem[];
}

export interface IntradayItem {
  timestamp: number;
  price: string;
  volume: string;
  turnover: string;
  avg_price: string;
}

export interface IntradayResponse {
  symbol: string;
  prev_close?: string | null;
  bars: IntradayItem[];
}

export interface CapitalFlowItem {
  timestamp: number;
  inflow: string;
}

export interface CapitalFlowResponse {
  source: string;
  symbol: string;
  lines: CapitalFlowItem[];
  total: number;
}

export interface MarketTemperature {
  market: string;
  temperature: number | null;
  description: string;
  valuation: number | null;
  sentiment: number | null;
  updated_at: number | null;
}
