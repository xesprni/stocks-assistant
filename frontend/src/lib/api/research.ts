import { request } from "@/lib/api/transport";
import type {
  FinancialReportKind,
  FinancialReportPeriod,
  FinancialReportsResponse,
  SecurityNewsResponse
} from "@/types/app";

// ── News ────────────────────────────────────────────────────────────────────

export function getSecurityNews(symbol: string, limit = 50, init?: RequestInit) {
  const params = new URLSearchParams({ symbol, limit: String(limit) });
  return request<SecurityNewsResponse>(`/api/v1/news?${params.toString()}`, init);
}

// ── Fundamentals ─────────────────────────────────────────────────────────────

export function getFinancialReports(
  symbol: string,
  kind: FinancialReportKind = "All",
  period?: FinancialReportPeriod | "",
) {
  const params = new URLSearchParams({ symbol, kind });
  if (period) params.set("period", period);
  return request<FinancialReportsResponse>(`/api/v1/fundamentals/financial-reports?${params.toString()}`);
}
