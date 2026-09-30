import { request } from "@/lib/api/transport";
import type {
  PortfolioItem,
  PortfolioItemDraft,
  PortfolioListResponse,
  PortfolioMarket,
  PortfolioSearchResponse,
  PortfolioSellDraft,
  PortfolioSellResponse,
  PortfolioTransactionListResponse,
} from "@/types/app";

// ── Portfolio ───────────────────────────────────────────────────────────────

export function listPortfolio(market: PortfolioMarket, init?: RequestInit) {
  return request<PortfolioListResponse>(`/api/v1/portfolio?market=${market}`, init);
}

export function searchPortfolioSymbols(query: string, market: PortfolioMarket) {
  const params = new URLSearchParams({ q: query, market, limit: "10" });
  return request<PortfolioSearchResponse>(`/api/v1/portfolio/search?${params.toString()}`);
}

export function addPortfolioItem(item: PortfolioItemDraft) {
  return request<PortfolioItem>("/api/v1/portfolio", {
    method: "POST",
    body: JSON.stringify(item),
  });
}

export function updatePortfolioItem(id: number, item: Partial<PortfolioItemDraft>) {
  return request<PortfolioItem>(`/api/v1/portfolio/${id}`, {
    method: "PATCH",
    body: JSON.stringify(item),
  });
}

export function deletePortfolioItem(id: number) {
  return request<{ status: string }>(`/api/v1/portfolio/${id}`, {
    method: "DELETE",
  });
}

export function savePortfolioSettings(market: PortfolioMarket, totalCapital: string) {
  return request<{ market: PortfolioMarket; total_capital: string }>(`/api/v1/portfolio/settings/${market}`, {
    method: "PUT",
    body: JSON.stringify({ total_capital: totalCapital }),
  });
}

export function listPortfolioTransactions(market: PortfolioMarket) {
  return request<PortfolioTransactionListResponse>(`/api/v1/portfolio/transactions?market=${market}&limit=100`);
}

export function sellPortfolioItem(id: number, payload: PortfolioSellDraft) {
  return request<PortfolioSellResponse>(`/api/v1/portfolio/${id}/sell`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
