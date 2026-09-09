import type { ChatInput, ChatInputRequest } from "../types/app";

const statusOrder: Record<ChatInput["status"], number> = {
  pending: 0, running: 1, applied: 2, failed: 3, cancelled: 4, completed: 4,
};

// HTTP 确认与 SSE 可能乱序返回，旧状态不能覆盖已经应用的补充指令。
export function upsertChatInput(inputs: ChatInput[], incoming: ChatInput): ChatInput[] {
  const previous = inputs.find((input) => input.id === incoming.id);
  if (previous && (previous.updated_at > incoming.updated_at
    || (previous.updated_at === incoming.updated_at && statusOrder[previous.status] > statusOrder[incoming.status]))) {
    return inputs;
  }
  const merged = [...inputs.filter((input) => input.id !== incoming.id), incoming]
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  // 活动输入始终保留，历史上限只淘汰终态，避免旧的排队消息被后续消息挤出。
  const isActive = (input: ChatInput) => ["pending", "running", "applied"].includes(input.status);
  const active = merged.filter(isActive);
  const terminalLimit = Math.max(0, 100 - active.length);
  const recentTerminal = terminalLimit > 0 ? merged.filter((input) => !isActive(input)).slice(-terminalLimit) : [];
  const retained = new Set([...active, ...recentTerminal].map((input) => input.id));
  return merged.filter((input) => retained.has(input.id));
}

export function mergeChatInputs(current: ChatInput[], incoming: ChatInput[]): ChatInput[] {
  return current.reduce((merged, input) => upsertChatInput(merged, input), incoming);
}

export function visibleChatInputs(inputs: ChatInput[]): ChatInput[] {
  return inputs.filter((input) => input.status !== "completed" && input.status !== "cancelled");
}

export function hasPendingChatQueue(inputs: ChatInput[]): boolean {
  return inputs.some((input) => input.mode === "queue" && input.status === "pending");
}

export function chatInputDraftKey(sessionId: string | null): string {
  return sessionId ?? "new-conversation";
}

// 未收到成功确认时重试同一请求；改正文、模式或目标运行后才生成新请求。
export function prepareChatInputRequest(
  payload: Omit<ChatInputRequest, "request_id">,
  previous: ChatInputRequest | undefined,
  createId: () => string,
): ChatInputRequest {
  if (previous && previous.message === payload.message && previous.mode === payload.mode
    && previous.target_run_id === payload.target_run_id
    && previous.thinking_enabled === payload.thinking_enabled) return previous;
  return { ...payload, request_id: createId() };
}
