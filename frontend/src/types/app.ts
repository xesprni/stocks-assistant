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
  longbridge_app_key_masked?: string;
  has_longbridge_app_key?: boolean;
  longbridge_app_secret_masked?: string;
  has_longbridge_app_secret?: boolean;
  longbridge_access_token_masked?: string;
  has_longbridge_access_token?: boolean;
  longbridge_http_url?: string;
  longbridge_quote_ws_url?: string;
}

export interface ConfigDraft extends AppConfig {
  llm_api_key: string;
  embedding_api_key: string;
  longbridge_app_key: string;
  longbridge_app_secret: string;
  longbridge_access_token: string;
  mcp_servers_text: string;
}

export interface ChatResponse {
  response: string;
  tool_calls: number;
  steps: number;
}

export type WatchlistCategory = "US" | "A" | "H";

export interface WatchlistItem {
  id: number;
  category: WatchlistCategory;
  symbol: string;
  name: string;
  name_cn: string;
  name_en: string;
  name_hk: string;
  exchange: string;
  currency: string;
  last_done: string | null;
  change_value: string | null;
  change_rate: string | null;
  note: string;
  created_at: string;
  updated_at: string;
}

export type WatchlistSearchResult = Omit<WatchlistItem, "id" | "note" | "created_at" | "updated_at">;

export interface WatchlistListResponse {
  items: WatchlistItem[];
  total: number;
}

export interface WatchlistSearchResponse {
  results: WatchlistSearchResult[];
  total: number;
}
