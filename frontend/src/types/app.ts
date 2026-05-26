import type { Page } from "@/types/ui";

export type ColorScheme = "intl" | "cn";
/** intl: green=up, red=down | cn: red=up, green=down */

export type ChatRole = "assistant" | "user";

export type ChatTraceStatus = "info" | "running" | "done" | "error";

export interface ChatTraceEvent {
  id: string;
  label: string;
  detail?: string;
  status: ChatTraceStatus;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  pending?: boolean;
  status?: string;
  trace?: ChatTraceEvent[];
}

export interface SubAgentRoleConfig {
  description: string;
  system_prompt: string;
  tool_allowlist: string[];
  max_steps: number;
  allow_dangerous_tools: boolean;
  allow_all_mcp_tools: boolean;
}

export interface AuthUser {
  id: string;
  username: string;
  display_name: string;
  roles: string[];
  permissions: string[];
  page_permissions?: Partial<Record<Page, string>>;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  last_login_at?: string | null;
}

export interface UserListResponse {
  users: AuthUser[];
  total: number;
}

export interface UserCreateRequest {
  username: string;
  password: string;
  display_name?: string;
  roles: string[];
  is_active?: boolean;
}

export interface UserUpdateRequest {
  display_name?: string;
  password?: string;
  roles?: string[];
  is_active?: boolean;
}

export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
}

export interface RoleInfo {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  permissions: string[];
  created_at?: string | null;
  updated_at?: string | null;
}

export interface RoleListResponse {
  roles: RoleInfo[];
  permissions: Record<string, string>;
  page_permissions: Partial<Record<Page, string>>;
}

export interface RoleUpdateRequest {
  name: string;
  description: string;
  permissions: string[];
}

export interface PagePermissionUpdateRequest {
  permission: string;
}

export interface AuthTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: AuthUser;
}

export interface SetupStatusResponse {
  setup_required: boolean;
}

export interface LoginRecord {
  id: string;
  device_id: string;
  user_id: string;
  username: string;
  display_name: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at?: string | null;
  user_agent: string;
  ip_address: string;
  last_ip_address: string;
  session_count: number;
  active_refresh_tokens: number;
  is_current: boolean;
  is_active: boolean;
  is_online: boolean;
}

export interface LoginSession extends LoginRecord {
  records: LoginRecord[];
}

export interface LoginDeviceHeartbeatResponse {
  status: string;
  device_id: string;
  last_seen_at: string;
  is_online: boolean;
}

export interface LoginSessionListResponse {
  sessions: LoginSession[];
  max_lifetime_days: number;
  max_devices_per_user: number;
  refresh_token_days: number;
}

export interface AppConfig {
  llm_provider: "openai_compatible" | "openai_responses" | string;
  llm_auth_mode: "api_key" | "codex" | string;
  llm_api_base: string;
  llm_model: string;
  llm_codex_auth_file: string;
  llm_codex_api_base: string;
  llm_codex_model: string;
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
  app_language: "zh" | "en";
  auth_max_devices_per_user: number;
  agent_max_steps: number;
  agent_max_context_tokens: number;
  agent_max_context_turns: number;
  agent_tool_allowlist: string[];
  agent_allow_all_mcp_tools: boolean;
  multi_agent_enabled: boolean;
  multi_agent_max_parallel_agents: number;
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
  longbridge_app_key_masked?: string;
  has_longbridge_app_key?: boolean;
  longbridge_app_secret_masked?: string;
  has_longbridge_app_secret?: boolean;
  longbridge_access_token_masked?: string;
  has_longbridge_access_token?: boolean;
  longbridge_http_url?: string;
  longbridge_quote_ws_url?: string;
  personal_config_keys?: string[];
}

export interface ConfigDraft extends AppConfig {
  llm_api_key: string;
  embedding_api_key: string;
  telegram_bot_token: string;
  longbridge_app_key: string;
  longbridge_app_secret: string;
  longbridge_access_token: string;
  mcp_servers_text: string;
}

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

export interface ChatResponse {
  response: string;
  session_id: string;
  message_id?: string | null;
  tool_calls: number;
  steps: number;
}

