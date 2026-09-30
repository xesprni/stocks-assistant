// ── News ────────────────────────────────────────────────────────────────────

export interface SecurityNewsItem {
  id: string;
  title: string;
  description: string;
  url: string;
  published_at: string | null;
  published_at_ts: number | null;
  likes_count: number | null;
  comments_count: number | null;
  shares_count: number | null;
}

export interface SecurityNewsResponse {
  symbol: string;
  news: SecurityNewsItem[];
  total: number;
}

// ── Fundamentals ─────────────────────────────────────────────────────────────

export type FinancialReportKind = "All" | "IncomeStatement" | "BalanceSheet" | "CashFlow";

export type FinancialReportPeriod = "Annual" | "SemiAnnual" | "Q1" | "Q2" | "Q3" | "ThreeQ" | "QuarterlyFull";

export interface FinancialReportColumn {
  key: string;
  label: string;
  year: number | null;
  fp_end: string | null;
}

export interface FinancialReportCell {
  period: string;
  value: string | null;
  ratio: string | null;
  yoy: string | null;
  year: number | null;
  fp_end: string | null;
}

export interface FinancialReportRow {
  field: string;
  name: string;
  percent: boolean;
  tip: string;
  cells: FinancialReportCell[];
}

export interface FinancialStatementTable {
  code: string;
  name: string;
  title: string;
  short_title: string;
  currency: string;
  has_yoy: boolean;
  columns: FinancialReportColumn[];
  rows: FinancialReportRow[];
}

export interface FinancialReportsResponse {
  symbol: string;
  kind: FinancialReportKind;
  period: FinancialReportPeriod | null;
  statements: FinancialStatementTable[];
}
