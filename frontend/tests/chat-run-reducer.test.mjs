import assert from "node:assert/strict";
import { test } from "node:test";
import { chatRunReducer, initialChatRunState } from "../src/lib/chat-run-reducer.ts";

const initial = () => initialChatRunState({ id: "pending", role: "assistant", content: "Connecting", status: "Connecting", pending: true, createdAt: "12:00", trace: [] });
function reduce(state, type, data = {}, stopping = false) {
  return chatRunReducer(state, { event: { type, data, event_id: state.sequence + 1, run_id: "run" }, language: "en", stopping, createdAt: "12:01" });
}

test("stream projection is deterministic and never mutates its input", () => {
  const state = initial();
  const action = { event: { type: "tool_execution_start", data: { tool_name: "read_file" }, event_id: 1 }, language: "en", stopping: false, createdAt: "12:01" };
  const next = chatRunReducer(state, action);
  assert.deepEqual(chatRunReducer(state, action), next);
  assert.deepEqual(state.trace, []);
  assert.equal(next.trace[0].status, "running");
});

test("messages, discarded deltas and final persistence metadata produce one completed assistant", () => {
  let state = reduce(initial(), "message_update", { delta: "Keep discard" });
  state = reduce(state, "message_reset", { discarded_content: " discard" });
  assert.equal(state.message.content, "Keep");
  state = reduce(state, "agent_end", { final_response: "Final", message_id: "persisted", sources: [{ id: "source" }] });
  assert.equal(state.message.id, "persisted");
  assert.equal(state.message.content, "Final");
  assert.equal(state.message.pending, false);
  assert.deepEqual(state.message.sources, [{ id: "source" }]);
  assert.equal(state.sawAgentEnd, true);
});

test("main and delegated tool projection share completion and image artifact semantics", () => {
  const artifact = { artifact_id: "a".repeat(32), width: 20, height: 30, files: { image: `artifacts/renderings/${"a".repeat(32)}/image.png` } };
  let state = reduce(initial(), "tool_execution_start", { tool_name: "render_image", tool_call_id: "main" });
  state = reduce(state, "tool_execution_end", { tool_name: "render_image", tool_call_id: "main", status: "success", result: artifact });
  const child = (type, data) => ({ role: "research", batch_id: "batch", task_id: "task", child_event_type: type, child_data: data });
  state = reduce(state, "subagent_event", child("tool_execution_start", { tool_name: "render_image", tool_call_id: "child" }));
  state = reduce(state, "subagent_event", child("tool_execution_end", { tool_name: "render_image", tool_call_id: "child", status: "success", result: artifact }));
  assert.deepEqual(state.trace.map((row) => [row.id, row.status]), [["main", "done"], ["sub:batch:task:tool:child", "done"]]);
  assert.equal(state.renderedImages.length, 1);
});

test("recovery, cancellation and terminal errors retain the existing public state semantics", () => {
  let state = reduce(initial(), "message_update", { delta: "Partial" });
  state = reduce(state, "connection_interrupted");
  assert.equal(state.message.pending, true);
  assert.equal(state.message.content, "Partial");
  state = reduce(state, "connection_restored", {}, true);
  state = reduce(state, "agent_stopped", {}, true);
  assert.equal(state.message.pending, false);
  assert.equal(state.sawAgentEnd, true);
  assert.match(state.message.content, /Partial/);
  const failed = reduce(initial(), "error", { error: "Provider failed" });
  assert.equal(failed.terminalEventReceived, true);
  assert.equal(failed.error, "Provider failed");
});
