import type {
  AppConfig,
  ChatResponse,
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
