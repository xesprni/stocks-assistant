import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chatInputDraftKey,
  hasPendingChatQueue,
  mergeChatInputs,
  prepareChatInputRequest,
  upsertChatInput,
  visibleChatInputs,
} from "../src/lib/chat-inputs.ts";

function input(id, status, mode = "queue", updatedAt = "2026-09-09T10:00:00Z") {
  return {
    id, session_id: "session-1", request_id: `request-${id}`, message: `message ${id}`,
    mode, status, target_run_id: null, run_id: null,
    created_at: "2026-09-09T09:00:00Z", updated_at: updatedAt, error: null,
  };
}

test("late HTTP acknowledgement cannot undo an applied steer received over SSE", () => {
  const applied = input("steer-1", "applied", "steer", "2026-09-09T10:00:01Z");
  const inputs = upsertChatInput([], applied);
  assert.deepEqual(upsertChatInput(inputs, input("steer-1", "pending", "steer")), inputs);
  assert.deepEqual(upsertChatInput(inputs, { ...applied, status: "pending" }), inputs);
});

test("queue lifecycle updates one row and removes settled entries from the pending view", () => {
  let inputs = upsertChatInput([], input("one", "pending"));
  assert.equal(hasPendingChatQueue(inputs), true);
  inputs = upsertChatInput(inputs, input("one", "running"));
  assert.equal(inputs.length, 1);
  assert.equal(hasPendingChatQueue(inputs), false);
  inputs = upsertChatInput(inputs, input("one", "completed"));
  assert.deepEqual(visibleChatInputs(inputs), []);
});

test("unapplied steer and failed queue do not enable queue continuation", () => {
  const inputs = [input("steer", "pending", "steer"), input("failed", "failed")];
  assert.equal(hasPendingChatQueue(inputs), false);
  assert.equal(visibleChatInputs(inputs).length, 2);
  assert.equal(visibleChatInputs([...inputs, input("cancelled", "cancelled")]).length, 2);
});

test("unconfirmed sends retain their idempotency key and generate a new key for edited payloads", () => {
  let counter = 0;
  const createId = () => `request-${++counter}`;
  const payload = { message: "Check risk", mode: "steer", target_run_id: "run-one", thinking_enabled: false };
  const first = prepareChatInputRequest(payload, undefined, createId);
  assert.equal(prepareChatInputRequest(payload, first, createId), first);
  assert.notEqual(prepareChatInputRequest({ ...payload, message: "Check liquidity" }, first, createId).request_id, first.request_id);
  assert.notEqual(prepareChatInputRequest({ ...payload, target_run_id: "run-two" }, first, createId).request_id, first.request_id);
  assert.notEqual(prepareChatInputRequest({ ...payload, mode: "queue", target_run_id: undefined }, first, createId).request_id, first.request_id);
});

test("draft storage is isolated between existing conversations and the new conversation", () => {
  const drafts = new Map([
    [chatInputDraftKey(null), "new"],
    [chatInputDraftKey("one"), "first"],
    [chatInputDraftKey("two"), "second"],
  ]);
  assert.equal(drafts.size, 3);
  assert.equal(drafts.get(chatInputDraftKey("one")), "first");
  assert.equal(drafts.get(chatInputDraftKey(null)), "new");
});

test("history limits retain old queued, executing, and applied inputs", () => {
  let inputs = [input("old-queue", "pending"), input("old-run", "running"), input("old-steer", "applied", "steer")];
  for (let index = 0; index < 110; index += 1) {
    inputs = upsertChatInput(inputs, { ...input(`completed-${index}`, "completed"), created_at: `2026-09-10T10:${String(index).padStart(3, "0")}:00Z` });
  }
  assert.equal(inputs.length, 100);
  assert.deepEqual(inputs.slice(0, 3).map((item) => item.id), ["old-queue", "old-run", "old-steer"]);
  assert.equal(hasPendingChatQueue(inputs), true);
  assert.equal(inputs.at(-1).id, "completed-109");
});

test("session refresh merges newer SSE state received while the request was in flight", () => {
  const applied = input("steer", "applied", "steer", "2026-09-09T10:00:02Z");
  const cancelled = input("queue", "cancelled", "queue", "2026-09-09T10:00:02Z");
  const current = [applied, cancelled, input("new-queue", "pending")];
  const snapshot = [input("steer", "pending", "steer"), input("queue", "pending")];
  const merged = mergeChatInputs(current, snapshot);
  assert.equal(merged.find((item) => item.id === "steer").status, "applied");
  assert.equal(merged.find((item) => item.id === "queue").status, "cancelled");
  assert.equal(merged.find((item) => item.id === "new-queue").status, "pending");
});
