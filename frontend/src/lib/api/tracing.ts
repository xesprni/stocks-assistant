import { request } from "@/lib/api/transport";
import type {
  TraceSessionResponse
} from "@/types/app";

export function getSessionTraces(sessionId: string, limit = 20) {
  const params = new URLSearchParams({ limit: String(limit) });
  return request<TraceSessionResponse>(`/api/v1/tracing/sessions/${sessionId}?${params.toString()}`);
}
