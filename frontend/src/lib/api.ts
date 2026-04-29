import type { AppConfig, ChatResponse } from "@/types/app";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
    ...init,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = typeof body?.detail === "string" ? body.detail : response.statusText;
    throw new Error(detail || "请求失败");
  }

  return response.json() as Promise<T>;
}

export function checkHealth() {
  return request<{ status: string }>("/api/v1/health");
}

export function loadConfig() {
  return request<AppConfig>("/api/v1/config");
}

export function saveConfig(payload: Record<string, unknown>) {
  return request<AppConfig>("/api/v1/config", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function sendChat(message: string) {
  return request<ChatResponse>("/api/v1/agent/chat", {
    method: "POST",
    body: JSON.stringify({
      message,
      clear_history: false,
    }),
  });
}
