import assert from "node:assert/strict";
import { test } from "node:test";
import { createMarketConfigController } from "../src/lib/market-config-controller.ts";

const defaults = { indices: [{ symbol: "HSI.HK", name: "恒生指数", enabled: true }], refresh_interval: 60 };
const added = { symbol: "HSTECH.HK", name: "恒生科技指数", enabled: true };
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function setup(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = [], drafts = [], saved = [], states = [], successes = [], errors = [];
  const controller = createMarketConfigController({
    persist: (config) => {
      const completion = Promise.withResolvers();
      calls.push({ config: structuredClone(config), ...completion });
      return completion.promise;
    },
    onDraft: (value) => drafts.push(value), onSaved: (value) => saved.push(value),
    onState: (value) => states.push(value), onSuccess: () => successes.push(true),
    onError: (error) => errors.push(error),
  });
  controller.acceptSaved(structuredClone(defaults));
  t.after(() => controller.dispose());
  return {
    controller, calls, drafts, saved, states, successes, errors,
    async tick(ms) { t.mock.timers.tick(ms); await settle(); },
    async succeed(index) { calls[index].resolve(calls[index].config); await settle(); },
  };
}

test("adding an index saves immediately and only successful writes notify", async (t) => {
  const h = setup(t);
  await h.tick(1000);
  assert.equal(h.calls.length, 0);
  assert.equal(h.successes.length, 0);
  h.controller.patch({ indices: [...defaults.indices, added] });
  await settle();
  assert.deepEqual(h.calls[0].config.indices, [...defaults.indices, added]);
  assert.equal(h.successes.length, 0);
  await h.succeed(0);
  assert.equal(h.successes.length, 1);
  assert.equal(h.controller.isDirty(), false);
  assert.equal(h.states.at(-1), "saved");
  await h.controller.flush();
  assert.equal(h.calls.length, 1);
  assert.equal(h.successes.length, 1);
});

test("a late save cannot erase subsequent additions, toggles or removals", async (t) => {
  const h = setup(t);
  h.controller.patch({ indices: [...defaults.indices, added] });
  await settle();
  const latest = [{ ...added, enabled: false }];
  h.controller.patch({ indices: latest });
  await settle();
  assert.equal(h.calls.length, 1);
  await h.succeed(0);
  assert.deepEqual(h.drafts.at(-1).indices, latest);
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls[1].config.indices, latest);
  await h.succeed(1);
  assert.deepEqual(h.saved.at(-1).indices, latest);
  assert.equal(h.controller.isDirty(), false);
});

test("refresh interval debounces; explicit save flushes the latest value", async (t) => {
  const h = setup(t);
  h.controller.patch({ refresh_interval: 90 });
  await h.tick(799);
  assert.equal(h.calls.length, 0);
  h.controller.patch({ refresh_interval: 120 });
  const done = h.controller.flush();
  await settle();
  assert.equal(h.calls[0].config.refresh_interval, 120);
  await h.succeed(0);
  await done;
  await h.tick(1000);
  assert.equal(h.calls.length, 1);
});

test("an edit retains its debounce while an earlier write completes", async (t) => {
  const h = setup(t);
  h.controller.patch({ indices: [...defaults.indices, added] });
  await settle();
  h.controller.patch({ refresh_interval: 90 });
  await h.tick(400);
  await h.succeed(0);
  assert.equal(h.calls.length, 1);
  await h.tick(400);
  assert.equal(h.calls[1].config.refresh_interval, 90);
  await h.succeed(1);
});

test("invalid intervals stay pending without requests or success messages", async (t) => {
  const h = setup(t);
  for (const refresh_interval of [0, 3601, 1.5, NaN]) {
    h.controller.patch({ refresh_interval });
    await h.tick(1000);
    await h.controller.flush();
  }
  assert.equal(h.calls.length, 0);
  assert.equal(h.successes.length, 0);
  h.controller.patch({ refresh_interval: 3600 });
  await h.tick(800);
  await h.succeed(0);
});

test("failure retains the latest draft and retries only on an explicit command", async (t) => {
  const h = setup(t);
  h.controller.patch({ indices: [...defaults.indices, added] });
  await settle();
  h.controller.patch({ refresh_interval: 90 });
  const failure = new Error("Save failed");
  h.calls[0].reject(failure);
  await settle();
  await h.tick(10000);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.errors, [failure]);
  assert.equal(h.successes.length, 0);
  assert.equal(h.states.at(-1), "error");
  assert.equal(h.controller.isDirty(), true);
  assert.equal(h.drafts.at(-1).refresh_interval, 90);
  assert.deepEqual(h.drafts.at(-1).indices, [...defaults.indices, added]);
  const done = h.controller.flush();
  await settle();
  assert.equal(h.calls[1].config.refresh_interval, 90);
  await h.succeed(1);
  await done;
  assert.equal(h.successes.length, 1);
});

test("reverting to the baseline while saving queues a corrective write", async (t) => {
  const h = setup(t);
  h.controller.patch({ indices: [...defaults.indices, added] });
  await settle();
  h.controller.patch({ indices: defaults.indices });
  await h.succeed(0);
  assert.deepEqual(h.calls[1].config.indices, defaults.indices);
  await h.succeed(1);
  assert.equal(h.controller.isDirty(), false);
});

test("reset cancels pending changes and dispose suppresses late callbacks", async (t) => {
  const h = setup(t);
  h.controller.patch({ refresh_interval: 90 });
  h.controller.reset();
  await h.tick(1000);
  assert.equal(h.calls.length, 0);
  assert.deepEqual(h.drafts.at(-1), defaults);
  h.controller.patch({ indices: [...defaults.indices, added] });
  await settle();
  h.controller.dispose();
  await h.succeed(0);
  assert.deepEqual(h.saved.at(-1), defaults);
  assert.equal(h.successes.length, 0);
});
