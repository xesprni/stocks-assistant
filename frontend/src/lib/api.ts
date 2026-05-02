import type {
  AppConfig,
  CandlesticksResponse,
  ChatResponse,
  IntradayResponse,
  KnowledgeFileContent,
  KnowledgeGraph,
  KnowledgeTree,
  MarketTemperature,
  MCPServerToolsResponse,
  MCPStatusResponse,
  MarketDashboardConfig,
  MarketQuotesResponse,
  MemoryFile,
  MemoryFileContent,
  MemorySearchResult,
  MemoryStatus,
  SchedulerTask,
  SchedulerTaskList,
  SkillListResponse,
  WatchlistCategory,
  WatchlistItem,
  WatchlistListResponse,
  WatchlistSearchResponse,
} from "@/types/app";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
    ...init,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = typeof body?.detail === "string" ? body.detail : response.statusText;
    throw new Error(detail || "请求失败");
  }

  return response.json() as Promise<T>;
}

export function checkHealth() {
  return request<{ status: string }>("/api/v1/health");
}

export function loadConfig() {
  return request<AppConfig>("/api/v1/config");
}

export function saveConfig(payload: Record<string, unknown>) {
  return request<AppConfig>("/api/v1/config", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function sendChat(message: string) {
  return request<ChatResponse>("/api/v1/agent/chat", {
    method: "POST",
    body: JSON.stringify({
      message,
      clear_history: false,
    }),
  });
}

export function listWatchlist(category: WatchlistCategory) {
  return request<WatchlistListResponse>(`/api/v1/watchlist?category=${category}`);
}

export function searchWatchlist(query: string, category: WatchlistCategory) {
  const params = new URLSearchParams({ q: query, category, limit: "10" });
  return request<WatchlistSearchResponse>(`/api/v1/watchlist/search?${params.toString()}`);
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

export function getCandlesticks(symbol: string, period: "1D" | "1W" | "1M", count = 200) {
  const params = new URLSearchParams({ symbol, period, count: String(count) });
  return request<CandlesticksResponse>(`/api/v1/market/candlesticks?${params.toString()}`);
}

export function getIntraday(symbol: string, since?: number | null) {
  const params = new URLSearchParams({ symbol });
  if (since != null) params.set("since", String(since));
  return request<IntradayResponse>(`/api/v1/market/intraday?${params.toString()}`);
}

export function getMarketTemperature(market: string = "US") {
  return request<MarketTemperature>(`/api/v1/market/temperature?market=${market}`);
}

// ── MCP servers ────────────────────────────────────────────────────────────────

export function getMcpStatus() {
  return request<MCPStatusResponse>("/api/v1/mcp/status");
}

export function reconnectMcpServers() {
  return request<MCPStatusResponse>("/api/v1/mcp/reconnect", { method: "POST" });
}

export function getMcpOAuthAuthorizeUrl(serverName: string) {
  return `${API_BASE}/api/v1/mcp/${encodeURIComponent(serverName)}/oauth/authorize`;
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
    body: JSON.stringify({ content, scope: options?.scope ?? "shared", source: options?.source ?? "manual" }),
  });
}

export function syncMemory() {
  return request<{ status: string }>("/api/v1/memory/sync", { method: "POST" });
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

// ── Scheduler ─────────────────────────────────────────────────────────────────

export function listSchedulerTasks() {
  return request<SchedulerTaskList>("/api/v1/scheduler/tasks");
}

export function createSchedulerTask(payload: { name: string; prompt: string; schedule: string; enabled?: boolean }) {
  return request<SchedulerTask>("/api/v1/scheduler/tasks", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteSchedulerTask(id: string) {
  return request<{ status: string }>(`/api/v1/scheduler/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function toggleSchedulerTask(id: string) {
  return request<{ status: string; enabled: boolean }>(`/api/v1/scheduler/tasks/${encodeURIComponent(id)}/toggle`, {
    method: "POST",
  });
}
