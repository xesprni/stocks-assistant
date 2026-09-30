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

test("edit drafts do not write until close, which commits once even under repeated toggles", async () => {
  const saved = deferred(), calls = [], preferences = [];
  const controller = watchlist({ reorder: (ids) => { calls.push(ids); return saved.promise; }, persistSort: (sort) => preferences.push(sort) });
  controller.activate("US"); await tick();
  controller.reorderDraft([3, 2, 1]);
  assert.equal(controller.snapshot().draftOrder, null);
  controller.beginEdit();
  controller.reorderDraft([2, 1, 3]);
  controller.reorderDraft([2, 3, 1]);
  controller.reorderDraft([3, 2, 1]);
  assert.deepEqual(calls, []);
  assert.deepEqual(controller.snapshot().items.map((row) => row.id), [1, 2, 3]);
  const saving = controller.finishEdit([3, 2, 1]);
  assert.equal(controller.snapshot().savingOrder, true);
  assert.equal(controller.snapshot().editing, true);
  assert.equal(await controller.finishEdit([3, 2, 1]), false);
  assert.equal(calls.length, 1);
  assert.deepEqual(preferences, []);
  saved.resolve(); assert.equal(await saving, true);
  assert.deepEqual(controller.snapshot().items.map((row) => row.id), [3, 2, 1]);
  assert.equal(controller.snapshot().editing, false);
  assert.equal(controller.snapshot().savingOrder, false);
  assert.equal(controller.snapshot().draftOrder, null);
  assert.deepEqual(preferences, ["manual"]);
});

test("a failed save preserves the draft and edit mode for retry, including chosen sort", async () => {
  const calls = [], preferences = [];
  const controller = watchlist({ reorder: async (ids) => { calls.push(ids); if (calls.length === 1) throw new Error("Reorder failed"); },
    persistSort: (sort) => preferences.push(sort) });
  controller.activate("US"); await tick();
  controller.beginEdit(); controller.setSort("gainers");
  assert.equal(await controller.finishEdit([3, 1, 2]), false);
  assert.equal(controller.snapshot().editing, true);
  assert.equal(controller.snapshot().savingOrder, false);
  assert.equal(controller.snapshot().mutating, false);
  assert.equal(controller.snapshot().sort, "gainers");
  assert.equal(controller.snapshot().orderError, "Reorder failed");
  assert.deepEqual(controller.snapshot().draftOrder, [3, 1, 2]);
  assert.deepEqual(controller.snapshot().items.map((row) => row.id), [1, 2, 3]);
  assert.deepEqual(preferences, []);
  assert.equal(await controller.finishEdit([3, 1, 2]), true);
  assert.deepEqual(calls, [[3, 1, 2], [3, 1, 2]]);
  assert.deepEqual(preferences, ["gainers"]);
  assert.equal(controller.snapshot().orderError, "");
  controller.activate("US"); await tick();
  assert.equal(controller.snapshot().sort, "gainers");
});

test("fresh quotes, deletions and additions survive a pending edit without resurrecting rows", async () => {
  const calls = [];
  const controller = watchlist({ reorder: async (ids) => { calls.push(ids); },
    overview: async () => overview([1, 2, 3].map((id) => ({ ...item(id), last_done: "125" }))) });
  controller.activate("US"); await tick();
  controller.beginEdit(); controller.reorderDraft([3, 1, 2]);
  await controller.refresh();
  assert.deepEqual(controller.snapshot().draftOrder, [3, 1, 2]);
  await controller.remove(item(2));
  await controller.add(item(4));
  assert.equal(await controller.finishEdit([3, 1, 4, 2, 3, 99]), true);
  assert.deepEqual(calls, [[3, 1, 4]]);
  assert.deepEqual(controller.snapshot().items.map((row) => row.id), [3, 1, 4]);
  assert.equal(controller.snapshot().items[0].last_done, "125");
});

test("closing a filtered sort preserves hidden slots and saves a preference without redundant writes", async () => {
  const calls = [], preferences = [];
  const controller = watchlist({ reorder: async (ids) => { calls.push(ids); }, persistSort: (sort) => preferences.push(sort) });
  controller.activate("US"); await tick();
  controller.beginEdit(); controller.setSort("name");
  assert.equal(await controller.finishEdit([3, 1]), true);
  assert.deepEqual(calls, [[3, 2, 1]]);
  assert.deepEqual(preferences, ["name"]);
  controller.beginEdit(); controller.setSort("manual");
  assert.equal(await controller.finishEdit([3, 1]), true);
  assert.equal(calls.length, 1);
  assert.deepEqual(preferences, ["name", "manual"]);
});

test("late save completions cannot close a new edit or persist its predecessor's preference", async () => {
  const saved = deferred(), preferences = [];
  const controller = watchlist({ reorder: () => saved.promise, persistSort: (sort) => preferences.push(sort) });
  controller.activate("US"); await tick();
  controller.beginEdit(); controller.setSort("losers");
  const saving = controller.finishEdit([3, 2, 1]);
  controller.activate("H"); await tick();
  controller.beginEdit();
  saved.resolve(); assert.equal(await saving, false);
  assert.equal(controller.snapshot().category, "H");
  assert.equal(controller.snapshot().editing, true);
  assert.equal(controller.snapshot().sort, "manual");
  assert.deepEqual(preferences, []);
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
