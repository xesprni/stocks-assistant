import type {
  AppConfig,
  AuthTokenResponse,
  AuthUser,
  CandlesticksResponse,
  CapitalFlowResponse,
  ChangePasswordRequest,
  ChatMessage,
  ChatResponse,
  ChatSessionDetail,
  ChatSessionListResponse,
  ChatSessionMessage,
  ChatSessionSummary,
  ChatStreamEvent,
  ClawHubInstallResponse,
  ClawHubSearchResponse,
  ClawHubSkillDetail,
  DashboardMarketModule,
  DashboardPortfolioModule,
  Conversation,
  DashboardResponse,
  DashboardSymbolInsightsResponse,
  DashboardWatchlistModule,
  FinancialReportKind,
  FinancialReportPeriod,
  FinancialReportsResponse,
  GuardianArticleResponse,
  GuardianFeedResponse,
  GuardianTranslateRequest,
  GuardianTranslateResponse,
  IntradayResponse,
  KnowledgeFileContent,
  KnowledgeGraph,
  KnowledgeSaveResponse,
  KnowledgeTree,
  LoginDeviceHeartbeatResponse,
  LoginSessionListResponse,
  MarketTemperature,
  MCPServerToolsResponse,
  MCPStatusResponse,
  MarketDashboardConfig,
  MarketQuotesResponse,
  MemoryFile,
  MemoryFileContent,
  MemorySearchResult,
  MemoryStatus,
  PortfolioItem,
  PortfolioItemDraft,
  PortfolioListResponse,
  PortfolioMarket,
  PortfolioSearchResponse,
  PagePermissionUpdateRequest,
  RoleListResponse,
  RoleUpdateRequest,
  SchedulerTask,
  SchedulerTaskList,
  SchedulerTaskRun,
  SchedulerTaskRunList,
  SecurityNewsResponse,
  SkillListResponse,
  SetupStatusResponse,
  TelegramTestResponse,
  ToolListResponse,
  TraceSessionResponse,
  UserCreateRequest,
  UserListResponse,
  UserProfileUpdateRequest,
  UserUpdateRequest,
  WatchlistCategory,
  WatchlistItem,
  WatchlistListResponse,
  WatchlistOverviewResponse,
  WatchlistSearchResponse,
} from "@/types/app";
import { readStoredText, removeStoredValue, writeStoredValue } from "@/lib/local-storage";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";
const ACCESS_TOKEN_KEY = "stocks_assistant_access_token";
const REFRESH_TOKEN_KEY = "stocks_assistant_refresh_token";
const DEVICE_ID_KEY = "stocks_assistant_device_id";
const DEVICE_ID_HEADER = "X-Device-Id";
const AUTH_EXPIRED_EVENT = "stocks-assistant:auth-expired";

let accessToken = readStoredText(ACCESS_TOKEN_KEY);
let refreshToken = readStoredText(REFRESH_TOKEN_KEY);
let refreshPromise: Promise<AuthTokenResponse> | null = null;
let authRecoveryPromise: Promise<void> | null = null;
let resolveAuthRecoveryPromise: (() => void) | null = null;
let rejectAuthRecoveryPromise: ((error: Error) => void) | null = null;
const AUTH_RETRY_EXCLUDED_PATHS = new Set([
  "/api/v1/auth/login",
  "/api/v1/auth/logout",
  "/api/v1/auth/refresh",
  "/api/v1/auth/setup",
  "/api/v1/auth/setup/status",
]);

class AuthRecoveryError extends Error {
  recovery: Promise<void>;

  constructor(message: string, recovery: Promise<void>) {
    super(message);
    this.name = "AuthRecoveryError";
    this.recovery = recovery;
  }
}

export function getStoredAccessToken() {
  return accessToken;
}

export function getStoredRefreshToken() {
  return refreshToken;
}

