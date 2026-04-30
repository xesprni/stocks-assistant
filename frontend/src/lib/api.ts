import type {
  AppConfig,
  CandlesticksResponse,
  ChatResponse,
  IntradayResponse,
  MarketDashboardConfig,
  MarketQuotesResponse,
  WatchlistCategory,
  WatchlistItem,
  WatchlistListResponse,
  WatchlistSearchResponse,
} from "@/types/app";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
    ...init,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = typeof body?.detail === "string" ? body.detail : response.statusText;
    throw new Error(detail || "请求失败");
  }

  return response.json() as Promise<T>;
}

export function checkHealth() {
  return request<{ status: string }>("/api/v1/health");
}

export function loadConfig() {
  return request<AppConfig>("/api/v1/config");
}

export function saveConfig(payload: Record<string, unknown>) {
  return request<AppConfig>("/api/v1/config", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function sendChat(message: string) {
  return request<ChatResponse>("/api/v1/agent/chat", {
    method: "POST",
    body: JSON.stringify({
      message,
      clear_history: false,
    }),
  });
}

export function listWatchlist(category: WatchlistCategory) {
  return request<WatchlistListResponse>(`/api/v1/watchlist?category=${category}`);
}

export function searchWatchlist(query: string, category: WatchlistCategory) {
  const params = new URLSearchParams({ q: query, category, limit: "10" });
  return request<WatchlistSearchResponse>(`/api/v1/watchlist/search?${params.toString()}`);
}

export function addWatchlistItem(item: Omit<WatchlistItem, "id" | "note" | "created_at" | "updated_at">) {
  return request<WatchlistItem>("/api/v1/watchlist", {
    method: "POST",
    body: JSON.stringify({ ...item, note: "" }),
  });
}

export function deleteWatchlistItem(id: number) {
  return request<{ status: string }>(`/api/v1/watchlist/${id}`, {
    method: "DELETE",
  });
}

export function reorderWatchlist(ids: number[]) {
  return request<{ status: string }>("/api/v1/watchlist/reorder", {
    method: "PATCH",
    body: JSON.stringify({ ids }),
  });
}

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

export function getCandlesticks(symbol: string, period: "1D" | "1W" | "1M", count = 200) {
  const params = new URLSearchParams({ symbol, period, count: String(count) });
  return request<CandlesticksResponse>(`/api/v1/market/candlesticks?${params.toString()}`);
}

export function getIntraday(symbol: string) {
  return request<IntradayResponse>(`/api/v1/market/intraday?symbol=${encodeURIComponent(symbol)}`);
}
