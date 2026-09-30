import { request } from "@/lib/api/transport";
import type {
  CandlesticksResponse,
  CapitalFlowResponse,
  DashboardMarketModule,
  DashboardPortfolioModule,
  DashboardResponse,
  DashboardSymbolInsightsResponse,
  DashboardWatchlistModule,
  IntradayResponse,
  MarketDashboardConfig,
  MarketQuotesResponse,
  MarketTemperature,
} from "@/types/app";

// ── Market dashboard ────────────────────────────────────────────────────────

export function getMarketConfig() {
  return request<MarketDashboardConfig>("/api/v1/market/config");
}

export function saveMarketConfig(config: MarketDashboardConfig) {
  return request<MarketDashboardConfig>("/api/v1/market/config", {
    method: "PUT",
    body: JSON.stringify(config),
  });
}

export function getIndexQuotes() {
  return request<MarketQuotesResponse>("/api/v1/market/index-quotes");
}

export function getStockQuotes(category?: string) {
  const params = category ? `?category=${category}` : "";
  return request<MarketQuotesResponse>(`/api/v1/market/stock-quotes${params}`);
}

export function getDashboard(mode: "bootstrap" | "full" = "full", init?: RequestInit) {
  const params = mode === "full" ? "" : "?mode=bootstrap";
  return request<DashboardResponse>(`/api/v1/dashboard${params}`, init);
}

export function getDashboardMarket(init?: RequestInit) {
  return request<DashboardMarketModule>("/api/v1/dashboard/market", init);
}

export function getDashboardWatchlist(init?: RequestInit) {
  return request<DashboardWatchlistModule>("/api/v1/dashboard/watchlist", init);
}

export function getDashboardPortfolio(init?: RequestInit) {
  return request<DashboardPortfolioModule>("/api/v1/dashboard/portfolio", init);
}

export function getDashboardSymbolInsights(symbol: string, init?: RequestInit) {
  const params = new URLSearchParams({ symbol });
  return request<DashboardSymbolInsightsResponse>(`/api/v1/dashboard/symbol-insights?${params.toString()}`, init);
}

export function getCandlesticks(symbol: string, period: "1D" | "1W" | "1M", count = 200, init?: RequestInit) {
  const params = new URLSearchParams({ symbol, period, count: String(count) });
  return request<CandlesticksResponse>(`/api/v1/market/candlesticks?${params.toString()}`, init);
}

export function getIntraday(symbol: string, since?: number | null) {
  const params = new URLSearchParams({ symbol });
  if (since != null) params.set("since", String(since));
  return request<IntradayResponse>(`/api/v1/market/intraday?${params.toString()}`);
}

export function getCapitalFlow(symbol: string, init?: RequestInit) {
  const params = new URLSearchParams({ symbol });
  return request<CapitalFlowResponse>(`/api/v1/market/capital-flow?${params.toString()}`, init);
}

export function getMarketTemperature(market: string = "US") {
  return request<MarketTemperature>(`/api/v1/market/temperature?market=${market}`);
}