export function getDeviceId() {
  let deviceId = readStoredText(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = globalThis.crypto?.randomUUID?.() ?? `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    writeStoredValue(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

export function setAuthTokens(tokens: { access_token: string; refresh_token: string }) {
  accessToken = tokens.access_token;
  refreshToken = tokens.refresh_token;
  writeStoredValue(ACCESS_TOKEN_KEY, accessToken);
  writeStoredValue(REFRESH_TOKEN_KEY, refreshToken);
}

export function clearAuthTokens() {
  accessToken = "";
  refreshToken = "";
  removeStoredValue(ACCESS_TOKEN_KEY);
  removeStoredValue(REFRESH_TOKEN_KEY);
}

function notifyAuthExpired(message: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT, { detail: { message } }));
}

function startAuthRecovery(message: string) {
  if (!authRecoveryPromise) {
    authRecoveryPromise = new Promise<void>((resolve, reject) => {
      resolveAuthRecoveryPromise = resolve;
      rejectAuthRecoveryPromise = reject;
    }).finally(() => {
      authRecoveryPromise = null;
      resolveAuthRecoveryPromise = null;
      rejectAuthRecoveryPromise = null;
    });
  }
  notifyAuthExpired(message);
  return authRecoveryPromise;
}

export function resolveAuthRecovery() {
  resolveAuthRecoveryPromise?.();
}

export function rejectAuthRecovery(message = "Authentication required") {
  rejectAuthRecoveryPromise?.(new Error(message));
}

export function addAuthExpiredListener(listener: (message: string) => void) {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ message?: string }>).detail;
    listener(typeof detail?.message === "string" ? detail.message : "Authentication expired");
  };
  window.addEventListener(AUTH_EXPIRED_EVENT, handler);
  return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handler);
}

function authHeaders(init?: RequestInit) {
  return {
    "Content-Type": "application/json",
    [DEVICE_ID_HEADER]: getDeviceId(),
    ...init?.headers,
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
}

async function refreshAuthToken() {
  if (!refreshToken) {
    const message = "Authentication required";
    throw new AuthRecoveryError(message, startAuthRecovery(message));
  }
  if (!refreshPromise) {
    refreshPromise = fetch(`${API_BASE}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json", [DEVICE_ID_HEADER]: getDeviceId() },
      body: JSON.stringify({ refresh_token: refreshToken, device_id: getDeviceId() }),
    })
      .then(async (response) => {
        if (!response.ok) {
          clearAuthTokens();
          const body = await response.json().catch(() => null);
          const message = typeof body?.detail === "string" ? body.detail : "Authentication expired";
          throw new AuthRecoveryError(message, startAuthRecovery(message));
        }
        const next = await response.json() as AuthTokenResponse;
        setAuthTokens(next);
        return next;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

async function request<T>(path: string, init?: RequestInit, retry = true): Promise<T> {
  const initWithoutHeaders = init ? { ...init } : {};
  delete initWithoutHeaders.headers;
  const response = await fetch(`${API_BASE}${path}`, {
    ...initWithoutHeaders,
    headers: authHeaders(init),
  });

  if (response.status === 401 && retry && !AUTH_RETRY_EXCLUDED_PATHS.has(path)) {
    try {
      await refreshAuthToken();
    } catch (error) {
      if (error instanceof AuthRecoveryError) {
        await error.recovery;
      } else {
        throw error;
      }
    }
    return request<T>(path, init, false);
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = typeof body?.detail === "string" ? body.detail : response.statusText;
    throw new Error(detail || "Request failed");
  }

  return response.json() as Promise<T>;
}

export function checkHealth() {
  return request<{ status: string }>("/api/v1/health");
}

export function getSetupStatus() {
  return request<SetupStatusResponse>("/api/v1/auth/setup/status");
}

export function setupAdmin(payload: { username: string; password: string; display_name?: string }) {
  return request<AuthTokenResponse>("/api/v1/auth/setup", {
    method: "POST",
    body: JSON.stringify({ ...payload, device_id: getDeviceId() }),
  });
}

export function login(payload: { username: string; password: string }) {
  return request<AuthTokenResponse>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ ...payload, device_id: getDeviceId() }),
  });
}

