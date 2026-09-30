import { request } from "@/lib/api/transport";
import type {
  WatchlistGroupsResponse,
  WatchlistItem,
  WatchlistListResponse,
  WatchlistMarket,
  WatchlistOverviewResponse,
  WatchlistSearchResponse,
} from "@/types/app";

export function listWatchlist(category: WatchlistMarket, init?: RequestInit) {
  return request<WatchlistListResponse>(`/api/v1/watchlist${category === "all" ? "" : `?category=${category}`}`, init);
}

export function getWatchlistOverview(init?: RequestInit) {
  return request<WatchlistOverviewResponse>("/api/v1/watchlist/overview", init);
}

export function searchWatchlist(query: string, category: WatchlistMarket, init?: RequestInit) {
  const params = new URLSearchParams({ q: query, limit: "10" });
  if (category !== "all") params.set("category", category);
  return request<WatchlistSearchResponse>(`/api/v1/watchlist/search?${params.toString()}`, init);
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

export function listWatchlistGroups(init?: RequestInit) {
  return request<WatchlistGroupsResponse>("/api/v1/watchlist/groups", init);
}

export function saveWatchlistGroup(name: string, id?: number) {
  return request<WatchlistGroupsResponse>(`/api/v1/watchlist/groups${id == null ? "" : `/${id}`}`, {
    method: id == null ? "POST" : "PATCH", body: JSON.stringify({ name }),
  });
}

export function deleteWatchlistGroup(id: number) {
  return request<WatchlistGroupsResponse>(`/api/v1/watchlist/groups/${id}`, { method: "DELETE" });
}

export function setWatchlistGroupMembers(id: number, itemIds: number[]) {
  return request<WatchlistGroupsResponse>(`/api/v1/watchlist/groups/${id}/members`, {
    method: "PUT", body: JSON.stringify({ item_ids: itemIds }),
  });
}
