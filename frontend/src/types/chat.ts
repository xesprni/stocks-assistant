/** intl: green=up, red=down | cn: red=up, green=down */

export type ChatRole = "assistant" | "user";

export type ChatTraceStatus = "info" | "running" | "done" | "error";

export type RenderedImageFile = "image.png" | "top.png" | "middle.png" | "bottom.png" | "mobile.png";

export interface RenderedImage {
  artifact_id: string;
  width: number;
  height: number;
  files: Partial<Record<"image" | "top" | "middle" | "bottom" | "mobile", string>>;
}

export interface ChatTraceEvent {
  id: string;
  label: string;
  detail?: string;
  status: ChatTraceStatus;
  createdAt: string;
}

export interface SourceReference {
  id: string;
  source_type: string;
  provider: string;
  title: string;
  url?: string | null;
  published_at?: string | null;
  as_of?: string | null;
  fetched_at: string;
  stale: boolean;
  symbol?: string | null;
  locator?: string | null;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  pending?: boolean;
  status?: string;
  trace?: ChatTraceEvent[];
  sources?: SourceReference[];
  renderedImages?: RenderedImage[];
}

export interface ChatResponse {
  response: string;
  session_id: string;
  message_id?: string | null;
  tool_calls: number;
  steps: number;
  sources: SourceReference[];
  rendered_images?: RenderedImage[];
}

export interface ChatStreamEvent {
  type: string;
  event_id?: number;
  run_id?: string;
  timestamp?: number;
  data?: Record<string, unknown>;
}

export interface ChatRunSummary {
  run_id: string;
  request_id: string;
  session_id: string;
  user_message: string;
  status: "running" | "stopping" | "done" | "cancelled" | "error";
}

export type ChatInputMode = "queue" | "steer";

export interface ChatInput {
  id: string;
  session_id: string;
  request_id: string;
  message: string;
  mode: ChatInputMode;
  status: "pending" | "running" | "applied" | "completed" | "cancelled" | "failed";
  target_run_id: string | null;
  run_id: string | null;
  created_at: string;
  updated_at: string;
  error: string | null;
}

export interface ChatInputRequest {
  request_id: string;
  message: string;
  mode: ChatInputMode;
  target_run_id?: string;
  thinking_enabled?: boolean;
}

// ── Chat History ──────────────────────────────────────────────────────────────

export interface ChatSessionMessage {
  id: string;
  session_id: string;
  role: ChatRole;
  content: string;
  seq: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ChatSessionSummary {
  id: string;
  user_id?: string | null;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message?: string | null;
}

export interface ChatSessionDetail extends ChatSessionSummary {
  active_run?: ChatRunSummary | null;
  inputs?: ChatInput[];
  input_queue_paused?: boolean;
  messages: ChatSessionMessage[];
}

export interface ChatSessionListResponse {
  sessions: ChatSessionSummary[];
  total: number;
}

export interface Conversation {
  activeRun?: ChatRunSummary | null;
  inputs?: ChatInput[];
  inputQueuePaused?: boolean;
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
  lastMessage?: string | null;
}
