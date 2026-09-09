import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const compiled = await build({
  entryPoints: [new URL("../src/lib/api.ts", import.meta.url).pathname],
  bundle: true, write: false, format: "esm", platform: "node",
  define: { "import.meta.env": "{}" },
  tsconfig: new URL("../tsconfig.app.json", import.meta.url).pathname,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`;
const loadApi = () => import(`${moduleUrl}#${crypto.randomUUID()}`);

test("input submission distinguishes a definite rejection from an unconfirmed server failure", async (t) => {
  const api = await loadApi();
  const payload = { request_id: "retry-id", message: "Check risk", mode: "steer", target_run_id: "run-one" };
  let status = 409;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body), payload);
    return Response.json({ detail: "Target no longer accepts input" }, { status });
  });
  await assert.rejects(api.submitChatInput("session", payload), (error) => error instanceof api.ApiHttpError && error.status === 409);
  status = 503;
  await assert.rejects(api.submitChatInput("session", payload), (error) => error instanceof api.ApiHttpError && error.status === 503);
});

test("input endpoints retain the original request id and encode the owning session", async (t) => {
  const api = await loadApi();
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
    return Response.json({ id: "input", status: "pending" });
  });
  const payload = { request_id: "same-request", message: "Follow up", mode: "queue" };
  await api.submitChatInput("session/one", payload);
  await api.submitChatInput("session/one", payload);
  await api.cancelChatInput("session/one", "input/one");
  await api.resumeChatInputQueue("session/one");
  assert.deepEqual(calls.slice(0, 2).map((call) => call.body.request_id), ["same-request", "same-request"]);
  assert.equal(calls[0].url, "/api/v1/agent/sessions/session%2Fone/inputs");
  assert.equal(calls[2].method, "DELETE");
  assert.equal(calls[2].url, "/api/v1/agent/sessions/session%2Fone/inputs/input%2Fone");
  assert.equal(calls[3].url, "/api/v1/agent/sessions/session%2Fone/inputs/resume");
});

test("session hydration restores the queue, paused flag, and next active run", async (t) => {
  const api = await loadApi();
  const run = { run_id: "next-run", request_id: "request", session_id: "session", user_message: "Next task", status: "running" };
  const input = { id: "input", session_id: "session", message: "Later task", mode: "queue", status: "pending" };
  t.mock.method(globalThis, "fetch", async () => Response.json({
    id: "session", title: "Research", created_at: "2026-09-09T00:00:00Z", updated_at: "2026-09-09T01:00:00Z",
    message_count: 0, messages: [], active_run: run, inputs: [input], input_queue_paused: true,
  }));
  const conversation = await api.getChatSession("session");
  assert.equal(conversation.inputQueuePaused, true);
  assert.deepEqual(conversation.inputs, [input]);
  assert.deepEqual(conversation.activeRun, run);
  assert.deepEqual(conversation.messages.map((message) => message.id), ["run-user:next-run"]);
});