export interface ChatStreamEvent {
  type: string;
  timestamp?: number;
  data?: Record<string, unknown>;
}

export interface AgentTraceEvent {
  id: string;
  run_id: string;
  seq: number;
  parent_id?: string | null;
  node_type: string;
  title: string;
  status: string;
  started_at: string;
  ended_at?: string | null;
  duration_ms?: number | null;
  summary: string;
  payload: Record<string, unknown>;
}

export interface AgentTraceRun {
  id: string;
  session_id: string;
  user_message_id?: string | null;
  assistant_message_id?: string | null;
  status: string;
  started_at: string;
  ended_at?: string | null;
  duration_ms?: number | null;
  error?: string | null;
  final_response_preview: string;
  events: AgentTraceEvent[];
}

export interface TraceSessionResponse {
  session_id: string;
  runs: AgentTraceRun[];
  total: number;
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

// ── Portfolio ───────────────────────────────────────────────────────────────

export type PortfolioMarket = "US" | "A";

export interface PortfolioItem {
  id: number;
  market: PortfolioMarket;
  symbol: string;
  name: string;
  shares: string | null;
  cost_price: string | null;
  note: string;
  currency: string;
  pe_ttm_ratio: string | null;
  current_price: string | null;
  change_value: string | null;
  change_rate: string | null;
  stock_value: string | null;
  position_ratio: string | null;
  pnl_ratio: string | null;
  created_at: string;
  updated_at: string;
}

export interface PortfolioItemDraft {
  market: PortfolioMarket;
  symbol: string;
  name: string;
  shares?: string | null;
  cost_price?: string | null;
  note: string;
}

export interface PortfolioListResponse {
  market: PortfolioMarket;
  total_capital: string;
  total_assets: string;
  cash_ratio: string | null;
  items: PortfolioItem[];
  total: number;
  quote_error?: string | null;
}

export interface PortfolioSearchResult {
  market: PortfolioMarket;
  symbol: string;
  name: string;
  currency: string;
  last_done: string | null;
  change_rate: string | null;
}

export interface PortfolioSearchResponse {
  results: PortfolioSearchResult[];
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

// ── Dashboard aggregate ────────────────────────────────────────────────────

export type DashboardWatchlistView = "movers" | "gainers" | "losers" | "active";

export interface DashboardModule {
  available: boolean;
  error: string | null;
}

export type DashboardWatchlistRow = QuoteItem;

export interface DashboardWatchlistViews {
  movers: DashboardWatchlistRow[];
  gainers: DashboardWatchlistRow[];
  losers: DashboardWatchlistRow[];
  active: DashboardWatchlistRow[];
}

export interface DashboardWatchlistModule extends DashboardModule {
  items: DashboardWatchlistRow[];
  views: DashboardWatchlistViews;
  counts_by_category: Record<string, number>;
  total: number;
  quote_error: string | null;
}

export type DashboardPortfolioPosition = PortfolioItem;

export interface DashboardPortfolioMarket {
  market: PortfolioMarket;
  total_assets: string;
  market_value: string;
  cash_amount: string;
  cash_ratio: string | null;
  cost_value: string;
  unrealized_pnl_value: string | null;
  unrealized_pnl_ratio: string | null;
  day_change_value: string | null;
  day_change_rate: string | null;
  position_count: number;
  quote_error: string | null;
  top_positions: DashboardPortfolioPosition[];
}

export interface DashboardPortfolioModule extends DashboardModule {
  markets: DashboardPortfolioMarket[];
}

export interface DashboardMarketModule extends DashboardModule {
  indices: QuoteItem[];
}

export interface DashboardResponse {
  market: DashboardMarketModule;
  watchlist: DashboardWatchlistModule;
  portfolio: DashboardPortfolioModule;
}

// ── News ────────────────────────────────────────────────────────────────────

export interface SecurityNewsItem {
  id: string;
  title: string;
  description: string;
  url: string;
  published_at: string | null;
  published_at_ts: number | null;
  likes_count: number | null;
  comments_count: number | null;
  shares_count: number | null;
}

export interface SecurityNewsResponse {
  symbol: string;
  news: SecurityNewsItem[];
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

export interface MarketTemperature {
  market: string;
  temperature: number | null;
  description: string;
  valuation: number | null;
  sentiment: number | null;
  updated_at: number | null;
}

// ── Fundamentals ─────────────────────────────────────────────────────────────

export type FinancialReportKind = "All" | "IncomeStatement" | "BalanceSheet" | "CashFlow";
export type FinancialReportPeriod = "Annual" | "SemiAnnual" | "Q1" | "Q2" | "Q3" | "ThreeQ" | "QuarterlyFull";

export interface FinancialReportColumn {
  key: string;
  label: string;
  year: number | null;
  fp_end: string | null;
}

export interface FinancialReportCell {
  period: string;
  value: string | null;
  ratio: string | null;
  yoy: string | null;
  year: number | null;
  fp_end: string | null;
}

export interface FinancialReportRow {
  field: string;
  name: string;
  percent: boolean;
  tip: string;
  cells: FinancialReportCell[];
}

export interface FinancialStatementTable {
  code: string;
  name: string;
  title: string;
  short_title: string;
  currency: string;
  has_yoy: boolean;
  columns: FinancialReportColumn[];
  rows: FinancialReportRow[];
}

export interface FinancialReportsResponse {
  symbol: string;
  kind: FinancialReportKind;
  period: FinancialReportPeriod | null;
  statements: FinancialStatementTable[];
}

// ── Skills ────────────────────────────────────────────────────────────────────

export interface SkillInfo {
  name: string;
  description: string;
  enabled: boolean;
  file_path: string | null;
  source?: "builtin" | "custom" | "clawhub" | string | null;
  clawhub_slug?: string | null;
  clawhub_version?: string | null;
  clawhub_owner?: string | null;
  clawhub_url?: string | null;
}

export interface SkillListResponse {
  skills: SkillInfo[];
  total: number;
}

export interface ClawHubSearchResult {
  slug: string;
  name: string;
  summary: string;
  description: string;
  owner: string | null;
  version: string | null;
  updated_at: string | null;
  canonical_url: string | null;
  scan_status: string | null;
  moderation_status: string | null;
}

export interface ClawHubSearchResponse {
  results: ClawHubSearchResult[];
  total: number;
}

export interface ClawHubSkillDetail extends ClawHubSearchResult {
  scan: Record<string, unknown>;
  skill_md: string;
  preview_error: string | null;
  scan_error: string | null;
}

export interface ClawHubInstallResponse {
  status: string;
  message: string;
  installed_path: string;
  skill: SkillInfo;
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
  indexed_only?: boolean;
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

export interface KnowledgeSaveResponse {
  status: string;
  path: string;
  size: number;
  source?: string | null;
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
  last_error?: string | null;
  metadata: Record<string, unknown> | null;
}

export interface SchedulerTaskList {
  tasks: SchedulerTask[];
  total: number;
}

export interface SchedulerTaskRun {
  id: string;
  task_id: string;
  task_name: string;
  trigger: "schedule" | "manual" | string;
  status: "success" | "error" | string;
  started_at: string;
  ended_at: string | null;
  duration_ms: number;
  output_preview: string;
  error?: string | null;
}

export interface SchedulerTaskRunList {
  runs: SchedulerTaskRun[];
  total: number;
}

export interface TelegramTestResponse {
  ok: boolean;
  chunks: number;
  detail: string;
}

// ── Chat History ──────────────────────────────────────────────────────────────

export interface ChatSessionMessage {
  id: string;
  session_id: string;
  role: ChatRole;
  content: string;
  seq: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ChatSessionSummary {
  id: string;
  user_id?: string | null;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message?: string | null;
}

export interface ChatSessionDetail extends ChatSessionSummary {
  messages: ChatSessionMessage[];
}

export interface ChatSessionListResponse {
  sessions: ChatSessionSummary[];
  total: number;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
  lastMessage?: string | null;
}