export function getMe() {
  return request<AuthUser>("/api/v1/auth/me");
}

export function updateOwnProfile(payload: UserProfileUpdateRequest) {
  return request<AuthUser>("/api/v1/auth/me/profile", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function changeOwnPassword(payload: ChangePasswordRequest) {
  return request<{ status: string }>("/api/v1/auth/me/password", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function listLoginSessions() {
  return request<LoginSessionListResponse>("/api/v1/auth/sessions");
}

export function heartbeatLoginDevice() {
  return request<LoginDeviceHeartbeatResponse>("/api/v1/auth/device/heartbeat", {
    method: "POST",
    body: JSON.stringify({ device_id: getDeviceId() }),
  });
}

export function revokeLoginSession(sessionId: string, userId?: string) {
  const query = userId ? `?user_id=${encodeURIComponent(userId)}` : "";
  return request<{ status: string; revoked_current: boolean }>(`/api/v1/auth/sessions/${encodeURIComponent(sessionId)}${query}`, {
    method: "DELETE",
  });
}

export function deleteLoginDevice(deviceId: string, userId?: string) {
  const query = userId ? `?user_id=${encodeURIComponent(userId)}` : "";
  return request<{ status: string; deleted: number; deleted_current: boolean }>(
    `/api/v1/auth/sessions/${encodeURIComponent(deviceId)}/device${query}`,
    { method: "DELETE" },
  );
}

export function deleteLoginRecord(deviceId: string, recordId: string, userId?: string) {
  const query = userId ? `?user_id=${encodeURIComponent(userId)}` : "";
  return request<{ status: string; deleted_current: boolean }>(
    `/api/v1/auth/sessions/${encodeURIComponent(deviceId)}/records/${encodeURIComponent(recordId)}${query}`,
    { method: "DELETE" },
  );
}

export async function logout() {
  const token = refreshToken;
  if (token) {
    await request<{ status: string }>("/api/v1/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refresh_token: token }),
    }).catch(() => null);
  }
  clearAuthTokens();
}

export function listUsers() {
  return request<UserListResponse>("/api/v1/users");
}

export function createUser(payload: UserCreateRequest) {
  return request<AuthUser>("/api/v1/users", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateUser(userId: string, payload: UserUpdateRequest) {
  return request<AuthUser>(`/api/v1/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function listRoles() {
  return request<RoleListResponse>("/api/v1/roles");
}

export function saveRole(name: string, payload: RoleUpdateRequest) {
  return request<RoleListResponse["roles"][number]>(`/api/v1/roles/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function savePagePermission(page: string, payload: PagePermissionUpdateRequest) {
  return request<RoleListResponse>(`/api/v1/roles/pages/${encodeURIComponent(page)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function loadConfig() {
  return request<AppConfig>("/api/v1/config");
}

export function saveConfig(payload: Record<string, unknown>) {
  return request<AppConfig>("/api/v1/config", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function sendTelegramTestMessage(payload: { message: string }) {
  return request<TelegramTestResponse>("/api/v1/config/telegram/test", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listTools() {
  return request<ToolListResponse>("/api/v1/tools");
}

function formatChatTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function mapChatMessage(message: ChatSessionMessage): ChatMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: formatChatTime(message.created_at),
  };
}

function mapConversation(session: ChatSessionSummary | ChatSessionDetail): Conversation {
  const messages = "messages" in session ? session.messages.map(mapChatMessage) : [];
  return {
    id: session.id,
    title: session.title,
    messages,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    messageCount: session.message_count,
    lastMessage: session.last_message,
  };
}

export function sendChat(message: string, sessionId?: string | null, clearHistory = false, thinkingEnabled = false) {
  return request<ChatResponse>("/api/v1/agent/chat", {
    method: "POST",
    body: JSON.stringify({
      message,
      session_id: sessionId ?? undefined,
      clear_history: clearHistory,
      thinking_enabled: thinkingEnabled,
    }),
  });
}

function parseSseBlock(block: string): ChatStreamEvent | null {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");

  if (!data) return null;
  return JSON.parse(data) as ChatStreamEvent;
}

async function streamChatOnce(
  message: string,
  sessionId: string | null | undefined,
  onEvent: (event: ChatStreamEvent) => void,
  clearHistory = false,
  signal?: AbortSignal,
  thinkingEnabled = false,
) {
  const response = await fetch(`${API_BASE}/api/v1/agent/stream`, {
    method: "POST",
    headers: authHeaders(),
    signal,
    body: JSON.stringify({
      message,
      session_id: sessionId ?? undefined,
      clear_history: clearHistory,
      thinking_enabled: thinkingEnabled,
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = typeof body?.detail === "string" ? body.detail : response.statusText;
    throw new Error(detail || "Request failed");
  }

  if (!response.body) {
    throw new Error("This browser does not support streaming responses");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  function flushBlock(block: string) {
    const event = parseSseBlock(block);
    if (event) onEvent(event);
  }

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      flushBlock(block);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    flushBlock(buffer);
  }
}

export async function streamChat(
  message: string,
  sessionId: string | null | undefined,
  onEvent: (event: ChatStreamEvent) => void,
  clearHistory = false,
  signal?: AbortSignal,
  thinkingEnabled = false,
) {
  try {
    await streamChatOnce(message, sessionId, onEvent, clearHistory, signal, thinkingEnabled);
  } catch (error) {
    if (error instanceof Error && /Authentication|required|expired|invalid/i.test(error.message)) {
      try {
        await refreshAuthToken();
      } catch (refreshError) {
        if (refreshError instanceof AuthRecoveryError) {
          await refreshError.recovery;
        } else {
          throw refreshError;
        }
      }
      await streamChatOnce(message, sessionId, onEvent, clearHistory, signal, thinkingEnabled);
      return;
    }
    throw error;
  }
}

export async function listChatSessions() {
  const response = await request<ChatSessionListResponse>("/api/v1/agent/sessions");
  return response.sessions.map(mapConversation);
}

export async function listChatSessionPage(limit = 20, offset = 0) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const response = await request<ChatSessionListResponse>(`/api/v1/agent/sessions?${params.toString()}`);
  return {
    sessions: response.sessions.map(mapConversation),
    total: response.total,
  };
}

export async function createChatSession(title?: string) {
  const response = await request<ChatSessionDetail>("/api/v1/agent/sessions", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
  return mapConversation(response);
}

export async function getChatSession(sessionId: string) {
  const response = await request<ChatSessionDetail>(`/api/v1/agent/sessions/${sessionId}`);
  return mapConversation(response);
}

export async function updateChatSessionTitle(sessionId: string, title: string) {
  const response = await request<ChatSessionSummary>(`/api/v1/agent/sessions/${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
  return mapConversation(response);
}

export function deleteChatSession(sessionId: string) {
  return request<{ status: string }>(`/api/v1/agent/sessions/${sessionId}`, {
    method: "DELETE",
  });
}

export function deleteAllChatSessions() {
  return request<{ status: string; deleted: number; tracing: string }>("/api/v1/agent/sessions", {
    method: "DELETE",
  });
}

export function clearChatSessionMessages(sessionId: string) {
  return request<{ status: string; deleted: number }>(`/api/v1/agent/sessions/${sessionId}/messages`, {
    method: "DELETE",
  });
}

export function getSessionTraces(sessionId: string, limit = 20) {
  const params = new URLSearchParams({ limit: String(limit) });
  return request<TraceSessionResponse>(`/api/v1/tracing/sessions/${sessionId}?${params.toString()}`);
}

export function listWatchlist(category: WatchlistCategory, init?: RequestInit) {
  return request<WatchlistListResponse>(`/api/v1/watchlist?category=${category}`, init);
}

export function getWatchlistOverview(init?: RequestInit) {
  return request<WatchlistOverviewResponse>("/api/v1/watchlist/overview", init);
}

export function searchWatchlist(query: string, category: WatchlistCategory, init?: RequestInit) {
  const params = new URLSearchParams({ q: query, category, limit: "10" });
  return request<WatchlistSearchResponse>(`/api/v1/watchlist/search?${params.toString()}`, init);
}

export function addWatchlistItem(item: Omit<WatchlistItem, "id" | "note" | "created_at" | "updated_at">) {
  return request<WatchlistItem>("/api/v1/watchlist", {
    method: "POST",
    body: JSON.stringify({ ...item, note: "" }),
  });
}

export function deleteWatchlistItem(id: number) {
  return request<{ status: string }>(`/api/v1/watchlist/${id}`, {
    method: "DELETE",
  });
}

export function reorderWatchlist(ids: number[]) {
  return request<{ status: string }>("/api/v1/watchlist/reorder", {
    method: "PATCH",
    body: JSON.stringify({ ids }),
  });
}

// ── Portfolio ───────────────────────────────────────────────────────────────

export function listPortfolio(market: PortfolioMarket) {
  return request<PortfolioListResponse>(`/api/v1/portfolio?market=${market}`);
}

export function searchPortfolioSymbols(query: string, market: PortfolioMarket) {
  const params = new URLSearchParams({ q: query, market, limit: "10" });
  return request<PortfolioSearchResponse>(`/api/v1/portfolio/search?${params.toString()}`);
}

export function addPortfolioItem(item: PortfolioItemDraft) {
  return request<PortfolioItem>("/api/v1/portfolio", {
    method: "POST",
    body: JSON.stringify(item),
  });
}

export function updatePortfolioItem(id: number, item: Partial<PortfolioItemDraft>) {
  return request<PortfolioItem>(`/api/v1/portfolio/${id}`, {
    method: "PATCH",
    body: JSON.stringify(item),
  });
}

export function deletePortfolioItem(id: number) {
  return request<{ status: string }>(`/api/v1/portfolio/${id}`, {
    method: "DELETE",
  });
}

export function savePortfolioSettings(market: PortfolioMarket, totalCapital: string) {
  return request<{ market: PortfolioMarket; total_capital: string }>(`/api/v1/portfolio/settings/${market}`, {
    method: "PUT",
    body: JSON.stringify({ total_capital: totalCapital }),
  });
}

// ── Market dashboard ────────────────────────────────────────────────────────

export function getMarketConfig() {
  return request<MarketDashboardConfig>("/api/v1/market/config");
}

export function saveMarketConfig(config: MarketDashboardConfig) {
  return request<MarketDashboardConfig>("/api/v1/market/config", {
    method: "PUT",
    body: JSON.stringify(config),
  });
}

export function getIndexQuotes() {
  return request<MarketQuotesResponse>("/api/v1/market/index-quotes");
}

export function getStockQuotes(category?: string) {
  const params = category ? `?category=${category}` : "";
  return request<MarketQuotesResponse>(`/api/v1/market/stock-quotes${params}`);
}

export function getDashboard(mode: "bootstrap" | "full" = "full", init?: RequestInit) {
  const params = mode === "full" ? "" : "?mode=bootstrap";
  return request<DashboardResponse>(`/api/v1/dashboard${params}`, init);
}

export function getDashboardMarket(init?: RequestInit) {
  return request<DashboardMarketModule>("/api/v1/dashboard/market", init);
}

export function getDashboardWatchlist(init?: RequestInit) {
  return request<DashboardWatchlistModule>("/api/v1/dashboard/watchlist", init);
}

export function getDashboardPortfolio(init?: RequestInit) {
  return request<DashboardPortfolioModule>("/api/v1/dashboard/portfolio", init);
}

export function getDashboardSymbolInsights(symbol: string, init?: RequestInit) {
  const params = new URLSearchParams({ symbol });
  return request<DashboardSymbolInsightsResponse>(`/api/v1/dashboard/symbol-insights?${params.toString()}`, init);
}

export function getCandlesticks(symbol: string, period: "1D" | "1W" | "1M", count = 200) {
  const params = new URLSearchParams({ symbol, period, count: String(count) });
  return request<CandlesticksResponse>(`/api/v1/market/candlesticks?${params.toString()}`);
}

export function getIntraday(symbol: string, since?: number | null) {
  const params = new URLSearchParams({ symbol });
  if (since != null) params.set("since", String(since));
  return request<IntradayResponse>(`/api/v1/market/intraday?${params.toString()}`);
}

export function getCapitalFlow(symbol: string, init?: RequestInit) {
  const params = new URLSearchParams({ symbol });
  return request<CapitalFlowResponse>(`/api/v1/market/capital-flow?${params.toString()}`, init);
}

export function getMarketTemperature(market: string = "US") {
  return request<MarketTemperature>(`/api/v1/market/temperature?market=${market}`);
}

// ── News ────────────────────────────────────────────────────────────────────

export function getSecurityNews(symbol: string, limit = 50, init?: RequestInit) {
  const params = new URLSearchParams({ symbol, limit: String(limit) });
  return request<SecurityNewsResponse>(`/api/v1/news?${params.toString()}`, init);
}

export function getGuardianFeed(url: string, limit = 30, init?: RequestInit) {
  const params = new URLSearchParams({ url, limit: String(limit) });
  return request<GuardianFeedResponse>(`/api/v1/news/guardian/feed?${params.toString()}`, init);
}

export function getGuardianArticle(url: string, init?: RequestInit) {
  const params = new URLSearchParams({ url });
  return request<GuardianArticleResponse>(`/api/v1/news/guardian/article?${params.toString()}`, init);
}

export function translateGuardianArticle(payload: GuardianTranslateRequest, init?: RequestInit) {
  return request<GuardianTranslateResponse>("/api/v1/news/guardian/translate", {
    ...init,
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ── Fundamentals ─────────────────────────────────────────────────────────────

export function getFinancialReports(
  symbol: string,
  kind: FinancialReportKind = "All",
  period?: FinancialReportPeriod | "",
) {
  const params = new URLSearchParams({ symbol, kind });
  if (period) params.set("period", period);
  return request<FinancialReportsResponse>(`/api/v1/fundamentals/financial-reports?${params.toString()}`);
}

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

// ── Skills ────────────────────────────────────────────────────────────────────

export function listSkills() {
  return request<SkillListResponse>("/api/v1/skills");
}

export function toggleSkill(name: string, enabled: boolean) {
  return request<{ status: string; name: string; enabled: boolean }>(
    `/api/v1/skills/${encodeURIComponent(name)}/toggle`,
    { method: "POST", body: JSON.stringify({ enabled }) },
  );
}

export function refreshSkills() {
  return request<{ status: string; total: number }>("/api/v1/skills/refresh", { method: "POST" });
}

export function deleteSkill(name: string) {
  return request<{ status: string; name: string; deleted_path: string }>(
    `/api/v1/skills/${encodeURIComponent(name)}`,
    { method: "DELETE" },
  );
}

export function searchClawHubSkills(query: string, limit = 20) {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  return request<ClawHubSearchResponse>(`/api/v1/skills/clawhub/search?${params.toString()}`);
}

export function getClawHubSkill(slug: string) {
  return request<ClawHubSkillDetail>(`/api/v1/skills/clawhub/${encodeURIComponent(slug)}`);
}

export function installClawHubSkill(slug: string, payload?: { version?: string | null; tag?: string | null }) {
  return request<ClawHubInstallResponse>(`/api/v1/skills/clawhub/${encodeURIComponent(slug)}/install`, {
    method: "POST",
    body: JSON.stringify({
      version: payload?.version || undefined,
      tag: payload?.tag || undefined,
    }),
  });
}

// ── Memory ────────────────────────────────────────────────────────────────────

export function searchMemory(query: string, options?: { limit?: number; min_score?: number }) {
  const params = new URLSearchParams({ q: query });
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.min_score != null) params.set("min_score", String(options.min_score));
  return request<MemorySearchResult[]>(`/api/v1/memory/search?${params.toString()}`);
}

export function addMemory(content: string, options?: { scope?: string; source?: string }) {
  return request<{ status: string }>("/api/v1/memory/add", {
    method: "POST",
    body: JSON.stringify({ content, scope: options?.scope ?? "user", source: options?.source ?? "manual" }),
  });
}

export function syncMemory() {
  return request<{ status: string }>("/api/v1/memory/sync", { method: "POST" });
}

export function clearMemory() {
  return request<{ status: string; deleted_files: number; deleted_chunks: number; deleted_index_files: number }>(
    "/api/v1/memory/clear",
    { method: "DELETE" },
  );
}

export function getMemoryStatus() {
  return request<MemoryStatus>("/api/v1/memory/status");
}

export function listMemoryFiles() {
  return request<{ files: MemoryFile[] }>("/api/v1/memory/files");
}

export function getMemoryFile(path: string) {
  return request<MemoryFileContent>(`/api/v1/memory/files/${encodeURIComponent(path)}`);
}

export function deleteMemoryFile(path: string) {
  return request<{ status: string; deleted_file: boolean; deleted_chunks: number }>(
    `/api/v1/memory/files/${encodeURIComponent(path)}`,
    { method: "DELETE" },
  );
}

export function deleteMemoryIndex(path: string) {
  return request<{ status: string; deleted_file: boolean; deleted_chunks: number }>(
    `/api/v1/memory/index/${encodeURIComponent(path)}`,
    { method: "DELETE" },
  );
}

// ── Knowledge ─────────────────────────────────────────────────────────────────

export function getKnowledgeTree() {
  return request<{ tree: KnowledgeTree }>("/api/v1/knowledge/tree").then((res) => ({
    root_files: res.tree.root_files ?? [],
    tree: res.tree.tree ?? [],
    stats: res.tree.stats ?? { pages: 0, size: 0 },
    enabled: res.tree.enabled ?? true,
  }));
}

export function getKnowledgeFile(path: string) {
  const params = new URLSearchParams({ path });
  return request<KnowledgeFileContent>(`/api/v1/knowledge/read?${params.toString()}`);
}

export function getKnowledgeGraph() {
  return request<KnowledgeGraph>("/api/v1/knowledge/graph");
}

export function saveKnowledgeFile(payload: { filename: string; content: string; directory?: string }) {
  return request<KnowledgeSaveResponse>("/api/v1/knowledge/files", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function uploadKnowledgeFile(file: File, directory?: string) {
  const content = await file.text();
  return saveKnowledgeFile({ filename: file.name, content, directory });
}

export function saveKnowledgeUrl(payload: { url: string; filename?: string; directory?: string }) {
  return request<KnowledgeSaveResponse>("/api/v1/knowledge/url", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

export function listSchedulerTasks() {
  return request<SchedulerTaskList>("/api/v1/scheduler/tasks");
}

export function createSchedulerTask(payload: {
  name: string;
  prompt: string;
  schedule: string;
  enabled?: boolean;
  notify_telegram?: boolean;
}) {
  return request<SchedulerTask>("/api/v1/scheduler/tasks", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateSchedulerTask(
  id: string,
  payload: {
    name?: string;
    prompt?: string;
    schedule?: string;
    enabled?: boolean;
    notify_telegram?: boolean;
  },
) {
  return request<SchedulerTask>(`/api/v1/scheduler/tasks/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function runSchedulerTaskNow(id: string) {
  return request<SchedulerTaskRun>(`/api/v1/scheduler/tasks/${encodeURIComponent(id)}/run`, {
    method: "POST",
  });
}

export function listSchedulerTaskRuns(id: string, limit = 30) {
  return request<SchedulerTaskRunList>(`/api/v1/scheduler/tasks/${encodeURIComponent(id)}/runs?limit=${limit}`);
}

export function deleteSchedulerTask(id: string) {
  return request<{ status: string }>(`/api/v1/scheduler/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function toggleSchedulerTask(id: string) {
  return request<{ status: string; enabled: boolean }>(`/api/v1/scheduler/tasks/${encodeURIComponent(id)}/toggle`, {
    method: "POST",
  });
}
