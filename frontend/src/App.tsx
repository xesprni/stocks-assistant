import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  BookOpen,
  Bot,
  BrainCircuit,
  BriefcaseBusiness,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  CircleAlert,
  Clock,
  Cpu,
  FlaskConical,
  Home,
  Loader2,
  LogOut,
  MessageSquareText,
  Monitor,
  Moon,
  Plug,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Star,
  Sun,
  Upload,
  UserCog,
  X,
  Zap,
} from "lucide-react";

import { ReauthDialog } from "@/components/ReauthDialog";
import { useConfirmDialog } from "@/components/common/ConfirmDialog";
import { useToast } from "@/components/common/Toast";
import {
  AppNavigationPopover,
  type AppNavGroup,
  type AppNavItem,
} from "@/components/shell/AppNavigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { useFluidSheet } from "@/hooks/useFluidSheet";
import {
  getChatSession,
  getMarketConfig,
  loadConfig,
  sendChat,
  saveConfig,
  streamChat,
  trackProductEvent,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { resetChatThinkingEnabled } from "@/lib/chat-thinking";
import { cn } from "@/lib/utils";
import { toDraft } from "@/lib/config";
import { parseJsonObject } from "@/lib/json";
import { readStoredText, readStoredValue, writeStoredBoolean, writeStoredValue } from "@/lib/local-storage";
import { formatTemplate, i18n, localeFor, normalizeLanguage } from "@/lib/i18n";
import { CHAT_AUTO_SCROLL_THRESHOLD, useConversations } from "@/hooks/useConversations";
import type { AppLanguage } from "@/lib/i18n";
import type { ConfigTab } from "@/pages/ConfigPage";
import type { CompanyTab } from "@/pages/CompanyWorkspacePage";
import type { EffectiveTheme, Page, Theme } from "@/types/ui";
import type {
  AppConfig,
  AuthUser,
  ChatMessage,
  ChatStreamEvent,
  ChatTraceEvent,
  ConfigDraft,
  MarketDashboardConfig,
} from "@/types/app";

const ChatPage = lazy(() => import("@/pages/ChatPage").then((module) => ({ default: module.ChatPage })));
const AuthPage = lazy(() => import("@/pages/AuthPage").then((module) => ({ default: module.AuthPage })));
const ConfigPage = lazy(() => import("@/pages/ConfigPage").then((module) => ({ default: module.ConfigPage })));
const DashboardPage = lazy(() => import("@/pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const CompanyWorkspacePage = lazy(() => import("@/pages/CompanyWorkspacePage").then((module) => ({ default: module.CompanyWorkspacePage })));
const AlertsPage = lazy(() => import("@/pages/AlertsPage").then((module) => ({ default: module.AlertsPage })));
const FinancialReportsPage = lazy(() => import("@/components/FinancialReportsPage").then((module) => ({ default: module.FinancialReportsPage })));
const KnowledgePage = lazy(() => import("@/pages/KnowledgePage").then((module) => ({ default: module.KnowledgePage })));
const MCPPage = lazy(() => import("@/pages/MCPPage").then((module) => ({ default: module.MCPPage })));
const MemoryPage = lazy(() => import("@/pages/MemoryPage").then((module) => ({ default: module.MemoryPage })));
const NewsPage = lazy(() => import("@/pages/NewsPage").then((module) => ({ default: module.NewsPage })));
const PortfolioPage = lazy(() => import("@/components/PortfolioPage").then((module) => ({ default: module.PortfolioPage })));
const InvestmentLabsPage = lazy(() => import("@/pages/InvestmentLabsPage").then((module) => ({ default: module.InvestmentLabsPage })));
const SecurityPage = lazy(() => import("@/pages/SecurityPage").then((module) => ({ default: module.SecurityPage })));
const SkillsPage = lazy(() => import("@/pages/SkillsPage").then((module) => ({ default: module.SkillsPage })));
const SubAgentsPage = lazy(() => import("@/pages/SubAgentsPage").then((module) => ({ default: module.SubAgentsPage })));
const TracingPage = lazy(() => import("@/pages/TracingPage").then((module) => ({ default: module.TracingPage })));
const UsersPage = lazy(() => import("@/pages/UsersPage").then((module) => ({ default: module.UsersPage })));
const WatchlistPage = lazy(() => import("@/pages/WatchlistPage").then((module) => ({ default: module.WatchlistPage })));

type ConfigToast = { id: number; kind: "success" | "error"; message: string; state: "open" | "closing" };

const MOBILE_HEADER_VISIBLE_KEY = "stocks-assistant-mobile-header-visible";
const LEGACY_MOBILE_CHROME_HIDDEN_KEY = "stocks-assistant-mobile-chrome-hidden";

const DEFAULT_PAGE_PERMISSION: Partial<Record<Page, string>> = {
  overview: "config:read",
  company: "knowledge:read",
  tracing: "tracing:read",
  security: "config:read",
  watchlist: "watchlist:read",
  portfolio: "portfolio:read",
  labs: "portfolio:read",
  news: "market:read",
  config: "config:read",
  fundamentals: "fundamentals:read",
  skills: "skills:read",
  subagents: "config:write",
  mcp: "mcp:read",
  memory: "memory:read",
  knowledge: "knowledge:read",
  scheduler: "scheduler:read",
  users: "users:manage",
};

const PAGE_PATH: Record<Page, string> = {
  overview: "/dashboard",
  company: "/security",
  tracing: "/tracing",
  security: "/admin/security",
  watchlist: "/watchlist",
  portfolio: "/portfolio",
  labs: "/labs",
  news: "/news",
  config: "/settings",
  fundamentals: "/fundamentals",
  skills: "/skills",
  subagents: "/subagents",
  mcp: "/mcp",
  memory: "/memory",
  knowledge: "/knowledge",
  scheduler: "/alerts",
  users: "/users",
};

const PATH_PAGE = new Map<string, Page>([
  ...Object.entries(PAGE_PATH).map(([page, path]) => [path, page as Page] as const),
  ["/", "overview"],
  ["/config", "config"],
  ["/chat", "overview"],
  ["/chart", "watchlist"],
  ["/market", "overview"],
  ["/market/config", "config"],
  ["/overview", "overview"],
  ["/scheduler", "scheduler"],
]);

const CONFIG_PAYLOAD_KEYS_BY_DRAFT_KEY: Partial<Record<keyof ConfigDraft, string[]>> = {
  llm_provider: ["llm_provider", "llm_auth_mode"],
  llm_auth_mode: ["llm_provider", "llm_auth_mode"],
  llm_api_base: ["llm_api_base"],
  llm_model: ["llm_model"],
  llm_api_key: ["llm_api_key"],
  llm_codex_auth_file: ["llm_codex_auth_file"],
  llm_codex_api_base: ["llm_codex_api_base"],
  llm_codex_model: ["llm_codex_model"],
  llm_temperature: ["llm_temperature"],
  llm_max_output_tokens: ["llm_max_output_tokens"],
  llm_reasoning_effort: ["llm_reasoning_effort"],
  llm_tool_choice: ["llm_tool_choice"],
  embedding_auth_mode: ["embedding_auth_mode"],
  embedding_api_base: ["embedding_api_base"],
  embedding_model: ["embedding_model"],
  embedding_provider: ["embedding_provider"],
  embedding_api_key: ["embedding_api_key"],
  embedding_codex_auth_file: ["embedding_codex_auth_file"],
  embedding_codex_api_base: ["embedding_codex_api_base"],
  embedding_codex_model: ["embedding_codex_model"],
  workspace_dir: ["workspace_dir"],
  app_language: ["app_language"],
  auth_max_devices_per_user: ["auth_max_devices_per_user"],
  agent_max_steps: ["agent_max_steps"],
  agent_max_context_tokens: ["agent_max_context_tokens"],
  agent_max_context_turns: ["agent_max_context_turns"],
  agent_tool_allowlist: ["agent_tool_allowlist"],
  agent_allow_all_mcp_tools: ["agent_allow_all_mcp_tools"],
  multi_agent_enabled: ["multi_agent_enabled"],
  multi_agent_max_parallel_agents: ["multi_agent_max_parallel_agents"],
  multi_agent_default_max_steps: ["multi_agent_default_max_steps"],
  multi_agent_max_depth: ["multi_agent_max_depth"],
  multi_agent_dangerous_tools: ["multi_agent_dangerous_tools"],
  multi_agent_roles: ["multi_agent_roles"],
  knowledge_enabled: ["knowledge_enabled"],
  memory_enabled: ["memory_enabled"],
  memory_auto_curate_enabled: ["memory_auto_curate_enabled"],
  memory_curator_min_importance: ["memory_curator_min_importance"],
  memory_curator_min_confidence: ["memory_curator_min_confidence"],
  scheduler_enabled: ["scheduler_enabled"],
  tracing_enabled: ["tracing_enabled"],
  product_analytics_enabled: ["product_analytics_enabled"],
  telegram_enabled: ["telegram_enabled"],
  telegram_bot_token: ["telegram_bot_token"],
  telegram_chat_id: ["telegram_chat_id"],
  telegram_api_base: ["telegram_api_base"],
  telegram_parse_mode: ["telegram_parse_mode"],
  system_prompt: ["system_prompt"],
  mcp_servers_text: ["mcp_servers"],
  mcp_tool_timeout_seconds: ["mcp_tool_timeout_seconds"],
  longbridge_app_key: ["longbridge_app_key"],
  longbridge_app_secret: ["longbridge_app_secret"],
  longbridge_access_token: ["longbridge_access_token"],
  longbridge_http_url: ["longbridge_http_url"],
  longbridge_quote_ws_url: ["longbridge_quote_ws_url"],
  guardian_api_key: ["guardian_api_key"],
  search_api_url: ["search_api_url"],
  search_api_key: ["search_api_key"],
  debug: ["debug"],
};

const PERSONAL_CONFIG_PAYLOAD_KEYS = new Set([
  "llm_provider",
  "llm_auth_mode",
  "llm_api_key",
  "llm_api_base",
  "llm_model",
  "llm_codex_auth_file",
  "llm_codex_api_base",
  "llm_codex_model",
  "llm_temperature",
  "llm_max_output_tokens",
  "llm_reasoning_effort",
  "llm_tool_choice",
  "embedding_auth_mode",
  "embedding_api_key",
  "embedding_api_base",
  "embedding_model",
  "embedding_provider",
  "embedding_codex_auth_file",
  "embedding_codex_api_base",
  "embedding_codex_model",
  "telegram_enabled",
  "telegram_bot_token",
  "telegram_chat_id",
  "telegram_api_base",
  "telegram_parse_mode",
  "mcp_servers",
  "mcp_tool_timeout_seconds",
  "longbridge_app_key",
  "longbridge_app_secret",
  "longbridge_access_token",
  "longbridge_http_url",
  "longbridge_quote_ws_url",
  "guardian_api_key",
  "search_api_url",
  "search_api_key",
  "app_language",
  "agent_max_steps",
  "agent_max_context_tokens",
  "agent_max_context_turns",
  "multi_agent_enabled",
  "multi_agent_max_parallel_agents",
  "multi_agent_default_max_steps",
  "multi_agent_max_depth",
  "knowledge_enabled",
  "memory_enabled",
  "memory_auto_curate_enabled",
  "memory_curator_min_importance",
  "memory_curator_min_confidence",
  "scheduler_enabled",
  "tracing_enabled",
  "product_analytics_enabled",
  "debug",
]);

function navItem(language: AppLanguage, id: Page, icon: ReactNode, labelOverride?: string, hintOverride?: string): AppNavItem {
  const [label, hint] = i18n[language].nav[id as keyof typeof i18n.zh.nav];
  return { id, label: labelOverride ?? label, icon, hint: hintOverride ?? hint, href: PAGE_PATH[id] };
}

function getNavigationGroups(language: AppLanguage): AppNavGroup[] {
  const primary = language === "en"
    ? { group: "Workspace", today: "Today", companies: "Companies", portfolio: "Portfolio", labs: "Labs", research: "Research", alerts: "Alerts" }
    : { group: "工作台", today: "今日", companies: "公司", portfolio: "组合", labs: "实验室", research: "研究", alerts: "提醒" };
  return [
    {
      id: "primary",
      label: primary.group,
      items: [
        navItem(language, "overview", <Home />, primary.today),
        navItem(language, "watchlist", <Star />, primary.companies),
        navItem(language, "portfolio", <BriefcaseBusiness />, primary.portfolio),
        navItem(language, "labs", <FlaskConical />, primary.labs),
        navItem(language, "knowledge", <BookOpen />, primary.research),
        navItem(language, "scheduler", <Clock />, primary.alerts),
      ],
    },
    {
      id: "developer",
      label: language === "en" ? "Developer Center" : "开发者中心",
      items: [
        navItem(language, "tracing", <Cpu />),
        navItem(language, "skills", <Zap />),
        navItem(language, "subagents", <Bot />),
        navItem(language, "mcp", <Plug />),
        navItem(language, "memory", <BrainCircuit />),
      ],
    },
    {
      id: "admin",
      label: language === "en" ? "Administration" : "系统管理",
      items: [
        navItem(language, "security", <ShieldCheck />),
        navItem(language, "users", <UserCog />),
        navItem(language, "config", <Settings2 />),
      ],
    },
  ];
}

function chatTime(language: AppLanguage = "zh") {
  return new Date().toLocaleTimeString(localeFor(language), { hour: "2-digit", minute: "2-digit" });
}

function getStreamText(data: Record<string, unknown> | undefined, key: string) {
  const value = data?.[key];
  return typeof value === "string" ? value : "";
}

function getStreamNumber(data: Record<string, unknown> | undefined, key: string) {
  const value = data?.[key];
  return typeof value === "number" ? value : null;
}

function getStreamObject(data: Record<string, unknown> | undefined, key: string) {
  const value = data?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function compactStreamText(value: string, maxLength = 96) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}

function formatDurationDetail(ms: number | null) {
  return ms == null ? undefined : `${(ms / 1000).toFixed(2)}s`;
}

function normalizeRoutePath(pathname: string) {
  const clean = pathname.replace(/\/+$/, "");
  return clean || "/";
}

function pageFromPath(pathname: string): Page {
  if (companyRouteFromPath(pathname)) return "company";
  return PATH_PAGE.get(normalizeRoutePath(pathname)) ?? "overview";
}

function pathForPage(page: Page) {
  return PAGE_PATH[page] ?? PAGE_PATH.overview;
}

const COMPANY_TABS = new Set<CompanyTab>(["overview", "chart", "financials", "documents", "news", "ai-research", "thesis", "valuation", "position", "alerts"]);

function companyRouteFromPath(pathname: string): { symbol: string; tab: CompanyTab } | null {
  const match = normalizeRoutePath(pathname).match(/^\/security\/([^/]+)(?:\/([^/]+))?$/);
  if (!match) return null;
  const symbol = decodeURIComponent(match[1]).trim().toUpperCase();
  const tabValue = decodeURIComponent(match[2] || "overview") as CompanyTab;
  if (!symbol || !COMPANY_TABS.has(tabValue)) return null;
  return { symbol, tab: tabValue };
}

function pathForCompany(route: { symbol: string; tab: CompanyTab }) {
  return `/security/${encodeURIComponent(route.symbol)}/${route.tab}`;
}

function configTabFromPath(pathname: string): ConfigTab | undefined {
  return normalizeRoutePath(pathname) === "/market/config" ? "market" : undefined;
}

function ConfigSaveToast({ onClose, toast }: { onClose: () => void; toast: ConfigToast | null }) {
  if (!toast) return null;
  const Icon = toast.kind === "success" ? CheckCircle2 : CircleAlert;
  return (
    <div
      className={cn(
        "config-toast",
        "fixed right-4 top-4 z-[1200] flex w-[min(360px,calc(100vw-2rem))] items-start gap-3 rounded-md border px-3 py-3 text-sm shadow-lg",
        "bg-popover text-popover-foreground",
        toast.kind === "success" ? "border-primary/35" : "border-destructive/45",
      )}
      data-state={toast.state}
      role="status"
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", toast.kind === "success" ? "text-primary" : "text-destructive")} />
      <span className="min-w-0 flex-1 leading-5">{toast.message}</span>
      <button
        aria-label="Close"
        className="rounded-sm p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
        type="button"
        onClick={onClose}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function summarizeToolArguments(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const entries = Object.entries(value as Record<string, unknown>).slice(0, 3);
  return entries
    .map(([key, item]) => {
      const raw = typeof item === "string" ? item : JSON.stringify(item) ?? String(item);
      const text = raw.length > 80 ? `${raw.slice(0, 80)}...` : raw;
      return `${key}: ${text}`;
    })
    .join(", ");
}

function makeTrace(label: string, status: ChatTraceEvent["status"], detail?: string, id: string = crypto.randomUUID()): ChatTraceEvent {
  return { id, label, status, detail, createdAt: chatTime() };
}

function isChatScrolledToBottom(element: HTMLDivElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= CHAT_AUTO_SCROLL_THRESHOLD;
}

function isTheme(value: string | null): value is Theme {
  return value === "system" || value === "dark" || value === "light";
}

function isMobileShellViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches;
}

function systemTheme(): EffectiveTheme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function effectiveTheme(theme: Theme, systemPreference: EffectiveTheme): EffectiveTheme {
  return theme === "system" ? systemPreference : theme;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isNetworkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /Load failed|Failed to fetch|NetworkError|network connection was lost|offline|cancelled/i.test(message);
}

function waitForPageResume(timeoutMs = 15000): Promise<void> {
  if (document.visibilityState !== "hidden" && navigator.onLine !== false) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    const cleanup = () => {
      window.removeEventListener("focus", check);
      window.removeEventListener("online", check);
      window.removeEventListener("pageshow", check);
      document.removeEventListener("visibilitychange", check);
      window.clearTimeout(timer);
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const check = () => {
      if (document.visibilityState !== "hidden" && navigator.onLine !== false) {
        finish();
      }
    };
    const timer = window.setTimeout(finish, timeoutMs);
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    window.addEventListener("pageshow", check);
    document.addEventListener("visibilitychange", check);
  });
}

function chatFailureMessage(error: unknown, language: AppLanguage): string {
  if (isNetworkLoadError(error)) return i18n[language].chat.networkLoadFailed;
  return error instanceof Error ? error.message : (language === "en" ? "Chat request failed" : "对话请求失败");
}

// ── Chat History ───────────────────────────────────────────────────────────

function App() {
  const auth = useAuth();
  if (auth.loading) {
    return (
      <div className="console-shell grid h-[100dvh] place-items-center">
        <div className="flex items-center gap-2 rounded-md border border-border/80 bg-background/70 px-3 py-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-primary" />
          Loading...
        </div>
      </div>
    );
  }
  if (auth.setupRequired || !auth.user) {
    return (
      <Suspense fallback={<PageFallback />}>
        <AuthPage />
      </Suspense>
    );
  }
  return <ConsoleApp />;
}

function ConsoleApp() {
  const auth = useAuth();
  const { showToast } = useToast();
  const [page, setPage] = useState<Page>(() => pageFromPath(window.location.pathname));
  const [companyRoute, setCompanyRoute] = useState(() => companyRouteFromPath(window.location.pathname) ?? { symbol: "AAPL.US", tab: "overview" as CompanyTab });
  const [selectedSymbol, setSelectedSymbol] = useState<string>("");
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = readStoredValue("stocks-assistant-theme", ["system", "dark", "light"], "system");
    return isTheme(stored) ? stored : "system";
  });
  const [systemPreference, setSystemPreference] = useState<EffectiveTheme>(() => systemTheme());
  const [prompt, setPrompt] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [draft, setDraft] = useState<ConfigDraft | null>(null);
  const [configState, setConfigState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [configToast, setConfigToast] = useState<ConfigToast | null>(null);
  const [marketConfig, setMarketConfig] = useState<MarketDashboardConfig>({ indices: [], refresh_interval: 60 });
  const [isMobileHeaderVisible, setIsMobileHeaderVisible] = useState(() => {
    const stored = readStoredText(MOBILE_HEADER_VISIBLE_KEY, "");
    if (stored === "true" || stored === "false") return stored === "true";
    return readStoredText(LEGACY_MOBILE_CHROME_HIDDEN_KEY, "") !== "true";
  });
  const [isMobileViewport, setIsMobileViewport] = useState(() => isMobileShellViewport());
  const [dashboardChatExpanded, setDashboardChatExpanded] = useState(false);
  const [dashboardChatDrawerOpen, setDashboardChatDrawerOpen] = useState(false);
  const [dashboardChatFullscreen, setDashboardChatFullscreen] = useState(false);
  const [configInitialTab, setConfigInitialTab] = useState<ConfigTab>(() => configTabFromPath(window.location.pathname) ?? "model");
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const mainContentRef = useRef<HTMLElement | null>(null);
  const previousPageRef = useRef<Page | null>(null);
  const shouldAutoScrollChatRef = useRef(true);
  const streamAbortRef = useRef<AbortController | null>(null);
  const isSendingRef = useRef(false);
  const configDirtyPatchRef = useRef<Partial<ConfigDraft>>({});
  const configToastTimerRef = useRef<number | null>(null);
  const configToastExitTimerRef = useRef<number | null>(null);
  const routeReadyRef = useRef(false);
  const chatHistory = useConversations();
  const confirmDialog = useConfirmDialog();
  const language = normalizeLanguage(draft?.app_language ?? config?.app_language);
  const ui = i18n[language];
  const quickPrompts = ui.quickPrompts;

  const messages = chatHistory.activeConversation?.messages ?? [];
  const activeConvId = chatHistory.activeId;
  const pagePermissions = auth.user?.page_permissions ?? DEFAULT_PAGE_PERMISSION;
  const canPage = (target: Page) => {
    const permission = pagePermissions[target] ?? DEFAULT_PAGE_PERMISSION[target];
    return !permission || auth.can(permission);
  };
  const navigationGroups = getNavigationGroups(language)
    .map((group) => ({ ...group, items: group.items.filter((item) => canPage(item.id)) }))
    .filter((group) => group.items.length > 0);
  const firstAllowedPage = navigationGroups[0]?.items[0]?.id ?? null;
  // 权限在前端渲染前即生效，避免未授权页面先挂载并发起数据请求。
  const activePage = canPage(page) ? page : firstAllowedPage;
  const activeNavItem = navigationGroups.flatMap((group) => group.items).find((item) => item.id === activePage);

  useEffect(() => {
    const handlePopState = () => {
      const nextCompanyRoute = companyRouteFromPath(window.location.pathname);
      if (nextCompanyRoute) setCompanyRoute(nextCompanyRoute);
      const nextTab = configTabFromPath(window.location.pathname);
      if (nextTab) setConfigInitialTab(nextTab);
      setPage(pageFromPath(window.location.pathname));
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (!activePage) {
      routeReadyRef.current = true;
      return;
    }
    const nextPath = activePage === "company" ? pathForCompany(companyRoute) : pathForPage(activePage);
    if (normalizeRoutePath(window.location.pathname) !== nextPath) {
      const method = routeReadyRef.current && activePage === page ? "pushState" : "replaceState";
      window.history[method]({ page: activePage }, "", `${nextPath}${window.location.search}${window.location.hash}`);
    }
    routeReadyRef.current = true;
  }, [activePage, page, companyRoute]);

  useEffect(() => {
    if (!canPage(page) && firstAllowedPage) {
      setPage(firstAllowedPage);
    }
  }, [page, auth.permissions, firstAllowedPage, pagePermissions]);

  useEffect(() => {
    setDashboardChatDrawerOpen(false);
    setDashboardChatFullscreen(false);
  }, [page]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const handleChange = () => {
      setIsMobileViewport(media.matches);
      if (!media.matches) {
        setDashboardChatDrawerOpen(false);
        setDashboardChatFullscreen(false);
      }
    };
    handleChange();
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (page !== "overview" || !shouldAutoScrollChatRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      if (!shouldAutoScrollChatRef.current) return;
      const element = chatScrollRef.current;
      if (element) {
        element.scrollTop = element.scrollHeight;
      } else {
        endRef.current?.scrollIntoView({ block: "end" });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, page]);

  useEffect(() => {
    shouldAutoScrollChatRef.current = true;
    const frame = window.requestAnimationFrame(() => {
      const element = chatScrollRef.current;
      if (element) element.scrollTop = element.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeConvId]);

  function handleChatScroll() {
    const element = chatScrollRef.current;
    if (!element) return;
    shouldAutoScrollChatRef.current = isChatScrolledToBottom(element);
  }

  const resolvedTheme = effectiveTheme(theme, systemPreference);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => setSystemPreference(media.matches ? "dark" : "light");
    handleChange();
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    return () => {
      if (configToastTimerRef.current) {
        window.clearTimeout(configToastTimerRef.current);
      }
      if (configToastExitTimerRef.current) {
        window.clearTimeout(configToastExitTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
    document.documentElement.style.colorScheme = resolvedTheme;
    writeStoredValue("stocks-assistant-theme", theme);
  }, [resolvedTheme, theme]);

  useEffect(() => {
    document.documentElement.lang = language === "en" ? "en" : "zh-CN";
    document.title = `${activeNavItem?.label ?? ui.shell.noPageAccessTitle} — Stocks Assistant`;
  }, [activeNavItem?.label, language, ui.shell.noPageAccessTitle]);

  useEffect(() => {
    if (previousPageRef.current === null) {
      previousPageRef.current = activePage;
      return;
    }
    if (previousPageRef.current === activePage) return;
    previousPageRef.current = activePage;
    const frame = window.requestAnimationFrame(() => {
      if (!mainContentRef.current) return;
      mainContentRef.current.scrollTop = 0;
      mainContentRef.current.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activePage]);

  useEffect(() => {
    writeStoredBoolean(MOBILE_HEADER_VISIBLE_KEY, isMobileHeaderVisible);
  }, [isMobileHeaderVisible]);

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      const [configResult, marketConfigResult] = await Promise.allSettled([
        loadConfig(),
        getMarketConfig(),
      ]);
      if (!mounted) return;

      if (configResult.status === "fulfilled") {
        setConfig(configResult.value);
        setDraft(toDraft(configResult.value));
      } else {
        const message = configResult.reason instanceof Error ? configResult.reason.message : (language === "en" ? "Failed to load configuration" : "配置加载失败");
        showToast({ kind: "error", message, title: language === "en" ? "Configuration" : "配置" });
      }
      if (marketConfigResult.status === "fulfilled") {
        setMarketConfig(marketConfigResult.value);
      }
    }

    bootstrap();
    return () => {
      mounted = false;
    };
  }, []);

  const enabledCount = useMemo(() => {
    if (!config) return 0;
    return [config.memory_enabled, config.knowledge_enabled, config.scheduler_enabled, config.tracing_enabled].filter(Boolean).length;
  }, [config]);

  async function handleSend(
    event?: { preventDefault: () => void },
    value = prompt,
    options: { forceNewSession?: boolean; newSession?: boolean; thinkingEnabled?: boolean } = {},
  ) {
    event?.preventDefault();
    const text = value.trim();
    if (!text || isSendingRef.current) return;

    shouldAutoScrollChatRef.current = true;
    const createdAt = chatTime(language);
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      createdAt,
    };
    const pendingMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: ui.chat.connecting,
      createdAt,
      pending: true,
      status: ui.chat.connecting,
      trace: [makeTrace(ui.chat.connecting, "running")],
    };

    setPrompt("");
    isSendingRef.current = true;
    setIsSending(true);
    if (config?.product_analytics_enabled) {
      void trackProductEvent("research_started").catch(() => undefined);
    }
    handleNavigate("overview");

    const shouldCreateNewSession = options.forceNewSession === true || options.newSession === true;
    if (shouldCreateNewSession && options.thinkingEnabled !== true) {
      resetChatThinkingEnabled();
    }
    let convId = shouldCreateNewSession ? null : activeConvId;
    let assistantMessageId = pendingMessage.id;
    let streamedContent = "";
    let currentStatus = ui.chat.connecting;
    let trace = pendingMessage.trace ?? [];
    let sawAgentEnd = false;
    const abortController = new AbortController();
    streamAbortRef.current = abortController;

    const updateAssistant = (patch: Partial<ChatMessage>) => {
      if (!convId) return;
      chatHistory.updateMessage(convId, assistantMessageId, patch);
      if (typeof patch.id === "string") {
        assistantMessageId = patch.id;
      }
    };

    const commitStreamState = (patch: Partial<ChatMessage> = {}) => {
      updateAssistant({
        content: streamedContent || currentStatus,
        status: currentStatus,
        trace,
        ...patch,
      });
    };

    try {
      if (!convId) {
        convId = await chatHistory.createConversation(userMessage);
        chatHistory.addMessage(convId, pendingMessage);
      } else {
        chatHistory.addMessage(convId, userMessage);
        chatHistory.addMessage(convId, pendingMessage);
      }

      const addTrace = (item: ChatTraceEvent) => {
        trace = [...trace, item].slice(-30);
        currentStatus = item.label;
        commitStreamState();
      };

      const updateTrace = (id: string, patch: Partial<ChatTraceEvent>) => {
        trace = trace.map((item) => (item.id === id ? { ...item, ...patch } : item));
        commitStreamState();
      };

      await streamChat(text, convId, (streamEvent: ChatStreamEvent) => {
        const data = streamEvent.data;

        if (streamEvent.type === "error") {
          throw new Error(getStreamText(data, "error") || (language === "en" ? "Chat request failed" : "对话请求失败"));
        }

        if (streamEvent.type === "agent_start") {
          updateTrace(trace[0]?.id ?? "", { status: "done", label: ui.chat.streamReady });
          currentStatus = ui.chat.analyzing;
          commitStreamState();
          return;
        }

        if (streamEvent.type === "status_update") {
          currentStatus = getStreamText(data, "message") || ui.chat.modelAnalyzing;
          commitStreamState();
          return;
        }

        if (streamEvent.type === "subagent_batch_start") {
          const batchId = getStreamText(data, "batch_id") || crypto.randomUUID();
          const taskCount = getStreamNumber(data, "task_count");
          const roles = Array.isArray(data?.roles) ? data.roles.map(String).join(", ") : "";
          addTrace(makeTrace(ui.chat.subBatchStart, "running", `${formatTemplate(ui.chat.subTasks, { count: taskCount ?? 0 })}${roles ? ` · ${roles}` : ""}`, batchId));
          return;
        }

        if (streamEvent.type === "subagent_batch_end") {
          const batchId = getStreamText(data, "batch_id");
          const status = getStreamText(data, "status") === "success" ? "done" : "error";
          const detail = formatDurationDetail(getStreamNumber(data, "duration_ms"));
          if (batchId) {
            updateTrace(batchId, { label: ui.chat.subBatchDone, status, detail });
          } else {
            addTrace(makeTrace(ui.chat.subBatchDone, status, detail));
          }
          currentStatus = status === "done" ? ui.chat.subBatchResult : ui.chat.subBatchPartial;
          commitStreamState();
          return;
        }

        if (streamEvent.type === "subagent_start") {
          const batchId = getStreamText(data, "batch_id") || "batch";
          const taskId = getStreamText(data, "task_id") || crypto.randomUUID();
          const role = getStreamText(data, "role") || "subagent";
          const task = getStreamText(data, "task");
          addTrace(makeTrace(`${role} ${ui.chat.subStart}`, "running", compactStreamText(task), `sub:${batchId}:${taskId}`));
          return;
        }

        if (streamEvent.type === "subagent_end") {
          const batchId = getStreamText(data, "batch_id") || "batch";
          const taskId = getStreamText(data, "task_id") || "";
          const role = getStreamText(data, "role") || "subagent";
          const status = getStreamText(data, "status") === "success" ? "done" : "error";
          const errorText = getStreamText(data, "error");
          const detail = errorText || formatDurationDetail(getStreamNumber(data, "duration_ms"));
          updateTrace(`sub:${batchId}:${taskId}`, { label: `${role} ${ui.chat.subDone}`, status, detail });
          currentStatus = status === "done" ? `${role} ${ui.chat.subBatchResult}` : `${role} ${language === "en" ? "failed" : "执行失败"}`;
          commitStreamState();
          return;
        }

        if (streamEvent.type === "subagent_event") {
          const batchId = getStreamText(data, "batch_id") || "batch";
          const taskId = getStreamText(data, "task_id") || "task";
          const role = getStreamText(data, "role") || "subagent";
          const childType = getStreamText(data, "child_event_type");
          const childData = getStreamObject(data, "child_data");

          if (childType === "turn_start") {
            const turn = getStreamNumber(childData, "turn");
            addTrace(makeTrace(`${role} ${formatTemplate(ui.chat.turn, { turn: turn ?? "?" })}`, "running", undefined, `sub:${batchId}:${taskId}:turn:${turn ?? crypto.randomUUID()}`));
            return;
          }

          if (childType === "turn_end") {
            const turn = getStreamNumber(childData, "turn");
            if (turn != null) updateTrace(`sub:${batchId}:${taskId}:turn:${turn}`, { status: "done", label: `${role} ${formatTemplate(ui.chat.turn, { turn })} ${ui.chat.subDone}` });
            currentStatus = `${role} ${ui.chat.subRunning}`;
            commitStreamState();
            return;
          }

          if (childType === "tool_execution_start") {
            const toolCallId = getStreamText(childData, "tool_call_id") || crypto.randomUUID();
            const toolName = getStreamText(childData, "tool_name") || "tool";
            addTrace(makeTrace(`${role} ${ui.chat.callTool} ${toolName}`, "running", summarizeToolArguments(childData?.arguments), `sub:${batchId}:${taskId}:tool:${toolCallId}`));
            return;
          }

          if (childType === "tool_execution_end") {
            const toolCallId = getStreamText(childData, "tool_call_id");
            const toolName = getStreamText(childData, "tool_name") || "tool";
            const status = getStreamText(childData, "status") === "success" ? "done" : "error";
            const seconds = getStreamNumber(childData, "execution_time");
            const detail = seconds == null ? undefined : `${seconds.toFixed(2)}s`;
            if (toolCallId) updateTrace(`sub:${batchId}:${taskId}:tool:${toolCallId}`, { label: `${role} ${formatTemplate(ui.chat.toolDone, { tool: toolName })}`, status, detail });
            currentStatus = `${role} ${ui.chat.subToolReturned}`;
            commitStreamState();
            return;
          }

          if (childType === "message_update") {
            currentStatus = `${role} ${ui.chat.subGenerating}`;
            commitStreamState();
            return;
          }

          if (childType === "message_end") {
            currentStatus = `${role} ${ui.chat.subGenerated}`;
            commitStreamState();
            return;
          }
        }

        if (streamEvent.type === "turn_start") {
          const turn = getStreamNumber(data, "turn");
          addTrace(makeTrace(turn ? formatTemplate(ui.chat.turn, { turn }) : ui.chat.startAnalysis, "running"));
          return;
        }

        if (streamEvent.type === "message_start") {
          currentStatus = ui.chat.messageStart;
          commitStreamState();
          return;
        }

        if (streamEvent.type === "message_update") {
          streamedContent += getStreamText(data, "delta");
          currentStatus = ui.chat.generating;
          commitStreamState();
          return;
        }

        if (streamEvent.type === "tool_execution_start") {
          const toolCallId = getStreamText(data, "tool_call_id") || crypto.randomUUID();
          const toolName = getStreamText(data, "tool_name") || "tool";
          addTrace(makeTrace(`${ui.chat.callTool} ${toolName}`, "running", summarizeToolArguments(data?.arguments), toolCallId));
          return;
        }

        if (streamEvent.type === "tool_execution_end") {
          const toolCallId = getStreamText(data, "tool_call_id");
          const toolName = getStreamText(data, "tool_name") || "tool";
          const status = getStreamText(data, "status") === "success" ? "done" : "error";
          const seconds = getStreamNumber(data, "execution_time");
          const detail = seconds == null ? undefined : `${seconds.toFixed(2)}s`;
          if (toolCallId) {
            updateTrace(toolCallId, { label: formatTemplate(ui.chat.toolDone, { tool: toolName }), status, detail });
          } else {
            addTrace(makeTrace(formatTemplate(ui.chat.toolDone, { tool: toolName }), status, detail));
          }
          currentStatus = status === "done" ? ui.chat.toolDoneContinue : ui.chat.toolFailedContinue;
          commitStreamState();
          return;
        }

        if (streamEvent.type === "turn_end") {
          const hasToolCalls = data?.has_tool_calls === true;
          currentStatus = hasToolCalls ? ui.chat.toolResultsReturned : ui.chat.finishing;
          commitStreamState();
          return;
        }

        if (streamEvent.type === "agent_end") {
          sawAgentEnd = true;
          const finalResponse = getStreamText(data, "final_response");
          const messageId = getStreamText(data, "message_id");
          const sources = Array.isArray(data?.sources)
            ? data.sources.filter((item): item is NonNullable<ChatMessage["sources"]>[number] => Boolean(item && typeof item === "object" && "id" in item))
            : [];
          if (config?.product_analytics_enabled) {
            void trackProductEvent("research_response_completed", { source_count: sources.length }).catch(() => undefined);
          }
          streamedContent = finalResponse || streamedContent || ui.chat.empty;
          currentStatus = ui.chat.complete;
          trace = trace.map((item) => (item.status === "running" ? { ...item, status: "done" } : item));
          updateAssistant({
            id: messageId || assistantMessageId,
            content: streamedContent,
            pending: false,
            status: currentStatus,
            trace,
            sources,
            createdAt: chatTime(language),
          });
        }
      }, false, abortController.signal, options.thinkingEnabled === true);

      if (!sawAgentEnd) {
        trace = trace.map((item) => (item.status === "running" ? { ...item, status: "done" } : item));
        updateAssistant({
          content: streamedContent || ui.chat.empty,
          pending: false,
          status: ui.chat.complete,
          trace,
          createdAt: chatTime(language),
        });
      }
    } catch (caught) {
      if (isAbortError(caught)) {
        const stoppedContent = streamedContent
          ? `${streamedContent.trimEnd()}\n\n_${ui.chat.stopped}_`
          : ui.chat.stopped;
        trace = trace.map((item) => (item.status === "running" ? { ...item, status: "done", detail: item.detail || ui.chat.stopped } : item));
        if (convId) {
          chatHistory.updateMessage(convId, assistantMessageId, {
            content: stoppedContent,
            pending: false,
            status: ui.chat.stopped,
            trace,
            createdAt: chatTime(language),
          });
        }
        return;
      }
      if (isNetworkLoadError(caught) && convId && !sawAgentEnd) {
        try {
          currentStatus = ui.chat.streamRecovering;
          trace = trace.map((item) => (item.status === "running" ? { ...item, detail: item.detail || ui.chat.streamInterrupted } : item));
          commitStreamState();

          await waitForPageResume();

          const synced = await getChatSession(convId);
          let userIndex = -1;
          for (let index = synced.messages.length - 1; index >= 0; index -= 1) {
            const message = synced.messages[index];
            if (message.role === "user" && message.content === text) {
              userIndex = index;
              break;
            }
          }
          const persistedAssistant = userIndex >= 0
            ? synced.messages.slice(userIndex + 1).find((message) => message.role === "assistant" && message.content.trim())
            : undefined;

          if (persistedAssistant) {
            streamedContent = persistedAssistant.content;
            trace = trace.map((item) => (item.status === "running" ? { ...item, status: "done" } : item));
            updateAssistant({
              id: persistedAssistant.id,
              content: streamedContent,
              pending: false,
              status: ui.chat.complete,
              trace: [...trace, makeTrace(ui.chat.streamRecovered, "done")],
              sources: persistedAssistant.sources,
              createdAt: persistedAssistant.createdAt,
            });
            return;
          }

          currentStatus = ui.chat.streamRetrying;
          commitStreamState();
          const recovered = await sendChat(text, convId, false, options.thinkingEnabled === true);
          streamedContent = recovered.response || ui.chat.empty;
          trace = trace.map((item) => (item.status === "running" ? { ...item, status: "done" } : item));
          updateAssistant({
            id: recovered.message_id || assistantMessageId,
            content: streamedContent,
            pending: false,
            status: ui.chat.complete,
            trace: [...trace, makeTrace(ui.chat.streamRecovered, "done")],
            sources: recovered.sources,
            createdAt: chatTime(language),
          });
          return;
        } catch (recoveryError) {
          const msg = chatFailureMessage(recoveryError, language);
          showToast({ kind: "error", message: msg, title: language === "en" ? "Chat" : "对话" });
          chatHistory.updateMessage(convId, assistantMessageId, {
            content: formatTemplate(ui.chat.requestFailed, { message: msg }),
            pending: false,
            status: ui.chat.streamRecoveryFailed,
          });
          return;
        }
      }
      const msg = chatFailureMessage(caught, language);
      showToast({ kind: "error", message: msg, title: language === "en" ? "Chat" : "对话" });
      if (convId) {
        chatHistory.updateMessage(convId, assistantMessageId, {
          content: formatTemplate(ui.chat.requestFailed, { message: msg }),
          pending: false,
        });
      }
    } finally {
      if (streamAbortRef.current === abortController) {
        streamAbortRef.current = null;
      }
      isSendingRef.current = false;
      setIsSending(false);
    }
  }

  function handleStopStreaming() {
    streamAbortRef.current?.abort();
  }

  function buildConfigPayload(source: ConfigDraft, changedKeys?: Array<keyof ConfigDraft>) {
    const isSystemManager = auth.can("config:write");
    let allowedPayloadKeys: Set<string> | null = null;
    if (changedKeys?.length) {
      allowedPayloadKeys = new Set<string>();
      for (const key of changedKeys) {
        for (const payloadKey of CONFIG_PAYLOAD_KEYS_BY_DRAFT_KEY[key] ?? []) {
          allowedPayloadKeys.add(payloadKey);
        }
      }
    } else if (!isSystemManager) {
      return {};
    }
    if (!isSystemManager && allowedPayloadKeys) {
      allowedPayloadKeys = new Set([...allowedPayloadKeys].filter((key) => PERSONAL_CONFIG_PAYLOAD_KEYS.has(key)));
      if (allowedPayloadKeys.size === 0) {
        return {};
      }
    }

    const shouldInclude = (key: string) => !allowedPayloadKeys || allowedPayloadKeys.has(key);
    const mcpServers = shouldInclude("mcp_servers")
      ? parseJsonObject(source.mcp_servers_text || "{}", "MCP Servers JSON") as Record<string, Record<string, unknown>>
      : {};
    const isCodexOAuth = source.llm_provider === "openai_responses" && source.llm_auth_mode === "codex";
    const payload: Record<string, unknown> = {
      llm_provider: isCodexOAuth ? "openai_responses" : "openai_compatible",
      llm_auth_mode: isCodexOAuth ? "codex" : "api_key",
      llm_api_base: source.llm_api_base,
      llm_model: source.llm_model,
      llm_codex_auth_file: source.llm_codex_auth_file ?? "",
      llm_codex_api_base: source.llm_codex_api_base ?? "https://chatgpt.com/backend-api/codex",
      llm_codex_model: source.llm_codex_model ?? "gpt-5.2-codex",
      llm_temperature: Number(source.llm_temperature) || 0,
      llm_max_output_tokens: Math.max(0, Math.floor(Number(source.llm_max_output_tokens) || 0)),
      llm_reasoning_effort: source.llm_reasoning_effort || "medium",
      llm_tool_choice: source.llm_tool_choice || "auto",
      embedding_auth_mode: source.embedding_auth_mode ?? "api_key",
      embedding_api_base: source.embedding_api_base,
      embedding_model: source.embedding_model,
      embedding_provider: source.embedding_provider,
      embedding_codex_auth_file: source.embedding_codex_auth_file ?? "",
      embedding_codex_api_base: source.embedding_codex_api_base ?? "https://chatgpt.com/backend-api/codex",
      embedding_codex_model: source.embedding_codex_model ?? "text-embedding-3-small",
      workspace_dir: source.workspace_dir,
      app_language: source.app_language,
      auth_max_devices_per_user: Number(source.auth_max_devices_per_user) || 5,
      agent_max_steps: Number(source.agent_max_steps),
      agent_max_context_tokens: Number(source.agent_max_context_tokens),
      agent_max_context_turns: Number(source.agent_max_context_turns),
      agent_tool_allowlist: source.agent_tool_allowlist,
      agent_allow_all_mcp_tools: source.agent_allow_all_mcp_tools,
      multi_agent_enabled: source.multi_agent_enabled,
      multi_agent_max_parallel_agents: Number(source.multi_agent_max_parallel_agents),
      multi_agent_default_max_steps: Number(source.multi_agent_default_max_steps),
      multi_agent_max_depth: Number(source.multi_agent_max_depth),
      multi_agent_dangerous_tools: source.multi_agent_dangerous_tools,
      multi_agent_roles: source.multi_agent_roles,
      knowledge_enabled: source.knowledge_enabled,
      memory_enabled: source.memory_enabled,
      memory_auto_curate_enabled: source.memory_auto_curate_enabled,
      memory_curator_min_importance: Number(source.memory_curator_min_importance),
      memory_curator_min_confidence: Number(source.memory_curator_min_confidence),
      scheduler_enabled: source.scheduler_enabled,
      tracing_enabled: source.tracing_enabled,
      product_analytics_enabled: source.product_analytics_enabled,
      telegram_enabled: source.telegram_enabled,
      telegram_chat_id: source.telegram_chat_id ?? "",
      telegram_api_base: source.telegram_api_base ?? "https://api.telegram.org",
      telegram_parse_mode: source.telegram_parse_mode ?? "",
      debug: source.debug,
      system_prompt: source.system_prompt,
      mcp_servers: mcpServers,
      mcp_tool_timeout_seconds: Number(source.mcp_tool_timeout_seconds) || 60,
      longbridge_http_url: source.longbridge_http_url ?? "",
      longbridge_quote_ws_url: source.longbridge_quote_ws_url ?? "",
      search_api_url: source.search_api_url ?? "https://api.bocha.cn/v1/web-search",
    };

    if (source.llm_api_key.trim()) {
      payload.llm_api_key = source.llm_api_key.trim();
    }
    if (source.embedding_api_key.trim()) {
      payload.embedding_api_key = source.embedding_api_key.trim();
    }
    if (source.telegram_bot_token.trim()) {
      payload.telegram_bot_token = source.telegram_bot_token.trim();
    }
    if (source.longbridge_app_key.trim()) {
      payload.longbridge_app_key = source.longbridge_app_key.trim();
    }
    if (source.longbridge_app_secret.trim()) {
      payload.longbridge_app_secret = source.longbridge_app_secret.trim();
    }
    if (source.longbridge_access_token.trim()) {
      payload.longbridge_access_token = source.longbridge_access_token.trim();
    }
    if (source.guardian_api_key.trim()) {
      payload.guardian_api_key = source.guardian_api_key.trim();
    }
    if (source.search_api_key.trim()) {
      payload.search_api_key = source.search_api_key.trim();
    }
    return Object.fromEntries(
      Object.entries(payload).filter(([key]) => shouldInclude(key)),
    );
  }

  function showConfigToast(kind: ConfigToast["kind"], message: string) {
    if (configToastTimerRef.current) {
      window.clearTimeout(configToastTimerRef.current);
    }
    if (configToastExitTimerRef.current) {
      window.clearTimeout(configToastExitTimerRef.current);
      configToastExitTimerRef.current = null;
    }
    setConfigToast({ id: Date.now(), kind, message, state: "open" });
    configToastTimerRef.current = window.setTimeout(() => {
      dismissConfigToast();
    }, kind === "success" ? 2200 : 4600);
  }

  function dismissConfigToast() {
    if (configToastTimerRef.current) {
      window.clearTimeout(configToastTimerRef.current);
      configToastTimerRef.current = null;
    }
    setConfigToast((current) => current ? { ...current, state: "closing" } : current);
    if (configToastExitTimerRef.current) {
      window.clearTimeout(configToastExitTimerRef.current);
    }
    configToastExitTimerRef.current = window.setTimeout(() => {
      setConfigToast(null);
      configToastExitTimerRef.current = null;
    }, 180);
  }

  async function saveDraftConfig(source: ConfigDraft, patch?: Partial<ConfigDraft>) {
    setConfigState("saving");
    try {
      const changedKeys = patch ? Object.keys(patch) as Array<keyof ConfigDraft> : undefined;
      const payload = buildConfigPayload(source, changedKeys);
      if (Object.keys(payload).length === 0) {
        setConfigState("idle");
        return;
      }

      const next = await saveConfig(payload);
      setConfig(next);
      setDraft(toDraft(next));
      configDirtyPatchRef.current = {};
      setConfigState("saved");
      showConfigToast("success", ui.config.saved);
      window.setTimeout(() => setConfigState("idle"), 1400);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : ui.config.saveFailed;
      setConfigState("error");
      showConfigToast("error", message);
    }
  }

  async function handleSaveConfig() {
    const source = draft;
    if (!source) return;
    const pendingPatch = configDirtyPatchRef.current;
    const patch = Object.keys(pendingPatch).length ? pendingPatch : undefined;
    await saveDraftConfig(source, patch);
  }

  function patchDraft(patch: Partial<ConfigDraft>) {
    configDirtyPatchRef.current = { ...configDirtyPatchRef.current, ...patch };
    setDraft((current) => {
      if (!current) return current;
      return { ...current, ...patch };
    });
  }

  function applySavedConfig(next: AppConfig) {
    setConfig(next);
    setDraft(toDraft(next));
    setConfigState("saved");
  }

  function handleNavigate(nextPage: Page, configTab?: ConfigTab) {
    if (!canPage(nextPage)) {
      const targetLabel = getNavigationGroups(language)
        .flatMap((group) => group.items)
        .find((item) => item.id === nextPage)?.label ?? nextPage;
      showToast({
        kind: "info",
        title: ui.shell.pageAccessRestrictedTitle,
        message: formatTemplate(ui.shell.pageAccessRestrictedBody, { page: targetLabel }),
      });
      return false;
    }
    if (config?.product_analytics_enabled && nextPage !== activePage) {
      void trackProductEvent("page_navigated", { from: activePage, to: nextPage }).catch(() => undefined);
    }
    if (nextPage === "fundamentals") {
      setSelectedSymbol("");
    }
    if (nextPage === "config") {
      setConfigInitialTab(configTab ?? "model");
    }
    setPage(nextPage);
    return true;
  }

  function openConfig(tab: ConfigTab = "model") {
    handleNavigate("config", tab);
  }

  function openCompany(symbol: string, tab: CompanyTab = "overview") {
    if (!canPage("company")) return false;
    setCompanyRoute({ symbol: symbol.trim().toUpperCase(), tab });
    setSelectedSymbol(symbol.trim().toUpperCase());
    setPage("company");
    return true;
  }

  const dashboardChatPanel = (
    <ChatPage
      chatScrollRef={chatScrollRef}
      confirmAction={confirmDialog.confirm}
      displayName={auth.user?.display_name || auth.user?.username || ""}
      embedded
      endRef={endRef}
      expanded={isMobileViewport ? dashboardChatFullscreen : dashboardChatExpanded}
      handleChatScroll={handleChatScroll}
      handleSend={handleSend}
      handleStopStreaming={handleStopStreaming}
      isSending={isSending}
      language={language}
      messages={messages}
      mobileNavVisible={false}
      onToggleExpanded={() => {
        if (isMobileViewport) {
          setDashboardChatFullscreen((current) => !current);
        } else {
          setDashboardChatExpanded((current) => !current);
        }
      }}
      prompt={prompt}
      quickPrompts={quickPrompts}
      chatHistory={chatHistory}
      setPrompt={setPrompt}
    />
  );

  return (
    <div className={cn("console-shell h-[100dvh] overflow-hidden", activePage === "watchlist" && "console-shell-watchlist")}>
      <a className="skip-link" href="#main-content">{language === "en" ? "Skip to content" : "跳到主要内容"}</a>
      {confirmDialog.dialog}
      <ReauthDialog />
      <ConfigSaveToast key={configToast?.id ?? "empty"} toast={configToast} onClose={dismissConfigToast} />
      <div className="app-frame flex h-full min-h-0 w-full flex-col gap-0 p-0">
        <button
          aria-hidden={isMobileHeaderVisible}
          aria-label={language === "en" ? "Show top bar" : "显示顶部栏"}
          className={cn("app-top-edge-trigger lg:hidden", isMobileHeaderVisible && "app-edge-trigger-hidden")}
          disabled={isMobileHeaderVisible}
          onClick={() => setIsMobileHeaderVisible(true)}
          tabIndex={isMobileHeaderVisible ? -1 : 0}
          type="button"
        >
          <span className="app-edge-grabber" />
        </button>
        <Header
          isMobileVisible={isMobileHeaderVisible}
          language={language}
          onHideMobileChrome={() => {
            setIsMobileHeaderVisible(false);
          }}
          onHome={firstAllowedPage ? () => handleNavigate(canPage("overview") ? "overview" : firstAllowedPage) : undefined}
          onLogout={auth.logout}
          onUpdateProfile={auth.updateProfile}
          navigationGroups={navigationGroups}
          page={activePage}
          setPage={handleNavigate}
          onThemeChange={setTheme}
          resolvedTheme={resolvedTheme}
          theme={theme}
          user={auth.user}
        />

        <div
          className="app-main-grid flex min-h-0 flex-1"
        >
          <main
            aria-label={activeNavItem?.label ?? ui.shell.noPageAccessTitle}
            className={cn(
              "app-main-stage flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-3 focus-visible:outline-none sm:p-4 lg:overflow-y-auto lg:p-5",
              isMobileHeaderVisible && "mobile-header-spacer",
              activePage === "overview" && isMobileViewport && auth.can("chat:read") && "mobile-chat-dock-space",
            )}
            id="main-content"
            ref={mainContentRef}
            tabIndex={-1}
          >
            <Suspense fallback={<PageFallback />}>
              {!activePage ? (
                <section className="grid min-h-[min(32rem,70dvh)] place-items-center" role="status">
                  <div className="apple-material-thick max-w-md rounded-[1.75rem] border border-border/60 px-7 py-8 text-center shadow-xl">
                    <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
                      <ShieldCheck className="size-5" />
                    </span>
                    <h1 className="mt-4 text-xl font-semibold tracking-[-0.02em] text-foreground">{ui.shell.noPageAccessTitle}</h1>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{ui.shell.noPageAccessBody}</p>
                  </div>
                </section>
              ) : null}
              {activePage === "overview" ? (
                <DashboardPage
                  canPermission={auth.can}
                  chatExpanded={dashboardChatExpanded}
                  chatPanel={dashboardChatPanel}
                  isMobileViewport={isMobileViewport}
                  language={language}
                  onOpenChart={(symbol) => {
                    openCompany(symbol, "chart");
                  }}
                  onOpenMarketConfig={() => openConfig("market")}
                  onOpenPortfolio={() => handleNavigate("portfolio")}
                  onOpenWatchlist={() => handleNavigate("watchlist")}
                  refreshInterval={marketConfig.refresh_interval}
                />
              ) : null}

            {activePage === "tracing" ? (
              <TracingPage
                activeSessionId={activeConvId}
                onOpenConfig={() => openConfig()}
                tracingEnabled={Boolean(config?.tracing_enabled)}
              />
            ) : null}

            {activePage === "company" ? (
              <CompanyWorkspacePage
                confirmAction={confirmDialog.confirm}
                language={language}
                onAskAgent={(researchPrompt) => {
                  setPrompt(researchPrompt);
                  handleNavigate("overview");
                }}
                onNavigateTab={(tab) => setCompanyRoute((current) => ({ ...current, tab }))}
                onOpenPortfolio={() => handleNavigate("portfolio")}
                symbol={companyRoute.symbol}
                tab={companyRoute.tab}
                telegramEnabled={Boolean(config?.telegram_enabled)}
              />
            ) : null}

            {activePage === "watchlist" ? (
              <WatchlistPage
                language={language}
                selectedSymbol={selectedSymbol}
                onSelectedSymbolChange={setSelectedSymbol}
                onOpenFinancials={(symbol) => {
                  openCompany(symbol, "financials");
                }}
              />
            ) : null}

            {activePage === "news" ? <NewsPage initialSymbol={selectedSymbol || undefined} language={language} /> : null}

            {activePage === "portfolio" ? (
              <PortfolioPage
                confirmAction={confirmDialog.confirm}
                language={language}
                refreshInterval={marketConfig.refresh_interval}
                onAnalyzeStock={(symbol) => {
                  if (handleNavigate("overview")) {
                    setPrompt(formatTemplate(i18n[language].portfolio.analysisPrompt, { symbol }));
                  }
                }}
                onOpenFinancials={(symbol) => {
                  openCompany(symbol, "financials");
                }}
              />
            ) : null}

            {activePage === "labs" ? <InvestmentLabsPage language={language} /> : null}

            {activePage === "fundamentals" ? <FinancialReportsPage language={language} initialSymbol={selectedSymbol || undefined} /> : null}

            {activePage === "skills" ? <SkillsPage confirmAction={confirmDialog.confirm} language={language} /> : null}

            {activePage === "subagents" ? (
              <SubAgentsPage
                config={config}
                confirmAction={confirmDialog.confirm}
                language={language}
                onSaved={applySavedConfig}
                onOpenConfig={() => openConfig()}
              />
            ) : null}

            {activePage === "memory" ? <MemoryPage confirmAction={confirmDialog.confirm} language={language} /> : null}

            {activePage === "knowledge" ? <KnowledgePage language={language} /> : null}

            {activePage === "scheduler" ? <AlertsPage confirmAction={confirmDialog.confirm} language={language} telegramEnabled={Boolean(config?.telegram_enabled)} /> : null}

            {activePage === "mcp" ? <MCPPage language={language} /> : null}

            {activePage === "security" ? <SecurityPage confirmAction={confirmDialog.confirm} language={language} /> : null}

            {activePage === "users" ? <UsersPage language={language} /> : null}

              {activePage === "config" ? (
                <ConfigPage
                  canManageSystem={auth.can("config:write")}
                  canReadMarket={auth.can("market:read")}
                  canWriteMarket={auth.can("market:write")}
                  config={config}
                  configState={configState}
                  draft={draft}
                  enabledCount={enabledCount}
                  handleSaveConfig={handleSaveConfig}
                  initialTab={configInitialTab}
                  language={language}
                  onMarketConfigSaved={setMarketConfig}
                  patchDraft={patchDraft}
                  setDraft={(next) => {
                    configDirtyPatchRef.current = {};
                    setDraft(next);
                  }}
                />
              ) : null}
            </Suspense>
          </main>
        </div>
        {activePage === "overview" && isMobileViewport && auth.can("chat:read") ? (
          <DashboardMobileChatDock
            chatPanel={dashboardChatPanel}
            fullscreen={dashboardChatFullscreen}
            isOpen={dashboardChatDrawerOpen}
            language={language}
            onOpenChange={setDashboardChatDrawerOpen}
            onFullscreenChange={setDashboardChatFullscreen}
          />
        ) : null}
      </div>
    </div>
  );
}

function DashboardMobileChatDock({
  chatPanel,
  fullscreen,
  isOpen,
  language,
  onOpenChange,
  onFullscreenChange,
}: {
  chatPanel: ReactNode;
  fullscreen: boolean;
  isOpen: boolean;
  language: AppLanguage;
  onOpenChange: (open: boolean) => void;
  onFullscreenChange: (fullscreen: boolean) => void;
}) {
  const mobileChatLabel = language === "en" ? "Search or ask" : "搜索或提问";
  const closeMobileChatLabel = language === "en" ? "Close AI drawer" : "关闭 AI 抽屉";
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  function finishClose() {
    onFullscreenChange(false);
    onOpenChange(false);
  }
  const { dragHandleProps, layerRef, panelRef, present: drawerPresent, requestClose } = useFluidSheet<HTMLElement>({
    axis: "y",
    onDismiss: finishClose,
    open: isOpen,
  });
  useDialogFocus(isOpen, panelRef, requestClose, closeButtonRef);

  return (
    <>
      {!drawerPresent ? (
        <div className="dashboard-chat-searchbar fixed inset-x-0 bottom-0 z-[920] px-3 pb-[calc(0.85rem+env(safe-area-inset-bottom))] pt-3 lg:hidden">
          <button
            aria-label={mobileChatLabel}
            className="flex h-14 w-full items-center gap-3 rounded-[2rem] border border-border/75 bg-card px-4 text-left text-base font-semibold text-muted-foreground shadow-[0_-10px_30px_hsl(var(--background)_/_0.75),0_14px_34px_hsl(var(--foreground)_/_0.13)] transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            onClick={() => onOpenChange(true)}
            title={mobileChatLabel}
            type="button"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground">
              <Search className="size-4" />
            </span>
            <span className="min-w-0 flex-1 truncate">{mobileChatLabel}</span>
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted/55 text-muted-foreground">
              <MessageSquareText className="size-4" />
            </span>
          </button>
        </div>
      ) : null}
      {drawerPresent ? (
        <div
          className={cn("dashboard-chat-drawer-layer fluid-sheet-layer fixed inset-0 lg:hidden", fullscreen ? "z-[980]" : "z-[950]")}
          ref={layerRef}
        >
          <div
            aria-hidden="true"
            className="fluid-sheet-backdrop absolute inset-0"
            onClick={requestClose}
          />
          <aside
            aria-label={mobileChatLabel}
            aria-modal="true"
            className={cn(
              "dashboard-chat-drawer fluid-sheet-panel apple-material-thick absolute inset-x-0 bottom-0 flex flex-col overflow-hidden border border-border/60 shadow-2xl",
              fullscreen
                ? "h-[100dvh] rounded-none border-x-0 border-b-0 pt-[calc(env(safe-area-inset-top))]"
                : "h-[min(86dvh,46rem)] rounded-t-[1.5rem]",
            )}
            ref={panelRef}
            role="dialog"
            tabIndex={-1}
          >
            <div className="sheet-header flex shrink-0 items-center justify-between px-3 py-2">
              <div
                aria-hidden="true"
                className="sheet-drag-handle flex h-8 flex-1 touch-none items-center justify-center"
                {...dragHandleProps}
              >
                <span className="h-1 w-10 rounded-full bg-muted-foreground/35" />
              </div>
              <Button
                aria-label={closeMobileChatLabel}
                className="ml-2 rounded-full"
                onClick={requestClose}
                ref={closeButtonRef}
                size="icon"
                title={closeMobileChatLabel}
                type="button"
                variant="ghost"
              >
                <X className="size-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <Suspense fallback={<PageFallback />}>{chatPanel}</Suspense>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}

function Header({
  isMobileVisible,
  language,
  navigationGroups,
  onHideMobileChrome,
  onHome,
  onLogout,
  onUpdateProfile,
  page,
  setPage,
  onThemeChange,
  resolvedTheme,
  theme,
  user,
}: {
  isMobileVisible: boolean;
  language: AppLanguage;
  navigationGroups: AppNavGroup[];
  onHideMobileChrome: () => void;
  onHome?: () => void;
  onLogout: () => void;
  onUpdateProfile: (payload: { display_name?: string; avatar_base64?: string }) => Promise<AuthUser>;
  page: Page | null;
  setPage: (page: Page) => void;
  onThemeChange: (theme: Theme) => void;
  resolvedTheme: EffectiveTheme;
  theme: Theme;
  user: AuthUser | null;
}) {
  const themeLabels = language === "en"
    ? { system: "System", dark: "Dark", light: "Light", current: "Theme", switchTo: "Switch to", darkNow: "dark", lightNow: "light" }
    : { system: "系统", dark: "黑暗", light: "亮色", current: "主题切换，当前", switchTo: "切换到", darkNow: "黑暗", lightNow: "亮色" };
  const themeOptions: Array<{ value: Theme; label: string; icon: ReactNode }> = [
    { value: "system", label: themeLabels.system, icon: <Monitor /> },
    { value: "dark", label: themeLabels.dark, icon: <Moon /> },
    { value: "light", label: themeLabels.light, icon: <Sun /> },
  ];
  const hideMobileChromeLabel = language === "en" ? "Hide header" : "隐藏顶部栏";
  const navigationLabel = language === "en" ? "Open navigation" : "打开导航";
  const closeNavigationLabel = language === "en" ? "Close navigation" : "关闭导航";
  const currentItem = navigationGroups.flatMap((group) => group.items).find((item) => item.id === page);
  const nextTheme: Theme = theme === "system" ? "dark" : theme === "dark" ? "light" : "system";
  const activeThemeIcon = theme === "system" ? <Monitor /> : theme === "dark" ? <Moon /> : <Sun />;
  const nextThemeLabel = themeOptions.find((option) => option.value === nextTheme)?.label ?? nextTheme;

  return (
    <header
      className={cn(
        "panel app-header flex min-h-14 shrink-0 items-center justify-between gap-3 rounded-none border-x-0 border-t-0 px-2.5 py-2 shadow-none sm:px-4 lg:px-5",
        !isMobileVisible && "mobile-header-hidden",
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <AppNavigationPopover
          closeLabel={closeNavigationLabel}
          currentPage={page}
          groups={navigationGroups}
          label={navigationLabel}
          onNavigate={setPage}
        />
        <button
          aria-label={i18n[language].shell.goToStartPage}
          className="apple-pressable flex shrink-0 items-center gap-2 rounded-xl text-left"
          disabled={!onHome}
          onClick={onHome}
          type="button"
        >
          <span className="app-mark grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Sparkles className="size-4" />
          </span>
          <span className="hidden min-w-0 sm:block">
            <span className="block truncate text-sm font-semibold tracking-[-0.012em] text-foreground">Stocks Assistant</span>
          </span>
        </button>
        <span aria-hidden="true" className="hidden h-6 w-px bg-border/70 sm:block" />
        <div className="min-w-0" aria-live="polite">
          <p className="truncate text-sm font-semibold tracking-[-0.012em] text-foreground">{currentItem?.label}</p>
          <p className="hidden truncate text-[0.6875rem] leading-4 text-muted-foreground md:block">{currentItem?.hint}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          aria-label={hideMobileChromeLabel}
          className="rounded-full lg:hidden"
          onClick={onHideMobileChrome}
          size="icon"
          title={hideMobileChromeLabel}
          type="button"
          variant="outline"
        >
          <ChevronUp className="size-4" />
        </Button>
        <Button
          aria-label={`${themeLabels.switchTo} ${nextThemeLabel}`}
          className="rounded-full sm:hidden"
          onClick={() => onThemeChange(nextTheme)}
          size="icon"
          title={`${themeLabels.switchTo} ${nextThemeLabel}`}
          type="button"
          variant="outline"
        >
          {activeThemeIcon}
        </Button>
        <div
          aria-label={`${themeLabels.current}${theme === "system" ? `${themeLabels.system} (${resolvedTheme === "dark" ? themeLabels.darkNow : themeLabels.lightNow})` : theme === "dark" ? themeLabels.dark : themeLabels.light}`}
          className="theme-toggle hidden h-9 shrink-0 items-center rounded-full border border-input bg-[var(--control-bg)] p-0.5 sm:inline-flex"
          role="group"
        >
          {themeOptions.map((option) => {
            const active = theme === option.value;
            const title =
              option.value === "system"
                ? `${themeLabels.system} (${resolvedTheme === "dark" ? themeLabels.darkNow : themeLabels.lightNow})`
                : option.label;
            return (
              <button
                aria-label={`${themeLabels.switchTo} ${title}`}
                aria-pressed={active}
                className={cn(
                  "apple-pressable grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground [&_svg]:size-3.5",
                  active && "bg-[var(--control-selected-bg)] text-foreground shadow-sm",
                )}
                key={option.value}
                onClick={() => onThemeChange(option.value)}
                title={title}
                type="button"
              >
                {option.icon}
              </button>
            );
          })}
        </div>
        <UserAvatarMenu
          language={language}
          onLogout={onLogout}
          onUpdateProfile={onUpdateProfile}
          user={user}
        />
      </div>
    </header>
  );
}

function userInitials(user: AuthUser | null) {
  const source = (user?.display_name || user?.username || "?").trim();
  if (!source) return "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

function formatProfileTime(value: string | null | undefined, language: AppLanguage) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(localeFor(language), { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function readAvatarDataUrl(file: File, language: AppLanguage): Promise<string> {
  const allowed = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
  if (!allowed.has(file.type)) {
    return Promise.reject(new Error(language === "en" ? "Use PNG, JPEG, WebP or GIF" : "请使用 PNG、JPEG、WebP 或 GIF 图片"));
  }
  if (file.size > 512 * 1024) {
    return Promise.reject(new Error(language === "en" ? "Avatar must be 512KB or smaller" : "头像需小于 512KB"));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error(language === "en" ? "Failed to read image" : "图片读取失败"));
    };
    reader.onerror = () => reject(new Error(language === "en" ? "Failed to read image" : "图片读取失败"));
    reader.readAsDataURL(file);
  });
}

function AvatarVisual({ user, size = "md" }: { user: AuthUser | null; size?: "md" | "lg" }) {
  const className = size === "lg" ? "size-11 text-sm" : "size-8 text-xs";
  if (user?.avatar_base64) {
    return (
      <img
        alt={user.display_name || user.username}
        className={cn(className, "rounded-full border border-border/70 object-cover")}
        src={user.avatar_base64}
      />
    );
  }
  return (
    <span className={cn(className, "grid shrink-0 place-items-center rounded-full border border-primary/35 bg-primary/10 font-semibold text-primary")}>
      {userInitials(user)}
    </span>
  );
}

function UserAvatarMenu({
  language,
  onLogout,
  onUpdateProfile,
  user,
}: {
  language: AppLanguage;
  onLogout: () => void;
  onUpdateProfile: (payload: { display_name?: string; avatar_base64?: string }) => Promise<AuthUser>;
  user: AuthUser | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const copy = language === "en"
    ? {
      account: "Account",
      upload: "Upload avatar",
      remove: "Remove avatar",
      uploading: "Uploading...",
      roles: "Roles",
      lastLogin: "Last login",
      created: "Created",
      logout: "Log out",
      permissions: "permissions",
      noRoles: "No roles",
    }
    : {
      account: "账号",
      upload: "上传头像",
      remove: "移除头像",
      uploading: "上传中...",
      roles: "角色",
      lastLogin: "最近登录",
      created: "创建时间",
      logout: "退出登录",
      permissions: "项权限",
      noRoles: "暂无角色",
    };
  useEffect(() => {
    if (!isOpen) return undefined;
    function handlePointerDown(event: PointerEvent) {
      const path = event.composedPath();
      if (!menuRef.current || !path.includes(menuRef.current)) setIsOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setIsOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  async function handleAvatarFile(file: File | undefined) {
    if (!file) return;
    setAvatarError("");
    setIsUploading(true);
    try {
      const avatar_base64 = await readAvatarDataUrl(file, language);
      await onUpdateProfile({ avatar_base64 });
    } catch (caught) {
      setAvatarError(caught instanceof Error ? caught.message : (language === "en" ? "Upload failed" : "上传失败"));
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleRemoveAvatar() {
    setAvatarError("");
    setIsUploading(true);
    try {
      await onUpdateProfile({ avatar_base64: "" });
    } catch (caught) {
      setAvatarError(caught instanceof Error ? caught.message : (language === "en" ? "Failed to remove avatar" : "移除头像失败"));
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={language === "en" ? "Open account menu" : "打开账号菜单"}
        className="apple-pressable flex h-10 items-center gap-1 rounded-full border border-input bg-[var(--control-bg)] p-0.5 pr-2 shadow-[var(--control-shadow)] transition-[background-color,border-color,transform] hover:bg-[var(--control-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setIsOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        <AvatarVisual user={user} />
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </button>

      {isOpen ? (
        <div
          className="account-menu-popover absolute right-0 top-[calc(100%+0.45rem)] z-[1000] max-h-[min(680px,calc(100dvh-4rem))] w-[320px] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border border-border/90 p-2 text-popover-foreground shadow-2xl ring-1 ring-border/40"
          aria-label={copy.account}
          onPointerDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
          role="dialog"
        >
          <div className="flex min-w-0 items-center gap-2 border-b border-border/65 pb-2">
            <AvatarVisual size="lg" user={user} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{user?.display_name || user?.username || copy.account}</p>
              <p className="truncate text-xs text-muted-foreground">@{user?.username || "-"}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {(user?.permissions?.length ?? 0).toLocaleString(localeFor(language))} {copy.permissions}
              </p>
            </div>
          </div>

          <div className="space-y-2 py-2">
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              <div className="rounded-md bg-muted/25 px-2 py-1.5">
                <p className="text-muted-foreground">{copy.lastLogin}</p>
                <p className="truncate font-semibold">{formatProfileTime(user?.last_login_at, language)}</p>
              </div>
              <div className="rounded-md bg-muted/25 px-2 py-1.5">
                <p className="text-muted-foreground">{copy.created}</p>
                <p className="truncate font-semibold">{formatProfileTime(user?.created_at, language)}</p>
              </div>
            </div>
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{copy.roles}</p>
              <div className="flex flex-wrap gap-1">
                {user?.roles?.length ? user.roles.map((role) => (
                  <Badge className="border-transparent bg-muted/45 shadow-none" key={role} variant="outline">{role}</Badge>
                )) : <span className="text-xs text-muted-foreground">{copy.noRoles}</span>}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <input
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(event) => void handleAvatarFile(event.target.files?.[0])}
                ref={inputRef}
                type="file"
              />
              <Button className="h-7 px-2 text-xs" disabled={isUploading} onClick={() => inputRef.current?.click()} size="sm" type="button" variant="outline">
                {isUploading ? <Loader2 className="animate-spin" /> : <Upload />}
                {isUploading ? copy.uploading : copy.upload}
              </Button>
              {user?.avatar_base64 ? (
                <Button className="h-7 px-2 text-xs" disabled={isUploading} onClick={() => void handleRemoveAvatar()} size="sm" type="button" variant="ghost">
                  <X className="size-4" />
                  {copy.remove}
                </Button>
              ) : null}
            </div>
            {avatarError ? <p className="rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive">{avatarError}</p> : null}
          </div>

          <div className="border-t border-border/65 pt-2">
            <Button className="h-8 w-full justify-start text-destructive hover:text-destructive" onClick={onLogout} size="sm" type="button" variant="ghost">
              <LogOut />
              {copy.logout}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PageFallback() {
  return (
    <div className="grid h-full min-h-0 flex-1 place-items-center">
      <div className="flex items-center gap-2 rounded-md border border-border/80 bg-background/70 px-3 py-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin text-primary" />
        Loading...
      </div>
    </div>
  );
}

export default App;
