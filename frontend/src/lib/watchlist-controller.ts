import { RequestScope } from "@/lib/request-scope";
import { applyEntityOrder, restoreEntity } from "@/lib/optimistic-list";
import type { WatchlistCategory, WatchlistItem, WatchlistListResponse, WatchlistOverviewResponse, WatchlistSearchResult } from "@/types/app";

type Dependencies = {
  list: (category: WatchlistCategory, init: RequestInit) => Promise<WatchlistListResponse>;
  overview: (init: RequestInit) => Promise<WatchlistOverviewResponse>;
  add: (result: WatchlistSearchResult) => Promise<WatchlistItem>;
  remove: (id: number) => Promise<unknown>;
  reorder: (ids: number[]) => Promise<unknown>;
};
export type WatchlistState = {
  category: WatchlistCategory; items: WatchlistItem[]; loading: boolean; refreshing: boolean; error: string;
};

/** Domain controller: reads are replaceable; mutations own entity/order-specific reconciliation. */
export class WatchlistController {
  private scope: RequestScope<WatchlistCategory>;
  private listeners = new Set<() => void>();
  private state: WatchlistState;
  private pending = new Map<WatchlistCategory, number>();
  private sorting = new Map<WatchlistCategory, { pending: number[] | null; confirmed: number[]; ticket: ReturnType<RequestScope<WatchlistCategory>["capture"]> }>();
  private disposed = false;

  constructor(category: WatchlistCategory, private readonly api: Dependencies) {
    this.scope = new RequestScope(category);
    this.state = { category, items: [], loading: false, refreshing: false, error: "" };
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private patch(patch: Partial<WatchlistState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  activate(category: WatchlistCategory) {
    this.disposed = false;
    this.scope.reset(category);
    this.patch({ category, items: [], loading: false, refreshing: false, error: "" });
    void this.load();
  }
  dispose() {
    this.disposed = true;
    this.scope.reset(this.scope.key);
    for (const sort of this.sorting.values()) sort.pending = null;
  }
  private fail(error: unknown) { this.patch({ error: error instanceof Error ? error.message : "Request failed" }); }
  private beginMutation(category: WatchlistCategory) {
    this.pending.set(category, (this.pending.get(category) ?? 0) + 1);
    if (category === this.scope.key) { this.scope.cancel("read"); this.patch({ loading: false, refreshing: false, error: "" }); }
  }
  private endMutation(category: WatchlistCategory) {
    this.pending.set(category, Math.max(0, (this.pending.get(category) ?? 1) - 1));
  }
  async load() {
    if (this.disposed || this.pending.get(this.scope.key)) return;
    const request = this.scope.begin();
    this.patch({ loading: true, refreshing: false, error: "" });
    try {
      const result = await this.api.list(request.key, { signal: request.signal });
      if (request.isCurrent()) this.patch({ items: result.items });
    } catch (error) { if (request.isCurrent()) this.fail(error); }
    finally { if (request.isCurrent()) this.patch({ loading: false }); }
  }
  async refresh(): Promise<WatchlistOverviewResponse | undefined> {
    if (this.disposed || this.pending.get(this.scope.key) || this.state.refreshing || this.state.loading) return;
    const request = this.scope.begin();
    this.patch({ refreshing: true, error: "" });
    try {
      const result = await this.api.overview({ signal: request.signal });
      if (!request.isCurrent()) return;
      const incoming = result.items.filter((item) => item.category === request.key);
      const failed = Boolean(result.quote_error || result.error);
      const byId = new Map(incoming.map((item) => [item.id, item]));
      // A failed quote refresh is not evidence that a holding vanished or its last price is zero.
      const items = failed && this.state.items.length ? this.state.items.map((old) => {
        const next = byId.get(old.id);
        return next ? { ...next, last_done: next.last_done ?? old.last_done,
          change_value: next.change_value ?? old.change_value, change_rate: next.change_rate ?? old.change_rate } : old;
      }) : incoming;
      this.patch({ items });
      if (result.quote_error || result.error) this.patch({ error: result.quote_error || result.error || "Request failed" });
      return result;
    } catch (error) { if (request.isCurrent()) this.fail(error); }
    finally { if (request.isCurrent()) this.patch({ refreshing: false }); }
  }
  async add(result: WatchlistSearchResult): Promise<WatchlistItem | undefined> {
    const ticket = this.scope.capture();
    this.beginMutation(ticket.key);
    try {
      const item = await this.api.add(result);
      if (ticket.isCurrent() && item.category === ticket.key) {
        this.patch({ items: [...this.state.items.filter((entry) => entry.symbol !== item.symbol), item] });
        return item;
      }
    } catch (error) { if (ticket.isCurrent()) this.fail(error); }
    finally {
      this.endMutation(ticket.key);
      if (!ticket.isCurrent() && ticket.key === this.scope.key) void this.load();
    }
  }
  async remove(item: WatchlistItem) {
    const ticket = this.scope.capture();
    const previous = this.state.items;
    this.beginMutation(ticket.key);
    this.patch({ items: previous.filter((entry) => entry.id !== item.id) });
    try { await this.api.remove(item.id); }
    catch (error) {
      if (ticket.isCurrent()) {
        this.patch({ items: restoreEntity(this.state.items, item, previous) });
        this.fail(error);
      }
    } finally {
      this.endMutation(ticket.key);
      if (!ticket.isCurrent() && ticket.key === this.scope.key) void this.load();
    }
  }
  reorder(ids: number[]) {
    if (this.disposed) return;
    const category = this.scope.key;
    const previous = this.state.items.map((item) => item.id);
    this.patch({ items: applyEntityOrder(this.state.items, ids), error: "" });
    const existing = this.sorting.get(category);
    if (existing) { existing.pending = ids; existing.ticket = this.scope.capture(); return; }
    const queue = { pending: ids as number[] | null, confirmed: previous, ticket: this.scope.capture() };
    this.sorting.set(category, queue);
    this.beginMutation(category);
    void (async () => {
      try {
        while (queue.pending && !this.disposed) {
          const order = queue.pending;
          queue.pending = null;
          try { await this.api.reorder(order); queue.confirmed = order; }
          catch (error) {
            // A newer intent supersedes the failed order; never restore an entire stale list.
            if (!queue.pending && queue.ticket.isCurrent()) {
              this.patch({ items: applyEntityOrder(this.state.items, queue.confirmed) });
              this.fail(error);
            }
          }
        }
      } finally {
        this.sorting.delete(category);
        this.endMutation(category);
        if (!queue.ticket.isCurrent() && category === this.scope.key) void this.load();
      }
    })();
  }
}
