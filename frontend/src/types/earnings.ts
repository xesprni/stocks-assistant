export type EarningsTiming = "before_open" | "after_close" | "unknown";
export type RadarValuation = "high" | "above" | "normal" | "below" | "unavailable";
export interface EarningsEvent {
  date: string; timing: EarningsTiming; period: string; eps_estimate: string | null;
  revenue_estimate: string | null; currency: string; reported: boolean;
}
export interface EarningsMove {
  date: string; timing: EarningsTiming; period: string; before_date: string; after_date: string;
  before_close: string; after_close: string; move_pct: number;
}
export interface EarningsOptionPricing {
  expiry: string; primary_expiry: string; fallback: boolean; dte: number; days_after_earnings: number;
  strike: string; call_symbol: string; put_symbol: string; call_price: string; put_price: string;
  call_timestamp: string | null; put_timestamp: string | null; straddle: string;
  implied_move_pct: number; iv_pct: number | null;
}
export interface EarningsRadarItem {
  symbol: string; name: string; status: "ready" | "partial" | "unavailable";
  spot: string | null; spot_timestamp: string | null; next_event: EarningsEvent | null;
  option: EarningsOptionPricing | null; history: EarningsMove[]; sample_count: number;
  historical_median_pct: number | null; hv30_pct: number | null; ratio: number | null;
  valuation: RadarValuation; issues: string[];
}
export interface EarningsRadarResponse {
  source: string; timezone: string; as_of: string; window_start: string; window_end: string;
  history_start: string; items: EarningsRadarItem[];
}
export interface EarningsRadarRequest { symbols: string[]; days_ahead: number }
