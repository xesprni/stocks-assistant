// ── MCP servers ────────────────────────────────────────────────────────────────

export interface MCPServerStatus {
  name: string;
  transport: string;
  url: string;
  command: string;
  args: string[];
  headers: Record<string, string>;
  enabled: boolean;
  status: "connecting" | "auth_required" | "connected" | "error" | "disconnected" | "disabled";
  error: string | null;
  tools_count: number;
  oauth_authorization_url: string | null;
  oauth_enabled: boolean;
}

export interface MCPStatusResponse {
  servers: MCPServerStatus[];
  total: number;
}

export interface MCPToolInfo {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface MCPServerToolsResponse {
  server_name: string;
  tools: MCPToolInfo[];
  total: number;
}
