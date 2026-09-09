import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthExpiredError, AuthSessionManager } from "../src/lib/auth-session.ts";

function deferred() { let resolve, reject; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; }
const tokens = (name) => ({ access_token: `${name}-access`, refresh_token: `${name}-refresh` });
function setup(refresh) {
  const saved = [], expired = [];
  const manager = new AuthSessionManager({ initial: tokens("old"), refresh,
    persist: (value) => saved.push(value), onExpired: (value) => expired.push(value) });
  return { manager, saved, expired };
}

test("concurrent unauthorized requests share rotation without changing identity", async () => {
  const result = deferred(); let calls = 0;
  const { manager } = setup(() => { calls++; return result.promise; });
  const generation = manager.generation;
  const first = manager.authorizeRetry(generation, "old-access", manager.signal);
  const second = manager.authorizeRetry(generation, "old-access", manager.signal);
  result.resolve(tokens("renewed"));
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(manager.generation, generation);
  await manager.authorizeRetry(generation, "old-access", manager.signal);
  assert.equal(calls, 1, "a late 401 for the expired token reuses the rotated token");
});

for (const outcome of ["success", "failure"]) test(`old refresh ${outcome} cannot overwrite a new identity`, async () => {
  const result = deferred();
  const { manager, expired } = setup(() => result.promise);
  const pending = manager.authorizeRetry(manager.generation, manager.accessToken, manager.signal);
  const rejected = assert.rejects(pending, { name: "AbortError" });
  manager.clear(); manager.replace(tokens("new"));
  if (outcome === "success") result.resolve(tokens("old-renewed"));
  else result.reject(new AuthExpiredError("Expired old account"));
  await rejected;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.accessToken, "new-access");
  assert.deepEqual(expired, []);
});

test("expired credentials wait for same-account recovery and resume within that identity", async () => {
  const { manager, expired } = setup(async () => { throw new AuthExpiredError("Sign in again"); });
  const generation = manager.generation;
  const pending = manager.authorizeRetry(generation, manager.accessToken, manager.signal);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(expired, ["Sign in again"]);
  assert.equal(manager.accessToken, "");
  manager.restore(tokens("restored"), manager.generation);
  await pending;
  assert.equal(manager.generation, generation);
  assert.equal(manager.accessToken, "restored-access");
});

test("aborting one recovery waiter does not cancel other requests", async () => {
  const { manager } = setup(async () => { throw new AuthExpiredError("Expired"); });
  const controller = new AbortController();
  const cancelled = manager.authorizeRetry(manager.generation, manager.accessToken, controller.signal);
  const survivor = manager.authorizeRetry(manager.generation, manager.accessToken, manager.signal);
  const rejected = assert.rejects(cancelled, { name: "AbortError" });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await rejected;
  manager.restore(tokens("restored"), manager.generation);
  await survivor;
});

test("temporary refresh failures retain credentials and allow a later attempt", async () => {
  let calls = 0;
  const { manager, expired } = setup(async () => { if (!calls++) throw new Error("Gateway unavailable"); return tokens("renewed"); });
  await assert.rejects(manager.authorizeRetry(manager.generation, manager.accessToken, manager.signal), /Gateway/);
  assert.equal(manager.accessToken, "old-access");
  assert.deepEqual(expired, []);
  await manager.authorizeRetry(manager.generation, manager.accessToken, manager.signal);
  assert.equal(manager.accessToken, "renewed-access");
});

test("a same-account recovery acknowledgement cannot restore an obsolete identity generation", () => {
  const { manager } = setup(async () => tokens("unused"));
  const generation = manager.generation;
  manager.replace(tokens("new-account"));
  assert.throws(() => manager.restore(tokens("old-account"), generation), { name: "AbortError" });
  assert.equal(manager.accessToken, "new-account-access");
});
