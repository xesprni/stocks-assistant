export type ChatRole = "assistant" | "user";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  pending?: boolean;
}

export interface AppConfig {
  llm_api_base: string;
  llm_model: string;
  llm_api_key_masked: string;
  has_llm_api_key: boolean;
  embedding_api_base: string;
  embedding_model: string;
  embedding_provider: string;
  embedding_api_key_masked: string;
  has_embedding_api_key: boolean;
  workspace_dir: string;
  agent_max_steps: number;
  agent_max_context_tokens: number;
  agent_max_context_turns: number;
  knowledge_enabled: boolean;
  memory_enabled: boolean;
  scheduler_enabled: boolean;
  debug: boolean;
  system_prompt: string;
  mcp_servers: Record<string, Record<string, unknown>>;
}

export interface ConfigDraft extends AppConfig {
  llm_api_key: string;
  embedding_api_key: string;
  mcp_servers_text: string;
}

export interface ChatResponse {
  response: string;
  tool_calls: number;
  steps: number;
}
