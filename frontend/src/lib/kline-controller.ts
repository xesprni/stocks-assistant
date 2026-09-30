import { RequestScope } from "@/lib/request-scope";
import type { CandlestickItem, CandlesticksResponse } from "@/types/app";

export type KLinePeriod = "1D" | "1W" | "1M";
type State = { symbol: string; period: KLinePeriod; bars: CandlestickItem[]; loading: boolean };
type LoadBars = (symbol: string, period: KLinePeriod, count: number, init: RequestInit) => Promise<CandlesticksResponse>;
// 预留均线起算历史，使 MA250 首次打开时已有有效曲线。
const INITIAL_COUNT = 500;

export class KLineController {
  private scope = new RequestScope("");
  private state: State = { symbol: "", period: "1D", bars: [], loading: true };
  private listeners = new Set<() => void>();
  private pending = false;
  private exhausted = false;
  constructor(private loadBars: LoadBars) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private patch(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  activate(symbol: string, period: KLinePeriod) {
    this.scope.reset(`${symbol}:${period}`);
    this.pending = false;
    this.exhausted = false;
    // K 线和筹码共用同一份样本，切标的/周期时不能残留旧成本统计。
    this.patch({ symbol, period, bars: [], loading: Boolean(symbol) });
    if (symbol) void this.load(INITIAL_COUNT, false);
  }
  dispose() { this.scope.reset(""); }
  loadMore = () => {
    if (this.pending || this.exhausted || !this.state.bars.length) return;
    void this.load(Math.max(INITIAL_COUNT, this.state.bars.length) + 200, true);
  };
  refresh = () => {
    if (this.pending || !this.state.symbol) return;
    void this.load(Math.max(INITIAL_COUNT, this.state.bars.length), false);
  };
  private async load(count: number, more: boolean) {
    const request = this.scope.begin();
    this.pending = true;
    try {
      const response = await this.loadBars(this.state.symbol, this.state.period, count, { signal: request.signal });
      if (!request.isCurrent()) return;
      if (more && response.bars.length <= this.state.bars.length) this.exhausted = true;
      else this.patch({ bars: response.bars }); // 同一根 K 线的收盘价/成交量也可能更新。
    } catch {
      // 追加或刷新失败保留已有样本；首次失败保持空态，允许下次刷新。
    } finally {
      if (request.isCurrent()) {
        this.pending = false;
        this.patch({ loading: false });
      }
    }
  }
}
