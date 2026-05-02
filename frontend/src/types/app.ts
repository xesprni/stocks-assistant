export type ColorScheme = "intl" | "cn";
/** intl: green=up, red=down | cn: red=up, green=down */

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

// ── Market dashboard ────────────────────────────────────────────────────────

export interface IndexConfig {
  symbol: string;
  name: string;
  enabled: boolean;
}

export interface MarketDashboardConfig {
  indices: IndexConfig[];
  refresh_interval: number;
}

export interface QuoteItem {
  symbol: string;
  name: string;
  category: string;
  last_done: string | null;
  prev_close: string | null;
  open: string | null;
  high: string | null;
  low: string | null;
  volume: string | null;
  turnover: string | null;
  change_value: string | null;
  change_rate: string | null;
}

export interface MarketQuotesResponse {
  quotes: QuoteItem[];
  total: number;
}

// ── MCP servers ────────────────────────────────────────────────────────────────

export interface MCPServerStatus {
  name: string;
  transport: string;
  url: string;
  command: string;
  args: string[];
  headers: Record<string, string>;
  status: "connecting" | "auth_required" | "connected" | "error" | "disconnected";
  error: string | null;
  tools_count: number;
  oauth_authorization_url: string | null;
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

// ── Technical analysis ───────────────────────────────────────────────────────

export interface CandlestickItem {
  timestamp: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  turnover: string;
}

export interface CandlesticksResponse {
  symbol: string;
  period: string;
  bars: CandlestickItem[];
}

export interface IntradayItem {
  timestamp: number;
  price: string;
  volume: string;
  turnover: string;
  avg_price: string;
}

export interface IntradayResponse {
  symbol: string;
  bars: IntradayItem[];
}

// ── Skills ────────────────────────────────────────────────────────────────────

export interface SkillInfo {
  name: string;
  description: string;
  enabled: boolean;
  file_path: string | null;
}

export interface SkillListResponse {
  skills: SkillInfo[];
  total: number;
}

// ── Memory ────────────────────────────────────────────────────────────────────

export interface MemorySearchResult {
  path: string;
  start_line: number;
  end_line: number;
  score: number;
  snippet: string;
  source: string;
  user_id: string | null;
}

export interface MemoryStatus {
  chunks: number;
  files: number;
  workspace: string;
  dirty: boolean;
  embedding_enabled: boolean;
  embedding_provider: string;
  embedding_model: string;
  search_mode: string;
}

export interface MemoryFile {
  path: string;
  size: number;
  modified: number;
}

export interface MemoryFileContent {
  path: string;
  content: string;
  size: number;
}

// ── Knowledge ─────────────────────────────────────────────────────────────────

export interface KnowledgeFile {
  name: string;
  title: string;
  size: number;
}

export interface KnowledgeDir {
  dir: string;
  files: KnowledgeFile[];
  children: KnowledgeDir[];
}

export interface KnowledgeTree {
  root_files: KnowledgeFile[];
  tree: KnowledgeDir[];
  stats: { pages: number; size: number };
  enabled: boolean;
}

export interface KnowledgeGraphNode {
  id: string;
  label: string;
  category: string;
}

export interface KnowledgeGraphLink {
  source: string;
  target: string;
}

export interface KnowledgeGraph {
  nodes: KnowledgeGraphNode[];
  links: KnowledgeGraphLink[];
}

export interface KnowledgeFileContent {
  content: string;
  path: string;
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

export interface SchedulerTask {
  id: string;
  name: string;
  prompt: string;
  schedule: string;
  enabled: boolean;
  last_run: string | null;
  next_run: string | null;
  run_count: number;
  metadata: Record<string, unknown> | null;
}

export interface SchedulerTaskList {
  tasks: SchedulerTask[];
  total: number;
}

// ── Chat History ──────────────────────────────────────────────────────────────

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}
