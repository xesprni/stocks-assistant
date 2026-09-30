import type { AppLanguage } from "@/i18n";
import type { ThemeColor } from "@/lib/theme-color";
export type ColorScheme = "intl" | "cn";

export type LlmReasoningEffort = "minimal" | "low" | "medium" | "high";

export type LlmToolChoice = "auto" | "none" | "required";

export interface SubAgentRoleConfig {
  description: string;
  system_prompt: string;
  tool_allowlist: string[];
  max_steps: number;
  allow_dangerous_tools: boolean;
  allow_all_mcp_tools: boolean;
}

export interface AppConfig {
  llm_provider: "openai_compatible" | "openai_responses" | string;
  llm_auth_mode: "api_key" | "codex" | string;
  llm_api_base: string;
  llm_model: string;
  llm_codex_auth_file: string;
  llm_codex_api_base: string;
  llm_codex_model: string;
  llm_temperature: number;
  llm_max_output_tokens: number;
  llm_reasoning_effort: LlmReasoningEffort | string;
  llm_tool_choice: LlmToolChoice | string;
  has_codex_oauth: boolean;
  codex_oauth_account_id_masked: string;
  codex_oauth_error: string;
  llm_api_key_masked: string;
  has_llm_api_key: boolean;
  embedding_auth_mode: "api_key" | "codex" | string;
  embedding_api_base: string;
  embedding_model: string;
  embedding_provider: string;
  embedding_codex_auth_file: string;
  embedding_codex_api_base: string;
  embedding_codex_model: string;
  has_embedding_codex_oauth: boolean;
  embedding_codex_oauth_account_id_masked: string;
  embedding_codex_oauth_error: string;
  embedding_api_key_masked: string;
  has_embedding_api_key: boolean;
  workspace_dir: string;
  app_language: AppLanguage;
  app_theme_color: ThemeColor;
  auth_max_devices_per_user: number;
  agent_max_steps: number;
  agent_max_context_tokens: number;
  agent_max_context_turns: number;
  agent_tool_allowlist: string[];
  agent_allow_all_mcp_tools: boolean;
  multi_agent_enabled: boolean;
  multi_agent_max_parallel_agents: number;
  multi_agent_max_tasks_per_batch: number;
  multi_agent_task_timeout_seconds: number;
  multi_agent_default_max_steps: number;
  multi_agent_max_depth: number;
  multi_agent_dangerous_tools: string[];
  multi_agent_roles: Record<string, SubAgentRoleConfig>;
  knowledge_enabled: boolean;
  memory_enabled: boolean;
  memory_auto_curate_enabled: boolean;
  memory_curator_min_importance: number;
  memory_curator_min_confidence: number;
  scheduler_enabled: boolean;
  tracing_enabled: boolean;
  product_analytics_enabled: boolean;
  debug: boolean;
  telegram_enabled: boolean;
  telegram_bot_token_masked?: string;
  has_telegram_bot_token?: boolean;
  telegram_chat_id?: string;
  telegram_api_base?: string;
  telegram_parse_mode?: string;
  system_prompt: string;
  mcp_servers: Record<string, Record<string, unknown>>;
  mcp_tool_timeout_seconds: number;
  longbridge_auth_mode?: "apikey" | "oauth";
  longbridge_oauth_connected?: boolean;
  longbridge_oauth_client_id?: string;
  longbridge_app_key_masked?: string;
  has_longbridge_app_key?: boolean;
  longbridge_app_secret_masked?: string;
  has_longbridge_app_secret?: boolean;
  longbridge_access_token_masked?: string;
  has_longbridge_access_token?: boolean;
  longbridge_http_url?: string;
  longbridge_quote_ws_url?: string;
  search_api_url?: string;
  search_api_key_masked?: string;
  has_search_api_key?: boolean;
  personal_config_keys?: string[];
}

export interface ConfigDraft extends AppConfig {
  llm_api_key: string;
  embedding_api_key: string;
  telegram_bot_token: string;
  longbridge_app_key: string;
  longbridge_app_secret: string;
  longbridge_access_token: string;
  search_api_key: string;
  mcp_servers_text: string;
}

export interface LongbridgeOAuthStatus {
  status: "disconnected" | "pending" | "connected" | "error";
  auth_mode: "apikey" | "oauth";
  client_id: string;
  authorization_url: string | null;
  expires_at: string | null;
  error: string | null;
  scope: "system" | "personal";
  callback_url: string | null;
}

export interface ConnectionCheck {
  component: "llm" | "embedding" | "longbridge" | "telegram" | string;
  status: "ready" | "missing" | "optional" | "error" | string;
  configured: boolean;
  detail: string;
  depends_on: string[];
}

export interface ConfigReadinessResponse {
  ready: boolean;
  checks: ConnectionCheck[];
}

export interface DemoDataResponse {
  watchlist_created: number;
  portfolio_created: number;
  detail: string;
}

export interface ConnectionTestResponse {
  component: string;
  ok: boolean;
  detail: string;
  checked_at: string;
}

export interface TelegramTestResponse {
  ok: boolean;
  chunks: number;
  detail: string;
  photos?: number;
}
