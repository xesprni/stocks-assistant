import assert from "node:assert/strict";
import { test } from "node:test";
import { subagentCountDetails, subagentTraceStatus, upsertSubagentTrace } from "../src/lib/subagent-trace.ts";

const traceEvent = (id, status, label = status) => ({ id, status, label, createdAt: "10:00" });

test("queued tasks become running and finish without duplicate trace rows", () => {
  const id = "sub:batch:research";
  let trace = upsertSubagentTrace([], traceEvent(id, "info", "queued"));
  trace = upsertSubagentTrace(trace, traceEvent(id, "running", "started"));
  trace = upsertSubagentTrace(trace, traceEvent(id, "done", "completed"), true);
  assert.equal(trace.length, 1);
  assert.equal(trace[0].label, "completed");
  assert.equal(trace[0].status, "done");
});

test("timeout settles only unfinished descendants of its task", () => {
  const id = "sub:batch:research";
  const trace = upsertSubagentTrace([
    traceEvent(id, "running"),
    traceEvent(`${id}:turn:1`, "running"),
    traceEvent(`${id}:tool:old`, "done"),
    traceEvent("sub:batch:risk:turn:1", "running"),
  ], traceEvent(id, subagentTraceStatus("timeout"), "timed out"), true);
  assert.deepEqual(trace.map((item) => item.status), ["error", "error", "done", "running"]);
});

test("terminal event restores a task lost to the trace cap or a resumed stream", () => {
  const prior = Array.from({ length: 30 }, (_, index) => traceEvent(`tool:${index}`, "done"));
  const trace = upsertSubagentTrace(prior, traceEvent("sub:batch:task", "info", "skipped"), true);
  assert.equal(trace.length, 30);
  assert.equal(trace.at(-1).label, "skipped");
  assert.equal(trace[0].id, "tool:1");
});

test("cancellation and dependency skips are neutral, failures and timeouts are errors", () => {
  assert.deepEqual(["success", "error", "timeout", "cancelled", "skipped", "unknown"].map(subagentTraceStatus),
    ["done", "error", "error", "info", "info", "error"]);
});

test("batch counts distinguish partial results while legacy events omit the summary", () => {
  const labels = { success: "已完成", error: "失败", timeout: "超时", cancelled: "取消", skipped: "跳过" };
  assert.equal(subagentCountDetails(undefined, labels), "");
  assert.equal(subagentCountDetails({ success: 2, error: 0, timeout: 1, skipped: 1 }, labels),
    "已完成 2 · 超时 1 · 跳过 1");
  assert.equal(subagentCountDetails({ success: -1, error: 0.5, timeout: "3" }, labels), "");
});
