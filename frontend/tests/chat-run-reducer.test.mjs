import assert from "node:assert/strict";
import { test } from "node:test";
import { chatRunReducer, initialChatRunState } from "../src/lib/chat-run-reducer.ts";

const initial = () => initialChatRunState({ id: "pending", role: "assistant", content: "Connecting", status: "Connecting", pending: true, createdAt: "12:00", trace: [] });
function reduce(state, type, data = {}, stopping = false) {
  return chatRunReducer(state, { event: { type, data, event_id: state.sequence + 1, run_id: "run" }, language: "en", stopping, createdAt: "12:01" });
}

const traceStatus = (state, id) => state.trace.find((row) => row.id === id)?.status;
const childEvent = (owner, type, data = {}) => ({ ...owner, child_event_type: type, child_data: data });

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

test("each main turn completes while the overall assistant continues streaming", () => {
  let state = reduce(initial(), "turn_start", { turn: 1 });
  const firstTurnId = state.trace.at(-1).id;
  const runningFirstTurn = state;
  state = reduce(state, "turn_end", { turn: 1, has_tool_calls: true });
  assert.equal(traceStatus(state, firstTurnId), "done");
  assert.equal(traceStatus(runningFirstTurn, firstTurnId), "running");
  assert.equal(state.message.pending, true);
  assert.equal(state.sawAgentEnd, false);
  assert.deepEqual(state.message.trace, state.trace);

  state = reduce(state, "turn_start", { turn: 2 });
  const secondTurnId = state.trace.at(-1).id;
  state = reduce(state, "turn_end", { turn: 2, has_tool_calls: true });
  state = reduce(state, "turn_start", { turn: 3 });
  const thirdTurnId = state.trace.at(-1).id;
  assert.deepEqual([firstTurnId, secondTurnId, thirdTurnId].map((id) => traceStatus(state, id)), ["done", "done", "running"]);
  assert.deepEqual(state.trace.filter((row) => row.status === "running").map((row) => row.id), [thirdTurnId]);
  assert.equal(state.message.pending, true);
});

test("parallel tools complete independently and their turn stays active until turn_end", () => {
  let state = reduce(initial(), "turn_start", { turn: 1 });
  const turnId = state.trace.at(-1).id;
  state = reduce(state, "tool_execution_start", { tool_name: "read_file", tool_call_id: "read-a" });
  state = reduce(state, "tool_execution_start", { tool_name: "read_file", tool_call_id: "read-b" });
  state = reduce(state, "tool_execution_end", { tool_name: "read_file", tool_call_id: "read-b", status: "success" });
  assert.deepEqual([turnId, "read-a", "read-b"].map((id) => traceStatus(state, id)), ["running", "running", "done"]);
  state = reduce(state, "tool_execution_end", { tool_name: "read_file", tool_call_id: "read-a", status: "success" });
  assert.equal(traceStatus(state, turnId), "running");
  state = reduce(state, "turn_end", { turn: 1, has_tool_calls: true });
  assert.deepEqual([turnId, "read-a", "read-b"].map((id) => traceStatus(state, id)), ["done", "done", "done"]);
  assert.equal(state.message.pending, true);
});

test("a later main turn settles a missing turn_end without settling active child turns", () => {
  const owner = { role: "research", batch_id: "batch", task_id: "research-a" };
  let state = reduce(initial(), "turn_start", { turn: 1 });
  const firstTurnId = state.trace.at(-1).id;
  state = reduce(state, "subagent_event", childEvent(owner, "turn_start", { turn: 1 }));
  const childTurnId = state.trace.at(-1).id;
  state = reduce(state, "turn_start", { turn: 2 });
  const secondTurnId = state.trace.at(-1).id;
  assert.deepEqual([firstTurnId, childTurnId, secondTurnId].map((id) => traceStatus(state, id)), ["done", "running", "running"]);
});

test("same-role child tasks expose their identity and isolate turns and matching tool IDs", () => {
  const first = { role: "research", batch_id: "batch", task_id: "company-a" };
  const second = { role: "research", batch_id: "batch", task_id: "company-b" };
  let state = reduce(initial(), "turn_start", { turn: 1 });
  const mainTurnId = state.trace.at(-1).id;
  const rows = [];
  for (const owner of [first, second]) {
    state = reduce(state, "subagent_start", owner);
    const parentId = state.trace.at(-1).id;
    state = reduce(state, "subagent_event", childEvent(owner, "turn_start", { turn: 1 }));
    const turnId = state.trace.at(-1).id;
    state = reduce(state, "subagent_event", childEvent(owner, "tool_execution_start", { tool_name: "read_file", tool_call_id: "shared-call" }));
    const toolId = state.trace.at(-1).id;
    for (const id of [parentId, turnId, toolId]) {
      const row = state.trace.find((item) => item.id === id);
      assert.ok(row.label.includes(owner.role));
      assert.ok(row.label.includes(owner.task_id));
    }
    rows.push({ parentId, turnId, toolId });
  }
  state = reduce(state, "subagent_event", childEvent(first, "tool_execution_end", { tool_name: "read_file", tool_call_id: "shared-call", status: "success" }));
  assert.equal(traceStatus(state, rows[0].toolId), "done");
  assert.equal(traceStatus(state, rows[1].toolId), "running");
  assert.equal(traceStatus(state, rows[0].turnId), "running");
  state = reduce(state, "subagent_event", childEvent(first, "turn_end", { turn: 1 }));
  assert.deepEqual([mainTurnId, rows[0].turnId, rows[1].turnId].map((id) => traceStatus(state, id)), ["running", "done", "running"]);
  state = reduce(state, "turn_end", { turn: 1 });
  assert.equal(traceStatus(state, mainTurnId), "done");
  assert.equal(traceStatus(state, rows[1].turnId), "running");
  state = reduce(state, "subagent_end", { ...first, status: "success" });
  assert.equal(traceStatus(state, rows[0].parentId), "done");
  for (const id of Object.values(rows[1])) assert.equal(traceStatus(state, id), "running");
  assert.equal(state.message.pending, true);
});

