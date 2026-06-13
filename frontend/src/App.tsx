import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, TouchEvent } from "react";
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
  FileText,
  Home,
  Loader2,
  LogOut,
  MessageSquareText,
  Monitor,
  Moon,
  Newspaper,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getChatSession,
  getMarketConfig,
  loadConfig,
  sendChat,
  saveConfig,
  streamChat,
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
const FinancialReportsPage = lazy(() => import("@/components/FinancialReportsPage").then((module) => ({ default: module.FinancialReportsPage })));
const KnowledgePage = lazy(() => import("@/pages/KnowledgePage").then((module) => ({ default: module.KnowledgePage })));
const MCPPage = lazy(() => import("@/pages/MCPPage").then((module) => ({ default: module.MCPPage })));
const MemoryPage = lazy(() => import("@/pages/MemoryPage").then((module) => ({ default: module.MemoryPage })));
const NewsPage = lazy(() => import("@/pages/NewsPage").then((module) => ({ default: module.NewsPage })));
const PortfolioPage = lazy(() => import("@/components/PortfolioPage").then((module) => ({ default: module.PortfolioPage })));
const SchedulerPage = lazy(() => import("@/pages/SchedulerPage").then((module) => ({ default: module.SchedulerPage })));
const SecurityPage = lazy(() => import("@/pages/SecurityPage").then((module) => ({ default: module.SecurityPage })));
const SkillsPage = lazy(() => import("@/pages/SkillsPage").then((module) => ({ default: module.SkillsPage })));
const SubAgentsPage = lazy(() => import("@/pages/SubAgentsPage").then((module) => ({ default: module.SubAgentsPage })));
const TracingPage = lazy(() => import("@/pages/TracingPage").then((module) => ({ default: module.TracingPage })));
const UsersPage = lazy(() => import("@/pages/UsersPage").then((module) => ({ default: module.UsersPage })));
const WatchlistPage = lazy(() => import("@/pages/WatchlistPage").then((module) => ({ default: module.WatchlistPage })));

type NavItem = { id: Page; label: string; icon: ReactNode; hint: string };
type NavGroup = { id: string; label: string; items: NavItem[] };
type ConfigToast = { id: number; kind: "success" | "error"; message: string; state: "open" | "closing" };
type TouchPoint = { x: number; y: number };

const MOBILE_GESTURE_DELTA = 28;
const MOBILE_HEADER_VISIBLE_KEY = "stocks-assistant-mobile-header-visible";
const LEGACY_MOBILE_CHROME_HIDDEN_KEY = "stocks-assistant-mobile-chrome-hidden";

