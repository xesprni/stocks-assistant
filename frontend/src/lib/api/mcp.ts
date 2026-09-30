import { request } from "@/lib/api/transport";
import type {
  MCPServerToolsResponse,
  MCPStatusResponse
} from "@/types/app";

// ── MCP servers ────────────────────────────────────────────────────────────────

export function getMcpStatus() {
  return request<MCPStatusResponse>("/api/v1/mcp/status");
}

export function reconnectMcpServers() {
  return request<MCPStatusResponse>("/api/v1/mcp/reconnect", { method: "POST" });
}

export function startMcpOAuthAuthorization(serverName: string) {
  return request<{ authorization_url: string }>(`/api/v1/mcp/${encodeURIComponent(serverName)}/oauth/authorize`, {
    method: "POST",
  });
}

export function deleteMcpOAuth(serverName: string) {
  return request<{ status: string }>(`/api/v1/mcp/${encodeURIComponent(serverName)}/oauth`, {
    method: "DELETE",
  });
}

export function getMcpTools(serverName: string) {
  return request<MCPServerToolsResponse>(`/api/v1/mcp/${encodeURIComponent(serverName)}/tools`);
}