test("child ownership includes the batch even when task IDs and turn numbers match", () => {
  const first = { role: "research", batch_id: "batch-a", task_id: "company" };
  const second = { ...first, batch_id: "batch-b" };
  let state = reduce(initial(), "subagent_event", childEvent(first, "turn_start", { turn: 1 }));
  const firstTurnId = state.trace.at(-1).id;
  state = reduce(state, "subagent_event", childEvent(second, "turn_start", { turn: 1 }));
  const secondTurnId = state.trace.at(-1).id;
  assert.notEqual(firstTurnId, secondTurnId);
  state = reduce(state, "subagent_event", childEvent(first, "turn_end", { turn: 1 }));
  assert.deepEqual([firstTurnId, secondTurnId].map((id) => traceStatus(state, id)), ["done", "running"]);
  state = reduce(state, "subagent_end", { ...first, status: "success" });
  assert.equal(traceStatus(state, secondTurnId), "running");
});

test("a later child turn settles only that task's earlier turn when turn_end is missing", () => {
  const first = { role: "research", batch_id: "batch", task_id: "company-a" };
  const second = { ...first, task_id: "company-b" };
  let state = reduce(initial(), "turn_start", { turn: 1 });
  const mainTurnId = state.trace.at(-1).id;
  state = reduce(state, "subagent_event", childEvent(first, "turn_start", { turn: 1 }));
  const previousChildTurnId = state.trace.at(-1).id;
  state = reduce(state, "subagent_event", childEvent(second, "turn_start", { turn: 1 }));
  const siblingTurnId = state.trace.at(-1).id;
  state = reduce(state, "subagent_event", childEvent(first, "turn_start", { turn: 2 }));
  const activeChildTurnId = state.trace.at(-1).id;
  assert.deepEqual([mainTurnId, previousChildTurnId, siblingTurnId, activeChildTurnId].map((id) => traceStatus(state, id)), ["running", "done", "running", "running"]);
  state = reduce(state, "subagent_end", { ...first, status: "success" });
  assert.equal(traceStatus(state, activeChildTurnId), "done");
  assert.equal(traceStatus(state, siblingTurnId), "running");
  assert.equal(traceStatus(state, mainTurnId), "running");
});

test("a terminal error preserves completed history and fails only unfinished work", () => {
  let state = reduce(initial(), "turn_start", { turn: 1 });
  const completedTurnId = state.trace.at(-1).id;
  state = reduce(state, "turn_end", { turn: 1, has_tool_calls: true });
  state = reduce(state, "turn_start", { turn: 2 });
  const activeTurnId = state.trace.at(-1).id;
  state = reduce(state, "tool_execution_start", { tool_name: "read_file", tool_call_id: "completed-tool" });
  state = reduce(state, "tool_execution_start", { tool_name: "read_file", tool_call_id: "unfinished-tool" });
  state = reduce(state, "tool_execution_end", { tool_name: "read_file", tool_call_id: "completed-tool", status: "success" });
  state = reduce(state, "error", { error: "Connection failed" });
  assert.deepEqual([completedTurnId, activeTurnId, "completed-tool", "unfinished-tool"].map((id) => traceStatus(state, id)), ["done", "error", "done", "error"]);
  assert.deepEqual(state.message.trace, state.trace);
  assert.equal(state.message.pending, false);
  assert.equal(state.terminalEventReceived, true);
  assert.equal(state.error, "Connection failed");
});

test("task IDs containing delimiters cannot be mistaken for another task's turns or children", () => {
  const sibling = { role: "research", batch_id: "batch", task_id: "company:turn:peer" };
  const task = { ...sibling, task_id: "company" };
  let state = reduce(initial(), "subagent_start", sibling);
  const siblingId = state.trace.at(-1).id;
  state = reduce(state, "subagent_event", childEvent(sibling, "turn_start", { turn: 1 }));
  const siblingTurnId = state.trace.at(-1).id;
  assert.ok(state.trace.at(-1).label.includes(sibling.task_id), "the visible task name stays readable");
  state = reduce(state, "subagent_event", childEvent(task, "turn_start", { turn: 1 }));
  const taskTurnId = state.trace.at(-1).id;
  assert.equal(traceStatus(state, siblingTurnId), "running");
  state = reduce(state, "subagent_end", { ...task, status: "success" });
  assert.deepEqual([siblingId, siblingTurnId, taskTurnId].map((id) => traceStatus(state, id)), ["running", "running", "done"]);
});

test("summary text can keep streaming after the final execution turn completes", () => {
  let state = reduce(initial(), "turn_start", { turn: 1 });
  const turnId = state.trace.at(-1).id;
  state = reduce(state, "turn_end", { turn: 1, has_tool_calls: true });
  state = reduce(state, "message_update", { delta: "Here is the summary so far." });
  assert.equal(traceStatus(state, turnId), "done");
  assert.equal(state.trace.some((row) => row.status === "running"), false);
  assert.equal(state.message.content, "Here is the summary so far.");
  assert.equal(state.message.pending, true);
  assert.equal(state.sawAgentEnd, false);
});
