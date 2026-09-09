import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const compiled = await build({ entryPoints: [new URL("../src/lib/api.ts", import.meta.url).pathname],
  bundle: true, write: false, format: "esm", platform: "node", define: { "import.meta.env": "{}" },
  tsconfig: new URL("../tsconfig.app.json", import.meta.url).pathname });
const url = `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`;
const loadApi = () => import(`${url}#${crypto.randomUUID()}`);

test("identity switch discards an old JSON result even when fetch ignores abort", async (t) => {
  const api = await loadApi();
  let finish;
  t.mock.method(globalThis, "fetch", () => new Promise((resolve) => { finish = resolve; }));
  api.setAuthTokens({ access_token: "old", refresh_token: "old-refresh" });
  const pending = api.getMe();
  const rejected = assert.rejects(pending, { name: "AbortError" });
  api.setAuthTokens({ access_token: "new", refresh_token: "new-refresh" });
  finish(Response.json({ id: "old-user" }));
  await rejected;
  assert.equal(api.getStoredAccessToken(), "new");
});

test("an old unauthorized write is never replayed with a newly logged-in identity", async (t) => {
  const api = await loadApi();
  let finish; const calls = [];
  t.mock.method(globalThis, "fetch", (url, init) => {
    calls.push({ url, auth: new Headers(init.headers).get("Authorization") });
    return new Promise((resolve) => { finish = resolve; });
  });
  api.setAuthTokens({ access_token: "old", refresh_token: "old-refresh" });
  const pending = api.submitChatInput("session", { request_id: "request", message: "Research", mode: "queue" });
  const rejected = assert.rejects(pending, { name: "AbortError" });
  api.clearAuthTokens(); api.setAuthTokens({ access_token: "new", refresh_token: "new-refresh" });
  finish(Response.json({ detail: "Expired" }, { status: 401 }));
  await rejected;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].auth, "Bearer old");
});

test("normal JSON and Lab SSE share the same authentication retry boundary", async (t) => {
  const api = await loadApi();
  let rotations = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (url === "/api/v1/auth/refresh") { rotations++; return Response.json({ access_token: "new", refresh_token: "next", user: {} }); }
    if (new Headers(init.headers).get("Authorization") === "Bearer old") return Response.json({ detail: "Expired" }, { status: 401 });
    if (url.endsWith("/labs/ai/stream")) return new Response('data: {"type":"run_completed","data":{}}\n\n', { headers: { "Content-Type": "text/event-stream" } });
    return Response.json({ id: "user" });
  });
  api.setAuthTokens({ access_token: "old", refresh_token: "refresh" });
  const events = [];
  await Promise.all([api.getMe(), api.streamLabAI({ kind: "valuation", prompt: "Research" }, (event) => events.push(event))]);
  assert.equal(rotations, 1);
  assert.equal(events.at(-1).type, "run_completed");
});

test("identity is checked after a slow authentication response body is decoded", async (t) => {
  const api = await loadApi();
  let decode, notify;
  const reading = new Promise((resolve) => { notify = resolve; });
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, status: 200,
    json() { notify(); return new Promise((resolve) => { decode = resolve; }); },
  }));
  const oldGeneration = api.getAuthSessionGeneration();
  const login = api.login({ username: "old", password: "fixture" });
  const rejected = assert.rejects(login, { name: "AbortError" });
  await reading;
  api.setAuthTokens({ access_token: "new", refresh_token: "new-refresh" });
  decode({ access_token: "old", refresh_token: "old-refresh", user: { id: "old" } });
  await rejected;
  assert.throws(() => api.restoreAuthTokens({ access_token: "old", refresh_token: "old-refresh" }, oldGeneration), { name: "AbortError" });
  assert.equal(api.getStoredAccessToken(), "new");
});
