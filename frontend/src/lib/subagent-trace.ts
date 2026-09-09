import type { ChatTraceEvent, ChatTraceStatus } from "../types/app";

export type SubagentOutcome = "success" | "error" | "timeout" | "cancelled" | "skipped";

export function subagentTraceStatus(outcome: string): ChatTraceStatus {
  if (outcome === "success") return "done";
  if (outcome === "cancelled" || outcome === "skipped") return "info";
  return "error";
}

/** 排队、开始和结束共用一条记录；结束帧也可恢复被 30 条上限淘汰的父任务。 */
export function upsertSubagentTrace(
  trace: ChatTraceEvent[],
  event: ChatTraceEvent,
  settleChildren = false,
): ChatTraceEvent[] {
  let found = false;
  const next = trace.map((item) => {
    if (item.id === event.id) {
      found = true;
      return { ...item, ...event, createdAt: item.createdAt };
    }
    if (settleChildren && item.id.startsWith(`${event.id}:`) && item.status === "running") {
      return { ...item, status: event.status };
    }
    return item;
  });
  if (!found) next.push(event);
  return next.slice(-30);
}

export function subagentCountDetails(
  counts: unknown,
  labels: Record<SubagentOutcome, string>,
): string {
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) return "";
  return (Object.keys(labels) as SubagentOutcome[]).flatMap((outcome) => {
    const count = (counts as Record<string, unknown>)[outcome];
    return typeof count === "number" && Number.isInteger(count) && count > 0
      ? [`${labels[outcome]} ${count}`] : [];
  }).join(" · ");
}
