import { type QuoteItem } from "@/types/market";

export type WatchlistCategory = "US" | "A" | "H";

export type WatchlistMarket = WatchlistCategory | "all";

export interface WatchlistGroup {
  id: number;
  name: string;
  item_ids: number[];
}

export interface WatchlistGroupsResponse {
  groups: WatchlistGroup[];
}

export interface WatchlistItem {
  id: number;
  category: WatchlistCategory;
  symbol: string;
  name: string;
  name_cn: string;
  name_en: string;
  name_hk: string;
  exchange: string;
  currency: string;
  last_done: string | null;
  change_value: string | null;
  change_rate: string | null;
  note: string;
  created_at: string;
  updated_at: string;
}

export type WatchlistSearchResult = Omit<WatchlistItem, "id" | "note" | "created_at" | "updated_at">;

export interface WatchlistListResponse {
  items: WatchlistItem[];
  total: number;
}

export interface WatchlistSearchResponse {
  results: WatchlistSearchResult[];
  total: number;
}

export type WatchlistQuoteView = "movers" | "gainers" | "losers" | "active";

export type WatchlistOverviewSource = "local" | "cache" | "live";

export interface WatchlistOverviewRow extends QuoteItem {
  id: number;
  category: WatchlistCategory;
  name_cn: string;
  name_en: string;
  name_hk: string;
  exchange: string;
  currency: string;
  note: string;
  created_at: string;
  updated_at: string;
}

export interface WatchlistOverviewViews {
  movers: WatchlistOverviewRow[];
  gainers: WatchlistOverviewRow[];
  losers: WatchlistOverviewRow[];
  active: WatchlistOverviewRow[];
}

export interface WatchlistOverviewResponse {
  available: boolean;
  error: string | null;
  fetched_at?: string | null;
  stale?: boolean;
  source?: WatchlistOverviewSource | null;
  items: WatchlistOverviewRow[];
  views: WatchlistOverviewViews;
  counts_by_category: Record<string, number>;
  total: number;
  quote_error: string | null;
}
