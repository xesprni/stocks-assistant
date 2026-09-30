import { apiErrorDetail, authenticatedFetch, request, sessionSignal } from "@/lib/api/transport";
import { ChatStreamHttpError, consumeChatStream } from "@/lib/chat-stream";
import { parseRenderedImages } from "@/lib/rendered-images";
import type {
  ChatInput,
  ChatInputRequest,
  ChatMessage,
  ChatResponse,
  ChatRunSummary,
  ChatSessionDetail,
  ChatSessionListResponse,
  ChatSessionMessage,
  ChatSessionSummary,
  ChatStreamEvent,
  Conversation,
} from "@/types/app";

export function formatChatTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

export function mapChatMessage(message: ChatSessionMessage): ChatMessage {
  const sources = Array.isArray(message.metadata?.sources)
    ? message.metadata.sources.filter((item): item is NonNullable<ChatMessage["sources"]>[number] => Boolean(item && typeof item === "object" && "id" in item))
    : undefined;
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: formatChatTime(message.created_at),
    sources,
    renderedImages: parseRenderedImages(message.metadata?.rendered_images),
  };
}

export function mapConversation(session: ChatSessionSummary | ChatSessionDetail): Conversation {
  const messages = "messages" in session ? session.messages.map(mapChatMessage) : [];
  const activeRun = "active_run" in session ? session.active_run : undefined;
  // 正在运行的用户问题尚未落入消息表，刷新时用稳定标识补回。
  if (activeRun) messages.push({
    id: `run-user:${activeRun.run_id}`,
    role: "user",
    content: activeRun.user_message,
    createdAt: formatChatTime(session.updated_at),
  });
  return {
    id: session.id,
    title: session.title,
    messages,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    messageCount: session.message_count,
    lastMessage: session.last_message,
    activeRun,
    inputs: "inputs" in session ? session.inputs : undefined,
    inputQueuePaused: "input_queue_paused" in session ? session.input_queue_paused : undefined,
  };
}

export function sendChat(message: string, sessionId?: string | null, clearHistory = false, thinkingEnabled = false) {
  return request<ChatResponse>("/api/v1/agent/chat", {
    method: "POST",
    body: JSON.stringify({
      message,
      session_id: sessionId ?? undefined,
      clear_history: clearHistory,
      thinking_enabled: thinkingEnabled,
    }),
  });
}

export async function fetchChatStream(path: string, init: RequestInit): Promise<Response> {
  const response = await authenticatedFetch(path, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ChatStreamHttpError(response.status, apiErrorDetail(body, response.statusText || "Request failed"));
  }
  return response;
}

export async function streamChat(
  message: string,
  sessionId: string | null | undefined,
  onEvent: (event: ChatStreamEvent) => void,
  clearHistory = false,
  signal?: AbortSignal,
  thinkingEnabled = false,
  requestId: string = crypto.randomUUID(),
) {
  signal = sessionSignal(signal);
  // 首帧前掉线也复用同一 request_id，不重复添加消息或执行工具。
  const startedAt = Date.now();
  let runId: string | undefined;
  return consumeChatStream({
    connect: (afterEventId, connectionSignal) => {
      // 首次确认前长时间休眠应先同步会话，避免幂等缓存过期后重新执行。
      if (!runId && Date.now() - startedAt > 5 * 60 * 1000) {
        throw new ChatStreamHttpError(410, "Streaming connection could not be confirmed");
      }
      return runId ? fetchChatStream(
        `/api/v1/agent/runs/${encodeURIComponent(runId)}/stream?after_event_id=${afterEventId}`,
        { signal: connectionSignal },
      ) : fetchChatStream("/api/v1/agent/stream", {
        method: "POST",
        signal: connectionSignal,
        body: JSON.stringify({
          message,
          session_id: sessionId ?? undefined,
          clear_history: clearHistory,
          thinking_enabled: thinkingEnabled,
          request_id: requestId,
          after_event_id: afterEventId,
        }),
      });
    },
    onEvent: (event) => {
      if (event.run_id) runId = event.run_id;
      onEvent(event);
    },
    signal,
  });
}

export function resumeChatStream(runId: string, onEvent: (event: ChatStreamEvent) => void, signal?: AbortSignal) {
  signal = sessionSignal(signal);
  return consumeChatStream({
    connect: (afterEventId, connectionSignal) => fetchChatStream(
      `/api/v1/agent/runs/${encodeURIComponent(runId)}/stream?after_event_id=${afterEventId}`,
      { signal: connectionSignal },
    ),
    onEvent,
    signal,
  });
}

export function cancelChatRun(runId: string) {
  return request<ChatRunSummary>(`/api/v1/agent/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
}

export function submitChatInput(sessionId: string, payload: ChatInputRequest) {
  return request<ChatInput>(`/api/v1/agent/sessions/${encodeURIComponent(sessionId)}/inputs`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function cancelChatInput(sessionId: string, inputId: string) {
  return request<ChatInput>(`/api/v1/agent/sessions/${encodeURIComponent(sessionId)}/inputs/${encodeURIComponent(inputId)}`, { method: "DELETE" });
}

export function resumeChatInputQueue(sessionId: string) {
  return request<{ active_run: ChatRunSummary | null }>(`/api/v1/agent/sessions/${encodeURIComponent(sessionId)}/inputs/resume`, { method: "POST" });
}

export async function listChatSessions() {
  const response = await request<ChatSessionListResponse>("/api/v1/agent/sessions");
  return response.sessions.map(mapConversation);
}

export async function listChatSessionPage(limit = 20, offset = 0) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const response = await request<ChatSessionListResponse>(`/api/v1/agent/sessions?${params.toString()}`);
  return {
    sessions: response.sessions.map(mapConversation),
    total: response.total,
  };
}

export async function createChatSession(title?: string) {
  const response = await request<ChatSessionDetail>("/api/v1/agent/sessions", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
  return mapConversation(response);
}

export async function getChatSession(sessionId: string) {
  const response = await request<ChatSessionDetail>(`/api/v1/agent/sessions/${sessionId}`);
  return mapConversation(response);
}

export async function updateChatSessionTitle(sessionId: string, title: string) {
  const response = await request<ChatSessionSummary>(`/api/v1/agent/sessions/${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
  return mapConversation(response);
}

export function deleteChatSession(sessionId: string) {
  return request<{ status: string }>(`/api/v1/agent/sessions/${sessionId}`, {
    method: "DELETE",
  });
}

export function deleteAllChatSessions() {
  return request<{ status: string; deleted: number; tracing: string }>("/api/v1/agent/sessions", {
    method: "DELETE",
  });
}

export function clearChatSessionMessages(sessionId: string) {
  return request<{ status: string; deleted: number }>(`/api/v1/agent/sessions/${sessionId}/messages`, {
    method: "DELETE",
  });
}
