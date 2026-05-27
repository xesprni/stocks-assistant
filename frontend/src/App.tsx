import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, TouchEvent } from "react";
import {
  BarChart2,
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
  FileText,
  Home,
  Loader2,
  LogOut,
  Menu,
  MessageSquareText,
  Monitor,
  Moon,
  Newspaper,
  Plug,
  Settings2,
  ShieldCheck,
  Sparkles,
  Star,
  Sun,
  TrendingUp,
  UserCog,
  X,
  Zap,
} from "lucide-react";

import { ReauthDialog } from "@/components/ReauthDialog";
import { useConfirmDialog } from "@/components/common/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  checkHealth,
  getChatSession,
  getMarketConfig,
  loadConfig,
  sendChat,
  saveConfig,
  streamChat,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { toDraft } from "@/lib/config";
import { parseJsonObject } from "@/lib/json";
import { formatTemplate, i18n, localeFor, normalizeLanguage } from "@/lib/i18n";
import { CHAT_AUTO_SCROLL_THRESHOLD, useConversations } from "@/hooks/useConversations";
import type { AppLanguage } from "@/lib/i18n";
import type { EffectiveTheme, Page, Theme } from "@/types/ui";
import type {
  AppConfig,
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
const FinancialReportsPage = lazy(() => import("@/components/FinancialReportsPage").then((module) => ({ default: module.FinancialReportsPage })));
const KnowledgePage = lazy(() => import("@/pages/KnowledgePage").then((module) => ({ default: module.KnowledgePage })));
const MarketConfigPage = lazy(() => import("@/components/MarketConfigPage").then((module) => ({ default: module.MarketConfigPage })));
const MarketDashboard = lazy(() => import("@/components/MarketDashboard").then((module) => ({ default: module.MarketDashboard })));
const MCPPage = lazy(() => import("@/pages/MCPPage").then((module) => ({ default: module.MCPPage })));
const MemoryPage = lazy(() => import("@/pages/MemoryPage").then((module) => ({ default: module.MemoryPage })));
const NewsPage = lazy(() => import("@/pages/NewsPage").then((module) => ({ default: module.NewsPage })));
const PortfolioPage = lazy(() => import("@/components/PortfolioPage").then((module) => ({ default: module.PortfolioPage })));
const SchedulerPage = lazy(() => import("@/pages/SchedulerPage").then((module) => ({ default: module.SchedulerPage })));
const SecurityPage = lazy(() => import("@/pages/SecurityPage").then((module) => ({ default: module.SecurityPage })));
const SkillsPage = lazy(() => import("@/pages/SkillsPage").then((module) => ({ default: module.SkillsPage })));
const SubAgentsPage = lazy(() => import("@/pages/SubAgentsPage").then((module) => ({ default: module.SubAgentsPage })));
const TechnicalAnalysis = lazy(() => import("@/components/TechnicalAnalysis"));
const TracingPage = lazy(() => import("@/pages/TracingPage").then((module) => ({ default: module.TracingPage })));
const UsersPage = lazy(() => import("@/pages/UsersPage").then((module) => ({ default: module.UsersPage })));
const WatchlistPage = lazy(() => import("@/pages/WatchlistPage").then((module) => ({ default: module.WatchlistPage })));

type NavItem = { id: Page; label: string; icon: ReactNode; hint: string };
type NavGroup = { id: string; label: string; items: NavItem[] };
type ConfigToast = { id: number; kind: "success" | "error"; message: string; state: "open" | "closing" };
type TouchPoint = { x: number; y: number };

const MOBILE_PRIMARY_PAGES: Page[] = ["overview", "chat", "portfolio"];
const MOBILE_GESTURE_DELTA = 28;
const MOBILE_HEADER_VISIBLE_KEY = "stocks-assistant-mobile-header-visible";
const MOBILE_NAV_VISIBLE_KEY = "stocks-assistant-mobile-nav-visible";
const LEGACY_MOBILE_CHROME_HIDDEN_KEY = "stocks-assistant-mobile-chrome-hidden";

const DEFAULT_PAGE_PERMISSION: Partial<Record<Page, string>> = {
  overview: "config:read",
  chat: "chat:read",
  tracing: "tracing:read",
  security: "config:read",
  market: "market:read",
  market_config: "market:write",
  watchlist: "watchlist:read",
  portfolio: "portfolio:read",
  news: "market:read",
  config: "config:read",
  chart: "market:read",
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
  chat: "/chat",
  tracing: "/tracing",
  security: "/security",
  market: "/market",
  market_config: "/market/config",
  watchlist: "/watchlist",
  portfolio: "/portfolio",
  news: "/news",
  config: "/settings",
  chart: "/chart",
  fundamentals: "/fundamentals",
  skills: "/skills",
  subagents: "/subagents",
  mcp: "/mcp",
  memory: "/memory",
  knowledge: "/knowledge",
  scheduler: "/scheduler",
  users: "/users",
};

const PATH_PAGE = new Map<string, Page>([
  ...Object.entries(PAGE_PATH).map(([page, path]) => [path, page as Page] as const),
  ["/", "overview"],
  ["/config", "config"],
  ["/overview", "overview"],
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
  "debug",
]);

function getActiveLlmModel(config: AppConfig | null, fallback: string): string {
  if (!config) return fallback;
  const isCodexOAuth = config.llm_provider === "openai_responses" && config.llm_auth_mode === "codex";
  return (isCodexOAuth ? config.llm_codex_model : config.llm_model) || fallback;
}

function navItem(language: AppLanguage, id: Page, icon: ReactNode): NavItem {
  const [label, hint] = i18n[language].nav[id as keyof typeof i18n.zh.nav];
  return { id, label, icon, hint };
}

function getPinnedNavItems(language: AppLanguage): NavItem[] {
  return [
    navItem(language, "overview", <Home />),
    navItem(language, "chat", <MessageSquareText />),
    navItem(language, "market", <BarChart2 />),
    navItem(language, "watchlist", <Star />),
    navItem(language, "portfolio", <BriefcaseBusiness />),
    navItem(language, "news", <Newspaper />),
  ];
}

function getNavGroups(language: AppLanguage): NavGroup[] {
  const groups = i18n[language].groups;
  return [
  {
    id: "agents",
    label: groups.agents,
    items: [
      navItem(language, "tracing", <Cpu />),
      navItem(language, "skills", <Zap />),
      navItem(language, "subagents", <Bot />),
      navItem(language, "mcp", <Plug />),
    ],
  },
  {
    id: "market-tools",
    label: groups.market,
    items: [
      navItem(language, "chart", <TrendingUp />),
      navItem(language, "fundamentals", <FileText />),
    ],
  },
  {
    id: "workspace",
    label: groups.workspace,
    items: [
      navItem(language, "memory", <BrainCircuit />),
      navItem(language, "knowledge", <BookOpen />),
    ],
  },
  {
    id: "automation",
    label: groups.automation,
    items: [
      navItem(language, "scheduler", <Clock />),
    ],
  },
  {
    id: "system",
    label: groups.system,
    items: [
      navItem(language, "security", <ShieldCheck />),
      navItem(language, "users", <UserCog />),
      navItem(language, "config", <Settings2 />),
    ],
  },
  ];
}

function getDesktopMoreGroups(language: AppLanguage): NavGroup[] {
  const groups = i18n[language].groups;
  return [
    {
      id: "analysis",
      label: groups.analysis,
      items: [
        navItem(language, "chart", <TrendingUp />),
        navItem(language, "fundamentals", <FileText />),
        navItem(language, "tracing", <Cpu />),
      ],
    },
    {
      id: "workspace",
      label: groups.workspace,
      items: [
        navItem(language, "memory", <BrainCircuit />),
        navItem(language, "knowledge", <BookOpen />),
        navItem(language, "skills", <Zap />),
        navItem(language, "subagents", <Bot />),
        navItem(language, "mcp", <Plug />),
      ],
    },
    {
      id: "automation",
      label: groups.automation,
      items: [
        navItem(language, "scheduler", <Clock />),
      ],
    },
    {
      id: "system",
      label: groups.system,
      items: [
        navItem(language, "security", <ShieldCheck />),
        navItem(language, "users", <UserCog />),
        navItem(language, "config", <Settings2 />),
      ],
    },
  ];
}

function getNavItems(language: AppLanguage) {
  return [...getPinnedNavItems(language), ...getNavGroups(language).flatMap((group) => group.items)];
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
  return PATH_PAGE.get(normalizeRoutePath(pathname)) ?? "overview";
}

function pathForPage(page: Page) {
  return PAGE_PATH[page] ?? PAGE_PATH.overview;
}

function ConfigSaveToast({ onClose, toast }: { onClose: () => void; toast: ConfigToast | null }) {
  if (!toast) return null;
  const Icon = toast.kind === "success" ? CheckCircle2 : CircleAlert;
  return (
    <div
      className={cn(
        "config-toast",
        "fixed right-4 top-4 z-50 flex w-[min(360px,calc(100vw-2rem))] items-start gap-3 rounded-md border px-3 py-3 text-sm shadow-lg",
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

function touchPointFromEvent<T extends Element>(event: TouchEvent<T>): TouchPoint | null {
  const touch = event.touches[0];
  return touch ? { x: touch.clientX, y: touch.clientY } : null;
}

function verticalGesture(previous: TouchPoint | null, next: TouchPoint | null) {
  if (!previous || !next) return null;
  const deltaX = next.x - previous.x;
  const deltaY = next.y - previous.y;
  if (Math.abs(deltaY) < MOBILE_GESTURE_DELTA || Math.abs(deltaY) < Math.abs(deltaX) * 1.2) return null;
  return deltaY > 0 ? "down" : "up";
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
  const [page, setPage] = useState<Page>(() => pageFromPath(window.location.pathname));
  const [selectedSymbol, setSelectedSymbol] = useState<string>("");
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = window.localStorage.getItem("stocks-assistant-theme");
    return isTheme(stored) ? stored : "system";
  });
  const [systemPreference, setSystemPreference] = useState<EffectiveTheme>(() => systemTheme());
  const [prompt, setPrompt] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [draft, setDraft] = useState<ConfigDraft | null>(null);
  const [health, setHealth] = useState<"checking" | "online" | "offline">("checking");
  const [configState, setConfigState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [configToast, setConfigToast] = useState<ConfigToast | null>(null);
  const [error, setError] = useState("");
  const [marketConfig, setMarketConfig] = useState<MarketDashboardConfig>({ indices: [], refresh_interval: 60 });
  const [isMobileHeaderVisible, setIsMobileHeaderVisible] = useState(() => {
    const stored = window.localStorage.getItem(MOBILE_HEADER_VISIBLE_KEY);
    if (stored !== null) return stored === "true";
    return window.localStorage.getItem(LEGACY_MOBILE_CHROME_HIDDEN_KEY) !== "true";
  });
  const [isMobileNavVisible, setIsMobileNavVisible] = useState(() => {
    const stored = window.localStorage.getItem(MOBILE_NAV_VISIBLE_KEY);
    if (stored !== null) return stored === "true";
    return window.localStorage.getItem(LEGACY_MOBILE_CHROME_HIDDEN_KEY) !== "true";
  });
  const [isMobileMoreOpen, setIsMobileMoreOpen] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollChatRef = useRef(true);
  const mobileHeaderTouchPointRef = useRef<TouchPoint | null>(null);
  const mobileTopEdgeTouchPointRef = useRef<TouchPoint | null>(null);
  const mobileNavTouchPointRef = useRef<TouchPoint | null>(null);
  const mobileBottomEdgeTouchPointRef = useRef<TouchPoint | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const configAutoSaveTimerRef = useRef<number | null>(null);
  const configAutoSaveDraftRef = useRef<ConfigDraft | null>(null);
  const configAutoSavePatchRef = useRef<Partial<ConfigDraft>>({});
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

  useEffect(() => {
    const handlePopState = () => setPage(pageFromPath(window.location.pathname));
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const nextPath = pathForPage(page);
    if (normalizeRoutePath(window.location.pathname) !== nextPath) {
      const method = routeReadyRef.current ? "pushState" : "replaceState";
      window.history[method]({ page }, "", `${nextPath}${window.location.search}${window.location.hash}`);
    }
    routeReadyRef.current = true;
  }, [page]);

  useEffect(() => {
    if (!canPage(page)) {
      setPage(auth.can("chat:read") ? "chat" : "overview");
    }
  }, [page, auth.permissions]);

  useEffect(() => {
    mobileHeaderTouchPointRef.current = null;
    mobileTopEdgeTouchPointRef.current = null;
    mobileNavTouchPointRef.current = null;
    mobileBottomEdgeTouchPointRef.current = null;
  }, [page]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const handleChange = () => {
      if (!media.matches) {
        mobileHeaderTouchPointRef.current = null;
        mobileTopEdgeTouchPointRef.current = null;
        mobileNavTouchPointRef.current = null;
        mobileBottomEdgeTouchPointRef.current = null;
      }
    };
    handleChange();
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (page !== "chat" || !shouldAutoScrollChatRef.current) return;
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

  function handleTopEdgeTouchStart(event: TouchEvent<HTMLButtonElement>) {
    if (!isMobileShellViewport()) return;
    mobileTopEdgeTouchPointRef.current = touchPointFromEvent(event);
  }

  function handleTopEdgeTouchMove(event: TouchEvent<HTMLButtonElement>) {
    if (!isMobileShellViewport()) return;
    const point = touchPointFromEvent(event);
    if (verticalGesture(mobileTopEdgeTouchPointRef.current, point) === "down") {
      setIsMobileHeaderVisible(true);
      mobileTopEdgeTouchPointRef.current = point;
    }
  }

  function handleHeaderTouchStart(event: TouchEvent<HTMLElement>) {
    if (!isMobileShellViewport()) return;
    mobileHeaderTouchPointRef.current = touchPointFromEvent(event);
  }

  function handleHeaderTouchMove(event: TouchEvent<HTMLElement>) {
    if (!isMobileShellViewport()) return;
    const point = touchPointFromEvent(event);
    if (verticalGesture(mobileHeaderTouchPointRef.current, point) === "up") {
      setIsMobileHeaderVisible(false);
      mobileHeaderTouchPointRef.current = point;
    }
  }

  function handleMobileNavTouchStart(event: TouchEvent<HTMLElement>) {
    if (!isMobileShellViewport()) return;
    mobileNavTouchPointRef.current = touchPointFromEvent(event);
  }

  function handleMobileNavTouchMove(event: TouchEvent<HTMLElement>) {
    if (!isMobileShellViewport()) return;
    const point = touchPointFromEvent(event);
    if (verticalGesture(mobileNavTouchPointRef.current, point) === "down") {
      setIsMobileNavVisible(false);
      mobileNavTouchPointRef.current = point;
    }
  }

  function handleBottomEdgeTouchStart(event: TouchEvent<HTMLButtonElement>) {
    if (!isMobileShellViewport()) return;
    mobileBottomEdgeTouchPointRef.current = touchPointFromEvent(event);
  }

  function handleBottomEdgeTouchMove(event: TouchEvent<HTMLButtonElement>) {
    if (!isMobileShellViewport()) return;
    const point = touchPointFromEvent(event);
    if (verticalGesture(mobileBottomEdgeTouchPointRef.current, point) === "up") {
      setIsMobileNavVisible(true);
      mobileBottomEdgeTouchPointRef.current = point;
    }
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
    window.localStorage.setItem("stocks-assistant-theme", theme);
  }, [resolvedTheme, theme]);

  useEffect(() => {
    window.localStorage.setItem(MOBILE_HEADER_VISIBLE_KEY, String(isMobileHeaderVisible));
  }, [isMobileHeaderVisible]);

  useEffect(() => {
    window.localStorage.setItem(MOBILE_NAV_VISIBLE_KEY, String(isMobileNavVisible));
  }, [isMobileNavVisible]);

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      const [healthResult, configResult, marketConfigResult] = await Promise.allSettled([
        checkHealth(),
        loadConfig(),
        getMarketConfig(),
      ]);
      if (!mounted) return;

      setHealth(healthResult.status === "fulfilled" ? "online" : "offline");
      if (configResult.status === "fulfilled") {
        setConfig(configResult.value);
        setDraft(toDraft(configResult.value));
      } else {
        setError(configResult.reason instanceof Error ? configResult.reason.message : (language === "en" ? "Failed to load configuration" : "配置加载失败"));
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

  const modelName = getActiveLlmModel(config, ui.shell.notConfigured);
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
    if (!text || isSending) return;

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
    setError("");
    setIsSending(true);
    setPage("chat");

    const shouldCreateNewSession = options.forceNewSession === true || options.newSession === true;
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
          streamedContent = finalResponse || streamedContent || ui.chat.empty;
          currentStatus = ui.chat.complete;
          trace = trace.map((item) => (item.status === "running" ? { ...item, status: "done" } : item));
          updateAssistant({
            id: messageId || assistantMessageId,
            content: streamedContent,
            pending: false,
            status: currentStatus,
            trace,
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
            createdAt: chatTime(language),
          });
          return;
        } catch (recoveryError) {
          const msg = chatFailureMessage(recoveryError, language);
          setError(msg);
          chatHistory.updateMessage(convId, assistantMessageId, {
            content: formatTemplate(ui.chat.requestFailed, { message: msg }),
            pending: false,
            status: ui.chat.streamRecoveryFailed,
          });
          return;
        }
      }
      const msg = chatFailureMessage(caught, language);
      setError(msg);
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
    setError("");
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
      configAutoSavePatchRef.current = {};
      setConfigState("saved");
      showConfigToast("success", ui.config.saved);
      window.setTimeout(() => setConfigState("idle"), 1400);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : ui.config.saveFailed;
      setError(message);
      setConfigState("error");
      showConfigToast("error", message);
    }
  }

  async function handleSaveConfig() {
    const source = configAutoSaveDraftRef.current ?? draft;
    if (!source) return;
    if (configAutoSaveTimerRef.current) {
      window.clearTimeout(configAutoSaveTimerRef.current);
      configAutoSaveTimerRef.current = null;
    }
    const pendingPatch = configAutoSavePatchRef.current;
    const patch = Object.keys(pendingPatch).length ? pendingPatch : undefined;
    configAutoSaveDraftRef.current = null;
    configAutoSavePatchRef.current = {};
    await saveDraftConfig(source, patch);
  }

  function scheduleConfigAutoSave(nextDraft: ConfigDraft, patch: Partial<ConfigDraft>) {
    configAutoSaveDraftRef.current = nextDraft;
    configAutoSavePatchRef.current = { ...configAutoSavePatchRef.current, ...patch };
    if (configAutoSaveTimerRef.current) {
      window.clearTimeout(configAutoSaveTimerRef.current);
    }
    const keys = Object.keys(patch);
    const immediate = keys.some((key) => typeof patch[key as keyof ConfigDraft] === "boolean");
    const longEdit = keys.some((key) => key === "system_prompt" || key === "mcp_servers_text");
    const delay = immediate ? 0 : longEdit ? 1200 : 800;
    configAutoSaveTimerRef.current = window.setTimeout(() => {
      configAutoSaveTimerRef.current = null;
      const source = configAutoSaveDraftRef.current;
      const pendingPatch = configAutoSavePatchRef.current;
      configAutoSaveDraftRef.current = null;
      configAutoSavePatchRef.current = {};
      if (source) void saveDraftConfig(source, pendingPatch);
    }, delay);
  }

  function flushConfigAutoSave() {
    if (!configAutoSaveDraftRef.current) return;
    if (configAutoSaveTimerRef.current) {
      window.clearTimeout(configAutoSaveTimerRef.current);
      configAutoSaveTimerRef.current = null;
    }
    const source = configAutoSaveDraftRef.current;
    const pendingPatch = configAutoSavePatchRef.current;
    configAutoSaveDraftRef.current = null;
    configAutoSavePatchRef.current = {};
    void saveDraftConfig(source, pendingPatch);
  }

  function patchDraft(patch: Partial<ConfigDraft>) {
    setDraft((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      scheduleConfigAutoSave(next, patch);
      return next;
    });
  }

  function applySavedConfig(next: AppConfig) {
    setConfig(next);
    setDraft(toDraft(next));
    setConfigState("saved");
  }

  function handleNavigate(nextPage: Page) {
    if (nextPage === "fundamentals") {
      setSelectedSymbol("");
    }
    setPage(nextPage);
  }

  return (
    <div className="console-shell h-[100dvh] overflow-hidden">
      {confirmDialog.dialog}
      <ReauthDialog />
      <ConfigSaveToast key={configToast?.id ?? "empty"} toast={configToast} onClose={dismissConfigToast} />
      <div className="app-frame flex h-full min-h-0 w-full flex-col gap-0 p-0">
        <button
          aria-label={language === "en" ? "Show top bar" : "显示顶部栏"}
          className={cn("app-top-edge-trigger lg:hidden", isMobileHeaderVisible && "pointer-events-none opacity-0")}
          onClick={() => setIsMobileHeaderVisible(true)}
          onTouchMove={handleTopEdgeTouchMove}
          onTouchStart={handleTopEdgeTouchStart}
          tabIndex={isMobileHeaderVisible ? -1 : 0}
          type="button"
        >
          <span className="app-edge-grabber" />
        </button>
        <Header
          health={health}
          isMobileVisible={isMobileHeaderVisible}
          language={language}
          modelName={modelName}
          onOpenMobileMore={() => setIsMobileMoreOpen(true)}
          onHideMobileChrome={() => {
            setIsMobileHeaderVisible(false);
            setIsMobileNavVisible(false);
            setIsMobileMoreOpen(false);
          }}
          onHome={() => setPage("overview")}
          onLogout={auth.logout}
          onTouchMove={handleHeaderTouchMove}
          onTouchStart={handleHeaderTouchStart}
          onThemeChange={setTheme}
          resolvedTheme={resolvedTheme}
          theme={theme}
          username={auth.user?.username ?? ""}
        />
        <MobileMoreSheet
          canPage={canPage}
          isOpen={isMobileMoreOpen}
          language={language}
          onClose={() => setIsMobileMoreOpen(false)}
          page={page}
          setPage={handleNavigate}
        />
        <DesktopTopNav
          canPage={canPage}
          language={language}
          page={page}
          setPage={handleNavigate}
        />
        <MobileNav
          canPage={canPage}
          isVisible={isMobileNavVisible}
          language={language}
          onBottomEdgeTouchMove={handleBottomEdgeTouchMove}
          onBottomEdgeTouchStart={handleBottomEdgeTouchStart}
          onHide={() => setIsMobileNavVisible(false)}
          onNavTouchMove={handleMobileNavTouchMove}
          onNavTouchStart={handleMobileNavTouchStart}
          onShow={() => setIsMobileNavVisible(true)}
          page={page}
          setPage={handleNavigate}
        />

        <div
          className="app-main-grid flex min-h-0 flex-1"
        >
          <main
            className={cn(
              "app-main-stage flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-2 sm:p-4 lg:overflow-y-auto lg:pb-4",
              isMobileHeaderVisible && "mobile-header-spacer",
              isMobileNavVisible
                ? "pb-[calc(4.75rem+env(safe-area-inset-bottom))] sm:pb-[calc(5rem+env(safe-area-inset-bottom))]"
                : "pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-[calc(1rem+env(safe-area-inset-bottom))]",
              page === "chat" && "app-main-stage-chat overflow-hidden",
            )}
            key={page}
          >
            {error ? (
              <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            ) : null}

            <Suspense fallback={<PageFallback />}>
              {page === "overview" ? (
                <DashboardPage
                  canPermission={auth.can}
                  config={config}
                  enabledCount={enabledCount}
                  language={language}
                  modelName={modelName}
                  onOpenChart={(symbol) => {
                    setSelectedSymbol(symbol);
                    setPage("chart");
                  }}
                  onOpenConfig={() => setPage("config")}
                  onOpenMarket={() => setPage("market")}
                  onOpenNews={(symbol) => {
                    if (symbol) setSelectedSymbol(symbol);
                    setPage("news");
                  }}
                  onOpenPortfolio={() => setPage("portfolio")}
                  onOpenWatchlist={() => setPage("watchlist")}
                  onPrompt={(value) => {
                    void handleSend(undefined, value, { forceNewSession: true });
                  }}
                  refreshInterval={marketConfig.refresh_interval}
                />
              ) : null}

            {page === "chat" ? (
              <ChatPage
                chatScrollRef={chatScrollRef}
                confirmAction={confirmDialog.confirm}
                endRef={endRef}
                handleSend={handleSend}
                handleChatScroll={handleChatScroll}
                handleStopStreaming={handleStopStreaming}
                isSending={isSending}
                language={language}
                displayName={auth.user?.display_name || auth.user?.username || ""}
                messages={messages}
                mobileNavVisible={isMobileNavVisible}
                prompt={prompt}
                quickPrompts={quickPrompts}
                chatHistory={chatHistory}
                setPrompt={setPrompt}
              />
            ) : null}

            {page === "tracing" ? (
              <TracingPage
                activeSessionId={activeConvId}
                onOpenConfig={() => setPage("config")}
                tracingEnabled={Boolean(config?.tracing_enabled)}
              />
            ) : null}

            {page === "watchlist" ? (
              <WatchlistPage
                language={language}
                onAnalyzeStock={(symbol) => {
                  setPrompt(formatTemplate(i18n[language].watchlist.analysisPrompt, { symbol }));
                  setPage("chat");
                }}
                onOpenFinancials={(symbol) => {
                  setSelectedSymbol(symbol);
                  setPage("fundamentals");
                }}
                onOpenNews={(symbol) => {
                  setSelectedSymbol(symbol);
                  setPage("news");
                }}
              />
            ) : null}

            {page === "news" ? <NewsPage initialSymbol={selectedSymbol || undefined} language={language} /> : null}

            {page === "portfolio" ? (
              <PortfolioPage
                confirmAction={confirmDialog.confirm}
                language={language}
                refreshInterval={marketConfig.refresh_interval}
                onAnalyzeStock={(symbol) => {
                  setPrompt(formatTemplate(i18n[language].portfolio.analysisPrompt, { symbol }));
                  setPage("chat");
                }}
                onOpenFinancials={(symbol) => {
                  setSelectedSymbol(symbol);
                  setPage("fundamentals");
                }}
              />
            ) : null}

            {page === "market" ? (
              <MarketDashboard
                language={language}
                onOpenConfig={() => setPage("market_config")}
                refreshInterval={marketConfig.refresh_interval}
                onSelectStock={(quote) => {
                  setSelectedSymbol(quote.symbol);
                  setPage("chart");
                }}
              />
            ) : null}

            {page === "chart" ? (
              <TechnicalAnalysis
                language={language}
                symbol={selectedSymbol}
                onSymbolChange={setSelectedSymbol}
                onBack={() => setPage("market")}
              />
            ) : null}

            {page === "fundamentals" ? <FinancialReportsPage language={language} initialSymbol={selectedSymbol || undefined} /> : null}

            {page === "market_config" ? (
              <MarketConfigPage
                language={language}
                onBack={() => setPage("market")}
                onSaved={(cfg) => {
                  setMarketConfig(cfg);
                  setPage("market");
                }}
              />
            ) : null}

            {page === "skills" ? <SkillsPage confirmAction={confirmDialog.confirm} language={language} /> : null}

            {page === "subagents" ? (
              <SubAgentsPage
                config={config}
                confirmAction={confirmDialog.confirm}
                language={language}
                onSaved={applySavedConfig}
                onOpenConfig={() => setPage("config")}
              />
            ) : null}

            {page === "memory" ? <MemoryPage confirmAction={confirmDialog.confirm} language={language} /> : null}

            {page === "knowledge" ? <KnowledgePage language={language} /> : null}

            {page === "scheduler" ? <SchedulerPage confirmAction={confirmDialog.confirm} language={language} telegramEnabled={Boolean(config?.telegram_enabled)} /> : null}

            {page === "mcp" ? <MCPPage language={language} /> : null}

            {page === "security" ? <SecurityPage confirmAction={confirmDialog.confirm} language={language} /> : null}

            {page === "users" ? <UsersPage language={language} /> : null}

              {page === "config" ? (
                <ConfigPage
                  canManageSystem={auth.can("config:write")}
                  config={config}
                  configState={configState}
                  draft={draft}
                  enabledCount={enabledCount}
                  handleSaveConfig={handleSaveConfig}
                  language={language}
                  onConfigBlur={flushConfigAutoSave}
                  patchDraft={patchDraft}
                  setDraft={setDraft}
                />
              ) : null}
            </Suspense>
          </main>
        </div>
      </div>
    </div>
  );
}

function Header({
  health,
  isMobileVisible,
  language,
  modelName,
  onHideMobileChrome,
  onHome,
  onLogout,
  onOpenMobileMore,
  onTouchMove,
  onTouchStart,
  onThemeChange,
  resolvedTheme,
  theme,
  username,
}: {
  health: "checking" | "online" | "offline";
  isMobileVisible: boolean;
  language: AppLanguage;
  modelName: string;
  onHideMobileChrome: () => void;
  onHome: () => void;
  onLogout: () => void;
  onOpenMobileMore: () => void;
  onTouchMove: (event: TouchEvent<HTMLElement>) => void;
  onTouchStart: (event: TouchEvent<HTMLElement>) => void;
  onThemeChange: (theme: Theme) => void;
  resolvedTheme: EffectiveTheme;
  theme: Theme;
  username: string;
}) {
  const themeLabels = language === "en"
    ? { system: "System", dark: "Dark", light: "Light", current: "Theme", switchTo: "Switch to", darkNow: "dark", lightNow: "light" }
    : { system: "系统", dark: "黑暗", light: "亮色", current: "主题切换，当前", switchTo: "切换到", darkNow: "黑暗", lightNow: "亮色" };
  const themeOptions: Array<{ value: Theme; label: string; icon: ReactNode }> = [
    { value: "system", label: themeLabels.system, icon: <Monitor /> },
    { value: "dark", label: themeLabels.dark, icon: <Moon /> },
    { value: "light", label: themeLabels.light, icon: <Sun /> },
  ];
  const hideMobileChromeLabel = language === "en" ? "Hide header and bottom navigation" : "隐藏顶部和底部导航";

  return (
    <header
      className={cn(
        "panel app-header flex shrink-0 items-center justify-between gap-2 rounded-none border-x-0 border-t-0 px-2 py-1.5 shadow-none sm:px-3 sm:py-2 lg:px-4 lg:py-3",
        !isMobileVisible && "mobile-header-hidden",
      )}
      onTouchMove={onTouchMove}
      onTouchStart={onTouchStart}
    >
      <button className="flex min-w-0 flex-1 items-center gap-2 text-left lg:gap-3" onClick={onHome} type="button">
        <div className="grid size-8 shrink-0 place-items-center rounded-md border border-primary/35 bg-primary/10 text-primary shadow-glow lg:size-11 lg:rounded-lg">
          <Sparkles className="size-4 lg:size-5" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-foreground sm:text-base lg:text-xl">Stocks Assistant</h1>
          <p className="hidden truncate text-xs text-muted-foreground lg:block lg:text-sm">Markets, research, portfolio</p>
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-1.5 lg:min-w-0 lg:flex-wrap lg:gap-2">
        <Badge className="hidden lg:inline-flex" variant={health === "online" ? "default" : health === "checking" ? "muted" : "danger"}>
          {health === "online" ? "API ONLINE" : health === "checking" ? "CHECKING" : "API OFFLINE"}
        </Badge>
        <Badge variant="outline" className="hidden max-w-full gap-1.5 truncate lg:inline-flex">
          <Cpu className="size-3.5" />
          <span className="truncate">{modelName}</span>
        </Badge>
        <Badge variant="outline" className="hidden max-w-[160px] truncate lg:inline-flex">{username}</Badge>
        <Button
          aria-label={language === "en" ? "Open page menu" : "打开页面菜单"}
          className="h-8 w-8 lg:hidden"
          onClick={onOpenMobileMore}
          size="icon"
          title={language === "en" ? "Open page menu" : "打开页面菜单"}
          type="button"
          variant="outline"
        >
          <Menu className="size-4" />
        </Button>
        <Button
          aria-label={hideMobileChromeLabel}
          className="h-8 w-8 lg:hidden"
          onClick={onHideMobileChrome}
          size="icon"
          title={hideMobileChromeLabel}
          type="button"
          variant="outline"
        >
          <ChevronUp className="size-4" />
        </Button>
        <Button size="icon" variant="outline" onClick={onLogout} aria-label={language === "en" ? "Log out" : "退出登录"}>
          <LogOut />
        </Button>
        <div
          aria-label={`${themeLabels.current}${theme === "system" ? `${themeLabels.system} (${resolvedTheme === "dark" ? themeLabels.darkNow : themeLabels.lightNow})` : theme === "dark" ? themeLabels.dark : themeLabels.light}`}
          className="theme-toggle inline-flex h-8 shrink-0 items-center rounded-full border border-input bg-background/70 p-0.5"
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
                  "grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground [&_svg]:size-3.5",
                  active && "bg-card text-foreground shadow-sm",
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
      </div>
    </header>
  );
}

function DesktopTopNav({
  canPage,
  language,
  page,
  setPage,
}: {
  canPage: (page: Page) => boolean;
  language: AppLanguage;
  page: Page;
  setPage: (page: Page) => void;
}) {
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const primaryItems = getPinnedNavItems(language).filter((item) => canPage(item.id));
  const moreGroups = getDesktopMoreGroups(language)
    .map((group) => ({ ...group, items: group.items.filter((item) => canPage(item.id)) }))
    .filter((group) => group.items.length > 0);
  const moreItems = moreGroups.flatMap((group) => group.items);
  const isMoreActive = moreItems.some((item) => item.id === page);
  const moreLabel = language === "en" ? "More" : "更多";

  useEffect(() => {
    setIsMoreOpen(false);
  }, [page]);

  function navigate(nextPage: Page) {
    setIsMoreOpen(false);
    setPage(nextPage);
  }

  return (
    <nav className="finance-top-nav hidden shrink-0 lg:block" aria-label={i18n[language].shell.navigation}>
      <div className="mx-auto flex h-11 w-full max-w-[1760px] items-center gap-1 px-4">
        {primaryItems.map((item) => (
          <button
            aria-current={page === item.id ? "page" : undefined}
            className={cn("finance-top-nav-item", page === item.id && "finance-top-nav-item-active")}
            key={item.id}
            onClick={() => navigate(item.id)}
            type="button"
          >
            <span className="[&_svg]:size-3.5">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}

        {moreGroups.length > 0 ? (
          <div className="relative ml-1">
            <button
              aria-expanded={isMoreOpen}
              className={cn("finance-top-nav-item", isMoreActive && "finance-top-nav-item-active")}
              onClick={() => setIsMoreOpen((current) => !current)}
              type="button"
            >
              <Menu className="size-3.5" />
              <span>{moreLabel}</span>
              <ChevronDown className="size-3.5" />
            </button>
            {isMoreOpen ? (
              <div className="finance-more-menu absolute left-0 top-[calc(100%+0.5rem)] z-50 w-[520px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl p-3 text-popover-foreground">
                <div className="grid grid-cols-2 gap-3">
                  {moreGroups.map((group) => (
                    <div className="min-w-0" key={group.id}>
                      <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p>
                      <div className="space-y-0.5">
                        {group.items.map((item) => (
                          <button
                            aria-current={page === item.id ? "page" : undefined}
                            className={cn(
                              "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors",
                              page === item.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/80 hover:text-foreground",
                            )}
                            key={item.id}
                            onClick={() => navigate(item.id)}
                            type="button"
                          >
                            <span className="shrink-0 [&_svg]:size-4">{item.icon}</span>
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{item.label}</span>
                              <span className="block truncate text-[11px] opacity-75">{item.hint}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </nav>
  );
}

function MobileMoreSheet({
  canPage,
  isOpen,
  language,
  onClose,
  page,
  setPage,
}: {
  canPage: (page: Page) => boolean;
  isOpen: boolean;
  language: AppLanguage;
  onClose: () => void;
  page: Page;
  setPage: (page: Page) => void;
}) {
  const navItems = getNavItems(language).filter((item) => canPage(item.id));
  const moreItems = navItems.filter((item) => !MOBILE_PRIMARY_PAGES.includes(item.id));
  const copy = i18n[language].shell;
  const closeLabel = language === "en" ? "Close" : "关闭";

  function navigate(nextPage: Page) {
    onClose();
    setPage(nextPage);
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-40 lg:hidden">
      <button
        aria-label={closeLabel}
        className="absolute inset-0 bg-background/60 backdrop-blur-[2px]"
        onClick={onClose}
        type="button"
      />
      <div className="absolute inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] mx-2 max-h-[min(560px,72dvh)] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-2xl">
        <div className="flex items-center justify-between border-b border-border/80 px-3 py-2">
          <div>
            <p className="text-sm font-semibold">{copy.navigation}</p>
            <p className="text-xs text-muted-foreground">{copy.pageSwitch}</p>
          </div>
          <Button aria-label={closeLabel} className="h-8 w-8" onClick={onClose} size="icon" variant="ghost">
            <X className="size-4" />
          </Button>
        </div>
        <div className="grid max-h-[calc(min(560px,72dvh)-3.5rem)] grid-cols-2 gap-2 overflow-y-auto p-2 sm:grid-cols-3">
          {moreItems.map((item) => (
            <button
              aria-current={page === item.id ? "page" : undefined}
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-md border px-3 py-2.5 text-left transition-colors",
                page === item.id
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border/80 bg-background/55 text-muted-foreground hover:bg-muted/80 hover:text-foreground",
              )}
              key={item.id}
              onClick={() => navigate(item.id)}
              type="button"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted/70 [&_svg]:size-4">{item.icon}</span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{item.label}</span>
                <span className="block truncate text-[11px]">{item.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function MobileNav({
  canPage,
  isVisible,
  language,
  onBottomEdgeTouchMove,
  onBottomEdgeTouchStart,
  onHide,
  onNavTouchMove,
  onNavTouchStart,
  onShow,
  page,
  setPage,
}: {
  canPage: (page: Page) => boolean;
  isVisible: boolean;
  language: AppLanguage;
  onBottomEdgeTouchMove: (event: TouchEvent<HTMLButtonElement>) => void;
  onBottomEdgeTouchStart: (event: TouchEvent<HTMLButtonElement>) => void;
  onHide: () => void;
  onNavTouchMove: (event: TouchEvent<HTMLElement>) => void;
  onNavTouchStart: (event: TouchEvent<HTMLElement>) => void;
  onShow: () => void;
  page: Page;
  setPage: (page: Page) => void;
}) {
  const navItems = getNavItems(language).filter((item) => canPage(item.id));
  const primaryItems = MOBILE_PRIMARY_PAGES
    .map((id) => navItems.find((item) => item.id === id))
    .filter((item): item is NavItem => Boolean(item));
  const copy = i18n[language].shell;
  const showNavLabel = language === "en" ? "Show bottom navigation" : "显示底部导航";
  const hideNavLabel = language === "en" ? "Hide bottom navigation" : "隐藏底部导航";

  function navigate(nextPage: Page) {
    setPage(nextPage);
  }

  return (
    <>
      <nav
        className={cn(
          "panel app-mobile-nav fixed inset-x-0 bottom-0 z-50 grid grid-cols-3 gap-1 rounded-none border-x-0 border-b-0 px-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))] pt-1.5 shadow-none lg:hidden",
          !isVisible && "mobile-nav-hidden",
        )}
        aria-label={copy.navigation}
        onTouchMove={onNavTouchMove}
        onTouchStart={onNavTouchStart}
      >
        <Button
          aria-label={hideNavLabel}
          className="absolute -top-3.5 right-2 h-7 w-7 rounded-full border-border/90 bg-card/95 shadow-md backdrop-blur"
          onClick={onHide}
          size="icon"
          title={hideNavLabel}
          type="button"
          variant="outline"
        >
          <ChevronDown className="size-3.5" />
        </Button>
        {primaryItems.map((item) => (
          <button
            className={cn(
              "nav-item flex h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-md px-1 text-[10px] font-semibold transition-colors",
              page === item.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/55 hover:text-foreground",
            )}
            key={item.id}
            onClick={() => navigate(item.id)}
            type="button"
          >
            <span className="[&_svg]:size-4">{item.icon}</span>
            <span className="max-w-full truncate">{item.label}</span>
          </button>
        ))}
      </nav>
      <button
        aria-label={showNavLabel}
        className={cn("app-bottom-edge-trigger lg:hidden", isVisible && "pointer-events-none opacity-0")}
        onClick={onShow}
        onTouchMove={onBottomEdgeTouchMove}
        onTouchStart={onBottomEdgeTouchStart}
        tabIndex={isVisible ? -1 : 0}
        type="button"
      >
        <span className="app-edge-grabber" />
      </button>
    </>
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
