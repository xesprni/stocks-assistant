/** Cancels superseded reads and validates late completions even when a transport ignores abort. */
export class RequestScope<Key> {
  private generation = 0;
  private lanes = new Map<string, AbortController>();
  constructor(public key: Key) {}

  capture() {
    const generation = this.generation;
    return { key: this.key, isCurrent: () => this.generation === generation };
  }

  begin(lane = "read") {
    this.cancel(lane);
    const controller = new AbortController();
    this.lanes.set(lane, controller);
    const scope = this.capture();
    return { ...scope, signal: controller.signal, isCurrent: () => scope.isCurrent() && !controller.signal.aborted };
  }

  cancel(lane: string) { this.lanes.get(lane)?.abort(); this.lanes.delete(lane); }

  reset(key: Key) {
    for (const controller of this.lanes.values()) controller.abort();
    this.lanes.clear();
    this.generation += 1;
    this.key = key;
  }
}
