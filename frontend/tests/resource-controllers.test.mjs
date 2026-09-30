import assert from "node:assert/strict";
import { test } from "node:test";
import { WatchlistController } from "../src/lib/watchlist-controller.ts";
import { reconcileConversationClear } from "../src/lib/conversation-reconciliation.ts";

function deferred() { let resolve, reject; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; }
const tick = () => new Promise((resolve) => setImmediate(resolve));
const item = (id, category = "US") => ({ id, symbol: `${id}.${category}`, category, name: `Stock ${id}` });
const overview = (items) => ({ items, error: null, quote_error: null });
function watchlist(overrides = {}) {
  return new WatchlistController("US", { list: async () => ({ items: [item(1), item(2), item(3)] }),
    overview: async () => overview([]), add: async (value) => value, remove: async () => {}, reorder: async () => {}, ...overrides });
}

test("old quote responses cannot replace the newly selected category", async () => {
  const old = deferred(); let oldSignal;
  const controller = watchlist({ list: async (category) => ({ items: [item(category === "US" ? 1 : 8, category)] }),
    overview: ({ signal }) => { oldSignal = signal; return old.promise; } });
  controller.activate("US"); await tick();
  const refresh = controller.refresh();
  controller.activate("H"); await tick();
  old.resolve(overview([item(1)])); await refresh;
  assert.equal(oldSignal.aborted, true);
  assert.deepEqual(controller.snapshot().items.map((row) => row.id), [8]);
  assert.equal(controller.snapshot().category, "H");
});

test("late additions cannot select or insert a stock into another category", async () => {
  const added = deferred();
  const controller = watchlist({ list: async (category) => ({ items: [item(1, category)] }), add: () => added.promise });
  controller.activate("US"); await tick();
  const pending = controller.add(item(2));
  controller.activate("H"); await tick();
  added.resolve(item(2));
  assert.equal(await pending, undefined);
  assert.deepEqual(controller.snapshot().items.map((row) => row.category), ["H"]);
});

test("failed or incomplete quote refreshes preserve the last trustworthy displayed prices", async () => {
  let response = { ...overview([{ ...item(1), last_done: null, change_rate: null, change_value: null }]), quote_error: "Quote provider unavailable" };
  const controller = watchlist({ list: async () => ({ items: [{ ...item(1), last_done: "123", change_rate: "2", change_value: "3" }] }),
    overview: async () => response });
  controller.activate("US"); await tick();
  await controller.refresh();
  assert.equal(controller.snapshot().items[0].last_done, "123");
  assert.equal(controller.snapshot().items[0].change_rate, "2");
  response = { ...overview([]), error: "Service unavailable" };
  await controller.refresh();
  assert.equal(controller.snapshot().items[0].last_done, "123");
  assert.equal(controller.snapshot().error, "Service unavailable");
});

test("failed deletion restores only its entity, preserving later deletion and addition", async () => {
  const failed = deferred();
  const controller = watchlist({ remove: (id) => id === 1 ? failed.promise : Promise.resolve() });
  controller.activate("US"); await tick();
  const removal = controller.remove(item(1));
  await controller.remove(item(2));
  await controller.add(item(4));
  failed.reject(new Error("Delete failed")); await removal;
  assert.deepEqual(controller.snapshot().items.map((row) => row.id), [1, 3, 4]);
});

test("reorders serialize and coalesce queued intents without replaying a stale rollback", async () => {
  const first = deferred(), last = deferred(), calls = [];
  const controller = watchlist({ reorder: (ids) => { calls.push(ids); return calls.length === 1 ? first.promise : last.promise; } });
  controller.activate("US"); await tick();
  controller.reorder([2, 1, 3]);
  controller.reorder([2, 3, 1]);
  controller.reorder([3, 2, 1]);
  assert.equal(calls.length, 1);
  first.reject(new Error("First failed")); await tick();
  assert.deepEqual(calls, [[2, 1, 3], [3, 2, 1]]);
  assert.deepEqual(controller.snapshot().items.map((row) => row.id), [3, 2, 1]);
  last.resolve(); await tick();
  assert.equal(controller.snapshot().error, "");
});

test("a failed final order restores order without resurrecting a removed entity", async () => {
  const sort = deferred();
  const controller = watchlist({ reorder: () => sort.promise });
  controller.activate("US"); await tick();
  controller.reorder([3, 1, 2]);
  await controller.remove(item(2));
  await controller.add(item(4));
  sort.reject(new Error("Reorder failed")); await tick();
  assert.deepEqual(controller.snapshot().items.map((row) => row.id), [1, 3, 4]);
});

test("bulk-clear reconciliation preserves new sessions, newer local edits and later deletions", () => {
  const conversation = (id, title = id, messages = []) => ({ id, title, messages });
  const snapshot = [conversation("old", "Old title", [{ id: "message" }]), conversation("deleted")];
  const current = [conversation("new"), conversation("edited", "New title")];
  const persisted = [conversation("old"), conversation("deleted"), conversation("edited", "Stale title")];
  const result = reconcileConversationClear({ current, persisted, snapshot, deletedIds: new Set(["deleted"]) });
  assert.deepEqual(result.map((row) => row.id), ["new", "edited", "old"]);
  assert.equal(result[1].title, "New title");
  assert.deepEqual(result[2].messages, [{ id: "message" }]);
  assert.deepEqual(reconcileConversationClear({ current, persisted: [], snapshot, deletedIds: new Set() }), current);
});

test("all-market watchlist keeps mixed-market quotes and additions", async () => {
  const controller = watchlist({ list: async () => ({ items: [item(1), item(2, "H")] }),
    overview: async () => overview([item(1), item(2, "H")]) });
  controller.activate("all"); await tick();
  await controller.refresh();
  assert.deepEqual(controller.snapshot().items.map((entry) => entry.category), ["US", "H"]);
  assert.equal((await controller.add(item(3, "A"))).category, "A");
  assert.deepEqual(controller.snapshot().items.map((entry) => entry.category), ["US", "H", "A"]);
});
