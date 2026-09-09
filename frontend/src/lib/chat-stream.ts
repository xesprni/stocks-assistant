import type { ChatStreamEvent } from "../types/app";

export class ChatStreamHttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ChatStreamHttpError";
    this.status = status;
  }
}

class StreamDisconnectedError extends Error {}

export function parseChatSseBlock(block: string): ChatStreamEvent | null {
  const lines = block.split(/\r?\n/);
  const data = lines.filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart()).join("\n");
  if (!data) return null;
  const event = JSON.parse(data) as ChatStreamEvent;
  const id = lines.find((line) => line.startsWith("id:"))?.slice(3).trim();
  if (event.event_id == null && id && /^\d+$/.test(id)) event.event_id = Number(id);
  return event;
}

export function waitForChatReconnect(attempt: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (typeof window !== "undefined") {
        window.removeEventListener("online", finish);
        window.removeEventListener("pageshow", finish);
      }
    };
    const finish = () => { cleanup(); resolve(); };
    const abort = () => { cleanup(); reject(signal?.reason); };
    const timer = setTimeout(finish, Math.min(500 * 2 ** Math.min(attempt, 4), 5000));
    signal?.addEventListener("abort", abort, { once: true });
    if (typeof window !== "undefined") {
      window.addEventListener("online", finish, { once: true });
      window.addEventListener("pageshow", finish, { once: true });
    }
  });
}

const TERMINAL_EVENTS = new Set(["agent_end", "agent_stopped", "error"]);

/** 连接只订阅已有任务；重连必须保留任务标识，避免再次执行用户请求。 */
export async function consumeChatStream(options: {
  connect: (afterEventId: number, signal: AbortSignal) => Promise<Response>;
  onEvent: (event: ChatStreamEvent) => void;
  signal?: AbortSignal;
  waitToReconnect?: typeof waitForChatReconnect;
  idleTimeoutMs?: number;
}) {
  const { connect, onEvent, signal, waitToReconnect = waitForChatReconnect, idleTimeoutMs = 45000 } = options;
  let cursor = 0;
  let attempt = 0;
  let reconnecting = false;
  while (true) {
    signal?.throwIfAborted();
    const connection = new AbortController();
    const abortConnection = () => connection.abort(signal?.reason);
    signal?.addEventListener("abort", abortConnection, { once: true });
    let idleTimer: ReturnType<typeof setTimeout>;
    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => connection.abort(new StreamDisconnectedError("Streaming connection timed out")), idleTimeoutMs);
    };
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let callbackError: unknown;
    const deliver = (event: ChatStreamEvent) => {
      try { onEvent(event); } catch (error) { callbackError = error; throw error; }
    };
    try {
      resetIdleTimer();
      const response = await connect(cursor, connection.signal);
      if (!response.body) throw new Error("This browser does not support streaming responses");
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try { chunk = await reader.read(); } catch (error) {
          signal?.throwIfAborted();
          throw new StreamDisconnectedError(error instanceof Error ? error.message : "Streaming connection interrupted");
        }
        if (chunk.done) throw new StreamDisconnectedError("Streaming response ended before completion");
        resetIdleTimer();
        if (reconnecting && chunk.value.length > 0) {
          deliver({ type: "connection_restored" });
          reconnecting = false;
        }
        buffer += decoder.decode(chunk.value, { stream: true });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const event = parseChatSseBlock(block);
          if (!event) continue;
          // 只确认完整事件；截断帧留给服务端按游标重新发送。
          if (event.event_id != null && event.event_id <= cursor) continue;
          deliver(event);
          if (event.event_id != null) cursor = event.event_id;
          attempt = 0;
          if (TERMINAL_EVENTS.has(event.type)) return;
        }
      }
    } catch (error) {
      signal?.throwIfAborted();
      if (callbackError !== undefined) throw callbackError;
      const retryable = error instanceof StreamDisconnectedError || error instanceof TypeError
        || connection.signal.aborted
        || (error instanceof ChatStreamHttpError && (error.status === 408 || error.status === 429 || error.status >= 500));
      if (!retryable) throw error;
      if (!reconnecting) {
        onEvent({ type: "connection_interrupted" });
        reconnecting = true;
      }
    } finally {
      clearTimeout(idleTimer!);
      signal?.removeEventListener("abort", abortConnection);
      connection.abort();
      if (reader) {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    }
    await waitToReconnect(attempt++, signal);
  }
}
