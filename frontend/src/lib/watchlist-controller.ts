import { applyEntityOrder, restoreEntity } from "@/lib/optimistic-list";
import { RequestScope } from "@/lib/request-scope";
import { reorderVisibleItems, type WatchlistSort } from "@/lib/watchlist-view";
import type { WatchlistItem, WatchlistListResponse, WatchlistMarket, WatchlistOverviewResponse, WatchlistSearchResult } from "@/types/app";

type Dependencies = {
  list: (category: WatchlistMarket, init: RequestInit) => Promise<WatchlistListResponse>;
  overview: (init: RequestInit) => Promise<WatchlistOverviewResponse>;
  add: (result: WatchlistSearchResult) => Promise<WatchlistItem>;
  remove: (id: number) => Promise<unknown>;
  reorder: (ids: number[]) => Promise<unknown>;
  persistSort?: (sort: WatchlistSort) => void;
};
export type WatchlistState = {
  category: WatchlistMarket; items: WatchlistItem[]; loading: boolean; refreshing: boolean; error: string;
  editing: boolean; savingOrder: boolean; mutating: boolean; draftOrder: number[] | null; sort: WatchlistSort; orderError: string;
};

/** Domain controller: reads are replaceable; mutations own entity/order-specific reconciliation. */
export class WatchlistController {
  private scope: RequestScope<WatchlistMarket>;
  private listeners = new Set<() => void>();
  private state: WatchlistState;
  private pending = new Map<WatchlistMarket, number>();
  private disposed = false;

  constructor(category: WatchlistMarket, private readonly api: Dependencies, private committedSort: WatchlistSort = "manual") {
    this.scope = new RequestScope(category);
    this.state = { category, items: [], loading: false, refreshing: false, error: "",
      editing: false, savingOrder: false, mutating: false, draftOrder: null, sort: committedSort, orderError: "" };
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private patch(patch: Partial<WatchlistState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  activate(category: WatchlistMarket) {
    this.disposed = false;
    this.scope.reset(category);
    this.patch({ category, items: [], loading: false, refreshing: false, error: "",
      editing: false, savingOrder: false, mutating: Boolean(this.pending.get(category)), draftOrder: null, sort: this.committedSort, orderError: "" });
    void this.load();
  }
  dispose() {
    this.disposed = true;
    this.scope.reset(this.scope.key);
  }
  private fail(error: unknown) { this.patch({ error: error instanceof Error ? error.message : "Request failed" }); }
  private beginMutation(category: WatchlistMarket) {
    this.pending.set(category, (this.pending.get(category) ?? 0) + 1);
    if (category === this.scope.key) { this.scope.cancel("read"); this.patch({ loading: false, refreshing: false, mutating: true, error: "" }); }
  }
  private endMutation(category: WatchlistMarket) {
    this.pending.set(category, Math.max(0, (this.pending.get(category) ?? 1) - 1));
    if (category === this.scope.key) this.patch({ mutating: Boolean(this.pending.get(category)) });
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
      const incoming = result.items.filter((item) => request.key === "all" || item.category === request.key);
      const failed = Boolean(result.quote_error || result.error);
      const byId = new Map(incoming.map((item) => [item.id, item]));
      // A failed quote refresh is not evidence that a holding vanished or its last price is zero.
      const items = failed && this.state.items.length ? this.state.items.map((old) => {
        const next = byId.get(old.id);
        return next ? {
          ...next, last_done: next.last_done ?? old.last_done,
          change_value: next.change_value ?? old.change_value, change_rate: next.change_rate ?? old.change_rate
        } : old;
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
      if (ticket.isCurrent() && (ticket.key === "all" || item.category === ticket.key)) {
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
  beginEdit() {
    if (this.disposed || this.state.editing || this.state.loading || this.state.mutating) return;
    this.patch({ editing: true, draftOrder: this.state.items.map((item) => item.id), orderError: "" });
  }
  setSort(sort: WatchlistSort) {
    if (this.state.editing && !this.state.savingOrder) this.patch({ sort, orderError: "" });
  }
  reorderDraft(ids: number[]) {
    if (!this.state.editing || this.state.savingOrder || this.state.sort !== "manual") return;
    // 拖动只更新草稿；行情刷新继续按 ID 合并，不会覆盖正在编辑的顺序。
    this.patch({ draftOrder: applyEntityOrder(this.state.items, ids).map((item) => item.id), orderError: "" });
  }
  async finishEdit(visibleIds: number[]): Promise<boolean> {
    if (this.disposed || !this.state.editing || this.state.savingOrder || this.state.mutating) return false;
    const ticket = this.scope.capture();
    const sort = this.state.sort;
    const draft = applyEntityOrder(this.state.items, this.state.draftOrder ?? []);
    const existingIds = new Set(draft.map((item) => item.id));
    const visible = [...new Set(visibleIds)].filter((id) => existingIds.has(id));
    // 筛选或分组内排序仅替换对应槽位，其他公司的相对顺序保持不变。
    const ids = reorderVisibleItems(draft, visible);
    const changed = ids.some((id, index) => id !== this.state.items[index]?.id);
    this.patch({ savingOrder: true, draftOrder: ids, orderError: "" });
    this.beginMutation(ticket.key);
    try {
      if (changed) await this.api.reorder(ids);
      if (!ticket.isCurrent()) return false;
      this.committedSort = sort;
      this.api.persistSort?.(sort);
      this.patch({ items: applyEntityOrder(this.state.items, ids), editing: false, draftOrder: null });
      return true;
    } catch (error) {
      // 保存失败保留草稿和编辑模式；不能把尚未落库的顺序显示成保存成功。
      if (ticket.isCurrent()) this.patch({ orderError: error instanceof Error ? error.message : "Request failed" });
      return false;
    } finally {
      this.endMutation(ticket.key);
      if (ticket.isCurrent()) this.patch({ savingOrder: false });
      else if (ticket.key === this.scope.key) void this.load();
    }
  }
}
