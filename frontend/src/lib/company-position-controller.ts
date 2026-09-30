import { RequestScope } from "@/lib/request-scope";
import type { PortfolioItem, PortfolioListResponse, PortfolioMarket } from "@/types/app";

type State = { position: PortfolioItem | null; loading: boolean; error: string };
type LoadPortfolio = (market: PortfolioMarket, init: RequestInit) => Promise<PortfolioListResponse>;

export class CompanyPositionController {
  private scope = new RequestScope("");
  private state: State = { position: null, loading: true, error: "" };
  private listeners = new Set<() => void>();
  constructor(private loadPortfolio: LoadPortfolio) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private patch(update: Partial<State>) {
    this.state = { ...this.state, ...update };
    this.listeners.forEach((listener) => listener());
  }
  activate(symbol: string) { this.scope.reset(symbol); void this.load(symbol); }
  dispose() { this.scope.reset(""); }
  private async load(symbol: string) {
    const request = this.scope.begin();
    const market: PortfolioMarket = symbol.endsWith(".HK") ? "H" : /\.(SH|SZ)$/.test(symbol) ? "A" : "US";
    this.patch({ position: null, loading: true, error: "" });
    try {
      const response = await this.loadPortfolio(market, { signal: request.signal });
      if (request.isCurrent()) this.patch({ position: response.items.find((item) => item.symbol === symbol) ?? null });
    } catch (error) {
      if (request.isCurrent()) this.patch({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (request.isCurrent()) this.patch({ loading: false });
    }
  }
}
