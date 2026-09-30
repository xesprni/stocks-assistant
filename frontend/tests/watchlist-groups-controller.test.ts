import assert from "node:assert/strict";
import { test } from "node:test";
import { WatchlistGroupsController } from "../src/lib/watchlist-groups-controller";
import type { WatchlistGroupsResponse } from "../src/types/app";
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve!: (value: WatchlistGroupsResponse) => void;
  const promise = new Promise<WatchlistGroupsResponse>((done) => { resolve = done; });
  return { resolve, promise };
}
const group = { id: 1, name: "Core", item_ids: [1, 2] };
const deps = { list: async () => ({ groups: [group] }), save: async () => ({ groups: [group] }),
  members: async () => ({ groups: [group] }), remove: async () => ({ groups: [] }) };

test("late reads cannot overwrite saved membership and repeated submissions are serialized", async () => {
  const stale = deferred(), write = deferred(); let writes = 0;
  const controller = new WatchlistGroupsController({ ...deps, list: () => stale.promise,
    members: () => { writes++; return write.promise; } });
  controller.activate();
  const saving = controller.setMembers(1, [9]);
  assert.equal(await controller.setMembers(1, [10]), false);
  write.resolve({ groups: [{ ...group, item_ids: [9] }] });
  assert.equal(await saving, true);
  stale.resolve({ groups: [group] }); await tick();
  assert.deepEqual(controller.snapshot().groups[0].item_ids, [9]);
  assert.equal(controller.snapshot().saving, false);
  assert.equal(writes, 1);
});

test("failed writes retain confirmed groups and expose errors", async () => {
  const controller = new WatchlistGroupsController({ ...deps, remove: async () => { throw new Error("Unavailable"); } });
  controller.activate(); await tick();
  assert.equal(await controller.remove(1), false);
  assert.deepEqual(controller.snapshot().groups, [group]);
  assert.equal(controller.snapshot().error, "Unavailable");
});

test("StrictMode restart discards prior requests", async () => {
  const stale = deferred(); let reads = 0;
  const controller = new WatchlistGroupsController({ ...deps, list: () => ++reads === 1 ? stale.promise : Promise.resolve({ groups: [group] }) });
  controller.activate(); controller.dispose(); controller.activate(); await tick();
  stale.resolve({ groups: [] }); await tick();
  assert.deepEqual(controller.snapshot().groups, [group]);
});
