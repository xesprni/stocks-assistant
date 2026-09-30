export function isMcpToolName(name: string): boolean {
  return name.startsWith("mcp_");
}

export const OPENAI_API_BASE = "https://api.openai.com/v1";

export const CODEX_OAUTH_API_BASE = "https://chatgpt.com/backend-api/codex";

export const CODEX_DEFAULT_MODEL = "gpt-5.2-codex";

export const EMBEDDING_DEFAULT_MODEL = "text-embedding-3-small";

export const REASONING_EFFORT_OPTIONS = ["minimal", "low", "medium", "high"] as const;

export const TOOL_CHOICE_OPTIONS = ["auto", "none", "required"] as const;

export type ConfigTab = "model" | "agent" | "longbridge" | "market" | "channels" | "features";

export type SettingsTab = ConfigTab | "overview" | "security";

export function isCompatibleBase(value?: string | null): value is string {
  const normalized = value?.trim().replace(/\/+$/, "");
  return Boolean(normalized && normalized !== CODEX_OAUTH_API_BASE);
}
