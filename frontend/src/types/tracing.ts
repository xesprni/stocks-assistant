export interface AgentTraceEvent {
  id: string;
  run_id: string;
  seq: number;
  parent_id?: string | null;
  node_type: string;
  title: string;
  status: string;
  started_at: string;
  ended_at?: string | null;
  duration_ms?: number | null;
  summary: string;
  payload: Record<string, unknown>;
}

export interface AgentTraceRun {
  id: string;
  session_id: string;
  user_message_id?: string | null;
  assistant_message_id?: string | null;
  status: string;
  started_at: string;
  ended_at?: string | null;
  duration_ms?: number | null;
  error?: string | null;
  final_response_preview: string;
  events: AgentTraceEvent[];
}

export interface TraceSessionResponse {
  session_id: string;
  runs: AgentTraceRun[];
  total: number;
}
