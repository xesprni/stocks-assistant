export interface ToolInfo {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  source?: "builtin" | "mcp" | string;
  server_name?: string | null;
  enabled?: boolean;
}

export interface ToolListResponse {
  tools: ToolInfo[];
  total: number;
}
