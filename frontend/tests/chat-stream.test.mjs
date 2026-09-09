import assert from "node:assert/strict";
import { test } from "node:test";
import { ChatStreamHttpError, consumeChatStream, parseChatSseBlock } from "../src/lib/chat-stream.ts";

const frame = (event) => `id: ${event.event_id}\ndata: ${JSON.stringify(event)}\n\n`;
const event = (event_id, type, data = {}) => ({ event_id, type, run_id: "run-one", data });
const response = (content) => new Response(content, { headers: { "Content-Type": "text/event-stream" } });
const immediate = async () => undefined;

test("a truncated event reconnects from the last full frame and ignores replay duplicates", async () => {
  const cursors = [];
  const received = [];
  const started = event(1, "run_started");
  const first = event(2, "message_update", { delta: "First " });
  const second = event(3, "message_update", { delta: "second" });
  const completed = event(4, "agent_end");
  await consumeChatStream({
    connect: async (cursor) => {
      cursors.push(cursor);
      return cursors.length === 1
        ? response(frame(started) + frame(first) + frame(second).slice(0, -6))
        : response(frame(first) + frame(second) + frame(completed));
    },
    onEvent: (item) => received.push(item),
    waitToReconnect: immediate,
  });
  assert.deepEqual(cursors, [0, 2]);
  assert.equal(received.filter((item) => item.type === "message_update").map((item) => item.data.delta).join(""), "First second");
  assert.deepEqual(received.filter((item) => item.event_id).map((item) => item.event_id), [1, 2, 3, 4]);
  assert.equal(received.filter((item) => item.type === "connection_interrupted").length, 1);
  assert.equal(received.filter((item) => item.type === "connection_restored").length, 1);
});

test("connection failure before the first frame retries with cursor zero", async () => {
  const cursors = [];
  await consumeChatStream({
    connect: async (cursor) => {
      cursors.push(cursor);
      if (cursors.length === 1) throw new TypeError("Failed to fetch");
      return response(frame(event(1, "agent_end")));
    },
    onEvent: () => undefined,
    waitToReconnect: immediate,
  });
  assert.deepEqual(cursors, [0, 0]);
});

test("HTTP conflicts and expired runs fail without retrying the user request", async () => {
  for (const status of [403, 404, 409, 410, 422]) {
    let calls = 0;
    await assert.rejects(consumeChatStream({
      connect: async () => { calls += 1; throw new ChatStreamHttpError(status, "Cannot resume"); },
      onEvent: () => undefined,
      waitToReconnect: immediate,
    }), /Cannot resume/);
    assert.equal(calls, 1);
  }
});

test("temporary gateway errors reconnect but stop remains terminal", async () => {
  let calls = 0;
  const received = [];
  await consumeChatStream({
    connect: async () => {
      calls += 1;
      if (calls < 3) throw new ChatStreamHttpError(502, "Bad gateway");
      return response(frame(event(1, "agent_stopped")));
    },
    onEvent: (item) => received.push(item.type),
    waitToReconnect: immediate,
  });
  assert.equal(calls, 3);
  assert.deepEqual(received, ["connection_interrupted", "connection_restored", "agent_stopped"]);
});

test("detaching during reconnect aborts promptly without another subscription", async () => {
  const controller = new AbortController();
  let calls = 0;
  const promise = consumeChatStream({
    connect: async () => { calls += 1; throw new TypeError("offline"); },
    onEvent: () => setTimeout(() => controller.abort(), 5),
    signal: controller.signal,
  });
  await assert.rejects(promise, { name: "AbortError" });
  assert.equal(calls, 1);
});

test("a stalled connection is detached and resumed instead of waiting forever", async () => {
  let calls = 0;
  await consumeChatStream({
    connect: async (_cursor, signal) => {
      calls += 1;
      if (calls > 1) return response(frame(event(1, "agent_end")));
      return new Response(new ReadableStream({
        start(controller) {
          signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
        },
      }));
    },
    onEvent: () => undefined,
    waitToReconnect: immediate,
    idleTimeoutMs: 5,
  });
  assert.equal(calls, 2);
});

test("detaching a live reader does not classify cancellation as a reconnect", async () => {
  const controller = new AbortController();
  const received = [];
  const promise = consumeChatStream({
    connect: async (_cursor, signal) => new Response(new ReadableStream({
      start(stream) {
        signal.addEventListener("abort", () => stream.error(signal.reason), { once: true });
        setTimeout(() => controller.abort(), 5);
      },
    })),
    signal: controller.signal,
    onEvent: (item) => received.push(item),
    waitToReconnect: immediate,
  });
  await assert.rejects(promise, { name: "AbortError" });
  assert.deepEqual(received, []);
});

test("consumer errors are not mistaken for network failures", async () => {
  let calls = 0;
  await assert.rejects(consumeChatStream({
    connect: async () => { calls += 1; return response(frame(event(1, "message_update"))); },
    onEvent: () => { throw new TypeError("Broken renderer"); },
    waitToReconnect: immediate,
  }), /Broken renderer/);
  assert.equal(calls, 1);
});

test("SSE heartbeats are ignored and CRLF event ids can supply the cursor", () => {
  assert.equal(parseChatSseBlock(": heartbeat"), null);
  assert.deepEqual(parseChatSseBlock('id: 12\r\ndata: {"type":"agent_end",\r\ndata: "data":{}}'), {
    type: "agent_end", data: {}, event_id: 12,
  });
});
