import { request } from "@/lib/api/transport";
import type {
  AppConfig,
  ConfigReadinessResponse,
  ConnectionTestResponse,
  DemoDataResponse,
  LongbridgeOAuthStatus,
  TelegramTestResponse,
} from "@/types/app";

export function loadConfig() {
  return request<AppConfig>("/api/v1/config");
}

export function saveConfig(payload: Record<string, unknown>) {
  return request<AppConfig>("/api/v1/config", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function getConfigReadiness() {
  return request<ConfigReadinessResponse>("/api/v1/config/readiness");
}

export function getLongbridgeOAuthStatus(init?: RequestInit) {
  return request<LongbridgeOAuthStatus>("/api/v1/config/longbridge/oauth/status", init);
}

export function startLongbridgeOAuth() {
  return request<LongbridgeOAuthStatus>("/api/v1/config/longbridge/oauth/start", { method: "POST" });
}

export function disconnectLongbridgeOAuth() {
  return request<LongbridgeOAuthStatus>("/api/v1/config/longbridge/oauth/disconnect", { method: "DELETE" });
}

export function testConfigConnection(component: "llm" | "embedding" | "longbridge") {
  return request<ConnectionTestResponse>(`/api/v1/config/connections/${encodeURIComponent(component)}/test`, {
    method: "POST",
  });
}

export function seedDemoData() {
  return request<DemoDataResponse>("/api/v1/config/demo-data", { method: "POST" });
}

export function trackProductEvent(event: string, properties: Record<string, string | number | boolean | null> = {}) {
  return request<{ accepted: boolean }>("/api/v1/telemetry/events", {
    method: "POST",
    body: JSON.stringify({ event, properties }),
  });
}

export function sendTelegramTestMessage(payload: { message: string; photos?: string[] }) {
  return request<TelegramTestResponse>("/api/v1/config/telegram/test", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
