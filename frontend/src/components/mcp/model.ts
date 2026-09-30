import type { AppLanguage } from "@/i18n";
import { catalogsFor } from "@/i18n";

// ── MCP Servers Management ──────────────────────────────────────────────────────

export const mcpPageCopy = catalogsFor("mcp");

export type McpPageCopy = (typeof mcpPageCopy)[AppLanguage];

export interface MCPServersPanelProps {
  copy: McpPageCopy;
  mcpServersText: string;
  setMcpServersText: (text: string) => void;
  onServersChange?: (servers: Record<string, Record<string, unknown>>) => void | Promise<void>;
}

export type MCPTransport = "streamable_http" | "sse" | "stdio";

export const emptyMcpAddForm = {
  name: "",
  transport: "streamable_http" as MCPTransport,
  url: "",
  command: "",
  args: "",
  headers: "",
  authToken: "",
  env: "",
};
