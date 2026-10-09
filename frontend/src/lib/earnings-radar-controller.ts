import { RequestScope } from "@/lib/request-scope";
import type { EarningsRadarRequest, EarningsRadarResponse } from "@/types/earnings";
import type { WatchlistItem, WatchlistListResponse } from "@/types/app";

export const RADAR_MAX_SYMBOLS = 20;
export const RADAR_DEFAULT_DAYS = 45;
export const RADAR_WINDOWS = [30, 45, 60, 90];
export function parseRadarSymbols(text: string) {
  return [...new Set(text.trim().toUpperCase().split(/[\s,，;；]+/).filter(Boolean)
    .map((symbol) => /\.(US|HK|SH|SZ|CN|SG)$/.test(symbol) ? symbol : `${symbol}.US`))];
}
type State = { result: EarningsRadarResponse | null; loading: boolean; importing: boolean; error: string; watchlistItems: WatchlistItem[]; watchlistError: string };
type Scan = (request: EarningsRadarRequest, init: RequestInit) => Promise<EarningsRadarResponse>;
type Watchlist = (category: "US", init: RequestInit) => Promise<WatchlistListResponse>;

export class EarningsRadarController {
  private scope = new RequestScope("");
  private state: State = { result: null, loading: false, importing: false, error: "", watchlistItems: [], watchlistError: "" };
  private listeners = new Set<() => void>();
  constructor(private scan: Scan, private watchlist: Watchlist) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private patch(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  dispose() { this.scope.reset(""); }
  cancel() { this.scope.cancel("scan"); this.patch({ loading: false }); }
  async run(body: EarningsRadarRequest) {
    const request = this.scope.begin("scan");
    this.patch({ loading: true, result: null, error: "" });
    try {
      const result = await this.scan(body, { signal: request.signal });
      if (request.isCurrent()) this.patch({ result });
    } catch (error) {
      if (request.isCurrent()) this.patch({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (request.isCurrent()) this.patch({ loading: false });
    }
  }
  cancelWatchlist() { this.scope.cancel("watchlist"); this.patch({ importing: false }); }
  async loadWatchlist() {
    const request = this.scope.begin("watchlist");
    this.patch({ importing: true, watchlistItems: [], watchlistError: "" });
    try {
      const result = await this.watchlist("US", { signal: request.signal });
      if (request.isCurrent()) this.patch({ watchlistItems: result.items });
    } catch (error) {
      if (request.isCurrent()) this.patch({ watchlistError: error instanceof Error ? error.message : String(error) });
    } finally {
      if (request.isCurrent()) this.patch({ importing: false });
    }
  }
}
