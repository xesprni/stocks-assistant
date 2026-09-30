import { RequestScope } from "@/lib/request-scope";
import type { WatchlistGroup, WatchlistGroupsResponse } from "@/types/app";

type Dependencies = {
  list: (init: RequestInit) => Promise<WatchlistGroupsResponse>;
  save: (name: string, id?: number) => Promise<WatchlistGroupsResponse>;
  remove: (id: number) => Promise<WatchlistGroupsResponse>;
  members: (id: number, itemIds: number[]) => Promise<WatchlistGroupsResponse>;
};
type State = { groups: WatchlistGroup[]; loading: boolean; saving: boolean; error: string };

export class WatchlistGroupsController {
  private scope = new RequestScope("groups");
  private listeners = new Set<() => void>();
  private state: State = { groups: [], loading: true, saving: false, error: "" };
  private disposed = false;
  constructor(private api: Dependencies) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private patch(update: Partial<State>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...update };
    for (const listener of this.listeners) listener();
  }
  activate() { this.disposed = false; void this.load(); }
  dispose() { this.disposed = true; this.scope.reset("groups"); }
  async load() {
    if (this.state.saving || this.disposed) return;
    const request = this.scope.begin();
    this.patch({ loading: true, error: "" });
    try {
      const result = await this.api.list({ signal: request.signal });
      if (request.isCurrent()) this.patch({ groups: result.groups });
    } catch (error) {
      if (request.isCurrent()) this.patch({ error: error instanceof Error ? error.message : "Request failed" });
    } finally { if (request.isCurrent()) this.patch({ loading: false }); }
  }
  private async mutate(command: () => Promise<WatchlistGroupsResponse>) {
    if (this.state.saving || this.disposed) return false;
    this.scope.cancel("read");
    const ticket = this.scope.capture();
    this.patch({ saving: true, loading: false, error: "" });
    try {
      const result = await command();
      if (!ticket.isCurrent()) return false;
      this.patch({ groups: result.groups });
      return true;
    } catch (error) {
      if (ticket.isCurrent()) this.patch({ error: error instanceof Error ? error.message : "Request failed" });
      return false;
    } finally {
      // StrictMode 重挂载或过期读取不能覆盖已确认的写入结果。
      this.patch({ saving: false });
      if (!ticket.isCurrent() && !this.disposed) void this.load();
    }
  }
  save(name: string, id?: number) { return this.mutate(() => this.api.save(name, id)); }
  remove(id: number) { return this.mutate(() => this.api.remove(id)); }
  setMembers(id: number, itemIds: number[]) { return this.mutate(() => this.api.members(id, itemIds)); }
}