const DEFAULT_PAGE_PERMISSION: Partial<Record<Page, string>> = {
  overview: "config:read",
  tracing: "tracing:read",
  security: "config:read",
  watchlist: "watchlist:read",
  portfolio: "portfolio:read",
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
  tracing: "/tracing",
  security: "/security",
  watchlist: "/watchlist",
  portfolio: "/portfolio",
  news: "/news",
  config: "/settings",
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
  ["/chat", "overview"],
  ["/chart", "watchlist"],
  ["/market", "overview"],
  ["/market/config", "config"],
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

function navItem(language: AppLanguage, id: Page, icon: ReactNode): NavItem {
  const [label, hint] = i18n[language].nav[id as keyof typeof i18n.zh.nav];
  return { id, label, icon, hint };
}

function getAccountNavGroups(language: AppLanguage): NavGroup[] {
  const groups = i18n[language].groups;
  return [
    {
      id: "market",
      label: groups.market,
      items: [
        navItem(language, "overview", <Home />),
        navItem(language, "watchlist", <Star />),
        navItem(language, "portfolio", <BriefcaseBusiness />),
        navItem(language, "fundamentals", <FileText />),
        navItem(language, "news", <Newspaper />),
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
      id: "workspace",
      label: groups.workspace,
      items: [
        navItem(language, "memory", <BrainCircuit />),
        navItem(language, "knowledge", <BookOpen />),
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

function touchPointFromEvent<T extends Element>(event: TouchEvent<T>): TouchPoint | null {
  const touch = event.touches[0];
  return touch ? { x: touch.clientX, y: touch.clientY } : null;
}

function isInteractiveTouchTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("button, a, input, textarea, select, [role='button'], [data-touch-gesture-ignore='true']"));
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
  const { showToast } = useToast();
  const [page, setPage] = useState<Page>(() => pageFromPath(window.location.pathname));
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
  const [configInitialTab, setConfigInitialTab] = useState<ConfigTab>(() => configTabFromPath(window.location.pathname) ?? "model");
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollChatRef = useRef(true);
  const mobileHeaderTouchPointRef = useRef<TouchPoint | null>(null);
  const mobileTopEdgeTouchPointRef = useRef<TouchPoint | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const isSendingRef = useRef(false);
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
    const handlePopState = () => {
      const nextTab = configTabFromPath(window.location.pathname);
      if (nextTab) setConfigInitialTab(nextTab);
      setPage(pageFromPath(window.location.pathname));
    };
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
      setPage("overview");
    }
  }, [page, auth.permissions]);

  useEffect(() => {
    mobileHeaderTouchPointRef.current = null;
    mobileTopEdgeTouchPointRef.current = null;
    setDashboardChatDrawerOpen(false);
  }, [page]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const handleChange = () => {
      setIsMobileViewport(media.matches);
      if (!media.matches) {
        mobileHeaderTouchPointRef.current = null;
        mobileTopEdgeTouchPointRef.current = null;
        setDashboardChatDrawerOpen(false);
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
    if (isInteractiveTouchTarget(event.target)) {
      mobileHeaderTouchPointRef.current = null;
      return;
    }
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
    setPage("overview");

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
    if (source.guardian_api_key.trim()) {
      payload.guardian_api_key = source.guardian_api_key.trim();
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
      configAutoSavePatchRef.current = {};
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
    if (nextPage === "config") {
      setConfigInitialTab("model");
    }
    setPage(nextPage);
  }

  function openConfig(tab: ConfigTab = "model") {
    setConfigInitialTab(tab);
    setPage("config");
  }

  const dashboardChatPanel = (
    <ChatPage
      chatScrollRef={chatScrollRef}
      confirmAction={confirmDialog.confirm}
      displayName={auth.user?.display_name || auth.user?.username || ""}
      embedded
      endRef={endRef}
      expanded={isMobileViewport ? dashboardChatDrawerOpen : dashboardChatExpanded}
      handleChatScroll={handleChatScroll}
      handleSend={handleSend}
      handleStopStreaming={handleStopStreaming}
      isSending={isSending}
      language={language}
      messages={messages}
      mobileNavVisible={false}
      onToggleExpanded={() => {
        if (isMobileViewport) {
          setDashboardChatDrawerOpen(false);
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
    <div className={cn("console-shell h-[100dvh] overflow-hidden", page === "watchlist" && "console-shell-watchlist")}>
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
          canPage={canPage}
          isMobileVisible={isMobileHeaderVisible}
          language={language}
          onHideMobileChrome={() => {
            setIsMobileHeaderVisible(false);
          }}
          onHome={() => setPage("overview")}
          onLogout={auth.logout}
          onUpdateProfile={auth.updateProfile}
          page={page}
          setPage={handleNavigate}
          onTouchMove={handleHeaderTouchMove}
          onTouchStart={handleHeaderTouchStart}
          onThemeChange={setTheme}
          resolvedTheme={resolvedTheme}
          theme={theme}
          user={auth.user}
        />

        <div
          className="app-main-grid flex min-h-0 flex-1"
        >
          <main
            className={cn(
              "app-main-stage flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-2 sm:p-3 lg:overflow-y-auto lg:p-3",
              isMobileHeaderVisible && "mobile-header-spacer",
              page === "overview" && "xl:overflow-hidden",
            )}
            key={page}
          >
            <Suspense fallback={<PageFallback />}>
              {page === "overview" ? (
                <DashboardPage
                  canPermission={auth.can}
                  chatExpanded={dashboardChatExpanded}
                  chatPanel={dashboardChatPanel}
                  isMobileViewport={isMobileViewport}
                  language={language}
                  onOpenChart={(symbol) => {
                    setSelectedSymbol(symbol);
                    setPage("watchlist");
                  }}
                  onOpenMarketConfig={() => openConfig("market")}
                  onOpenPortfolio={() => setPage("portfolio")}
                  onOpenWatchlist={() => setPage("watchlist")}
                  refreshInterval={marketConfig.refresh_interval}
                />
              ) : null}

            {page === "tracing" ? (
              <TracingPage
                activeSessionId={activeConvId}
                onOpenConfig={() => openConfig()}
                tracingEnabled={Boolean(config?.tracing_enabled)}
              />
            ) : null}

            {page === "watchlist" ? (
              <WatchlistPage
                language={language}
                selectedSymbol={selectedSymbol}
                onSelectedSymbolChange={setSelectedSymbol}
                onOpenFinancials={(symbol) => {
                  setSelectedSymbol(symbol);
                  setPage("fundamentals");
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
                  setPage("overview");
                }}
                onOpenFinancials={(symbol) => {
                  setSelectedSymbol(symbol);
                  setPage("fundamentals");
                }}
              />
            ) : null}

            {page === "fundamentals" ? <FinancialReportsPage language={language} initialSymbol={selectedSymbol || undefined} /> : null}

            {page === "skills" ? <SkillsPage confirmAction={confirmDialog.confirm} language={language} /> : null}

            {page === "subagents" ? (
              <SubAgentsPage
                config={config}
                confirmAction={confirmDialog.confirm}
                language={language}
                onSaved={applySavedConfig}
                onOpenConfig={() => openConfig()}
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
                  canReadMarket={auth.can("market:read")}
                  canWriteMarket={auth.can("market:write")}
                  config={config}
                  configState={configState}
                  draft={draft}
                  enabledCount={enabledCount}
                  handleSaveConfig={handleSaveConfig}
                  initialTab={configInitialTab}
                  language={language}
                  onConfigBlur={flushConfigAutoSave}
                  onMarketConfigSaved={setMarketConfig}
                  patchDraft={patchDraft}
                  setDraft={setDraft}
                />
              ) : null}
            </Suspense>
          </main>
        </div>
        {page === "overview" && isMobileViewport && auth.can("chat:read") ? (
          <DashboardMobileChatDock
            chatPanel={dashboardChatPanel}
            isOpen={dashboardChatDrawerOpen}
            language={language}
            onOpenChange={setDashboardChatDrawerOpen}
          />
        ) : null}
      </div>
    </div>
  );
}

function DashboardMobileChatDock({
  chatPanel,
  isOpen,
  language,
  onOpenChange,
}: {
  chatPanel: ReactNode;
  isOpen: boolean;
  language: AppLanguage;
  onOpenChange: (open: boolean) => void;
}) {
  const mobileChatLabel = language === "en" ? "Search or ask" : "搜索或提问";
  const closeMobileChatLabel = language === "en" ? "Close AI drawer" : "关闭 AI 抽屉";

  return (
    <>
      {!isOpen ? (
        <div className="dashboard-chat-searchbar fixed inset-x-0 bottom-0 z-[920] px-3 pb-[calc(0.85rem+env(safe-area-inset-bottom))] pt-3 lg:hidden">
          <button
            aria-label={mobileChatLabel}
            className="flex h-16 w-full items-center gap-3 rounded-[2rem] border border-border/75 bg-card px-4 text-left text-lg font-semibold text-muted-foreground shadow-[0_-10px_30px_hsl(var(--background)_/_0.75),0_14px_34px_hsl(var(--foreground)_/_0.13)] transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            onClick={() => onOpenChange(true)}
            title={mobileChatLabel}
            type="button"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground">
              <Search className="size-5" />
            </span>
            <span className="min-w-0 flex-1 truncate">{mobileChatLabel}</span>
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted/55 text-muted-foreground">
              <MessageSquareText className="size-4" />
            </span>
          </button>
        </div>
      ) : null}
      {isOpen ? (
        <div className="dashboard-chat-drawer-layer fixed inset-0 z-[950] lg:hidden">
          <button
            aria-label={closeMobileChatLabel}
            className="absolute inset-0 bg-background/45 backdrop-blur-[2px]"
            onClick={() => onOpenChange(false)}
            type="button"
          />
          <aside
            aria-label={mobileChatLabel}
            className="dashboard-chat-drawer absolute inset-x-0 bottom-0 flex h-[min(86dvh,46rem)] min-h-[28rem] flex-col overflow-hidden rounded-t-2xl border border-border/80 bg-background shadow-2xl"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-border/65 px-3 py-2">
              <button
                aria-label={closeMobileChatLabel}
                className="flex flex-1 items-center justify-center py-1"
                onClick={() => onOpenChange(false)}
                type="button"
              >
                <span className="h-1 w-10 rounded-full bg-muted-foreground/35" />
              </button>
              <Button
                aria-label={closeMobileChatLabel}
                className="ml-2 h-8 w-8"
                onClick={() => onOpenChange(false)}
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
  canPage,
  isMobileVisible,
  language,
  onHideMobileChrome,
  onHome,
  onLogout,
  onUpdateProfile,
  page,
  setPage,
  onTouchMove,
  onTouchStart,
  onThemeChange,
  resolvedTheme,
  theme,
  user,
}: {
  canPage: (page: Page) => boolean;
  isMobileVisible: boolean;
  language: AppLanguage;
  onHideMobileChrome: () => void;
  onHome: () => void;
  onLogout: () => void;
  onUpdateProfile: (payload: { display_name?: string; avatar_base64?: string }) => Promise<AuthUser>;
  page: Page;
  setPage: (page: Page) => void;
  onTouchMove: (event: TouchEvent<HTMLElement>) => void;
  onTouchStart: (event: TouchEvent<HTMLElement>) => void;
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

  return (
    <header
      className={cn(
        "panel app-header flex shrink-0 items-center justify-between gap-2 rounded-none border-x-0 border-t-0 px-2 py-1 shadow-none sm:px-3 lg:px-3",
        !isMobileVisible && "mobile-header-hidden",
      )}
      onTouchMove={onTouchMove}
      onTouchStart={onTouchStart}
    >
      <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={onHome} type="button">
        <div className="grid size-7 shrink-0 place-items-center rounded-md border border-primary/35 bg-primary/10 text-primary shadow-glow">
          <Sparkles className="size-3.5" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-foreground">Stocks Assistant</h1>
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-1.5 lg:min-w-0">
        <Button
          aria-label={hideMobileChromeLabel}
          className="h-7 w-7 lg:hidden"
          onClick={onHideMobileChrome}
          size="icon"
          title={hideMobileChromeLabel}
          type="button"
          variant="outline"
        >
          <ChevronUp className="size-4" />
        </Button>
        <div
          aria-label={`${themeLabels.current}${theme === "system" ? `${themeLabels.system} (${resolvedTheme === "dark" ? themeLabels.darkNow : themeLabels.lightNow})` : theme === "dark" ? themeLabels.dark : themeLabels.light}`}
          className="theme-toggle inline-flex h-7 shrink-0 items-center rounded-full border border-input bg-background/70 p-0.5"
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
                  "grid h-6 w-6 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground [&_svg]:size-3",
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
        <UserAvatarMenu
          canPage={canPage}
          language={language}
          onLogout={onLogout}
          onUpdateProfile={onUpdateProfile}
          page={page}
          setPage={setPage}
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
  const className = size === "lg" ? "size-10 text-sm" : "size-7 text-xs";
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
  canPage,
  language,
  onLogout,
  onUpdateProfile,
  page,
  setPage,
  user,
}: {
  canPage: (page: Page) => boolean;
  language: AppLanguage;
  onLogout: () => void;
  onUpdateProfile: (payload: { display_name?: string; avatar_base64?: string }) => Promise<AuthUser>;
  page: Page;
  setPage: (page: Page) => void;
  user: AuthUser | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);
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
      navigation: "More",
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
      navigation: "更多入口",
      logout: "退出登录",
      permissions: "项权限",
      noRoles: "暂无角色",
    };
  const navGroups = useMemo(() => {
    return getAccountNavGroups(language)
      .map((group) => ({ ...group, items: group.items.filter((item) => canPage(item.id)) }))
      .filter((group) => group.items.length > 0);
  }, [canPage, language]);

  useEffect(() => {
    if (!isOpen) return undefined;
    function handlePointerDown(event: PointerEvent) {
      const path = event.composedPath();
      if (!menuRef.current || !path.includes(menuRef.current)) setIsOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  function navigate(nextPage: Page) {
    setIsOpen(false);
    setPage(nextPage);
  }

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
        aria-label={language === "en" ? "Open account menu" : "打开账号菜单"}
        className="flex h-8 items-center gap-1 rounded-full border border-input bg-background/70 p-0.5 pr-1.5 transition-colors hover:bg-muted/55"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <AvatarVisual user={user} />
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </button>

      {isOpen ? (
        <div
          className="account-menu-popover absolute right-0 top-[calc(100%+0.45rem)] z-[1000] max-h-[min(680px,calc(100dvh-4rem))] w-[320px] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border border-border/90 p-2 text-popover-foreground shadow-2xl ring-1 ring-border/40"
          onPointerDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
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

          <div className="border-t border-border/65 py-2">
            <p className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{copy.navigation}</p>
            <div className="space-y-1">
              {navGroups.map((group) => (
                <details className="group min-w-0 rounded-md" key={group.id} open={group.items.some((item) => item.id === page)}>
                  <summary className="flex h-8 cursor-pointer list-none items-center justify-between rounded-md px-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground [&::-webkit-details-marker]:hidden">
                    <span>{group.label}</span>
                    <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="grid gap-0.5 pb-1 pl-1">
                    {group.items.map((item) => (
                      <button
                        aria-current={page === item.id ? "page" : undefined}
                        className={cn(
                          "flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors",
                          page === item.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                        )}
                        key={item.id}
                        onClick={() => navigate(item.id)}
                        type="button"
                      >
                        <span className="shrink-0 [&_svg]:size-4">{item.icon}</span>
                        <span className="min-w-0 truncate font-medium">{item.label}</span>
                      </button>
                    ))}
                  </div>
                </details>
              ))}
            </div>
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
