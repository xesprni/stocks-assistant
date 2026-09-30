import { ReauthDialog } from "@/components/ReauthDialog";
import { useConfirmDialog } from "@/components/common/ConfirmDialog";
import { useToast } from "@/components/common/Toast";
import { DashboardMobileChatDock } from "@/components/shell/DashboardMobileChatDock";
import { Header } from "@/components/shell/Header";
import { PageFallback } from "@/components/shell/PageFallback";
import { getNavigationGroups } from "@/components/shell/navigation";
import { useChatRunController } from "@/hooks/useChatRunController";
import { CHAT_AUTO_SCROLL_THRESHOLD, useConversations } from "@/hooks/useConversations";
import { useMarketConfig } from "@/hooks/useMarketConfig";
import { formatTemplate, getMessages, i18n, normalizeLanguage } from "@/i18n";
import { I18nProvider } from "@/i18n/react";
import {
  loadConfig,
  saveConfig,
  trackProductEvent,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toDraft } from "@/lib/config";
import { createConfigAutosave, type ConfigSaveState } from "@/lib/config-autosave";
import { CONFIG_PAYLOAD_KEYS_BY_DRAFT_KEY, PERSONAL_CONFIG_PAYLOAD_KEYS } from "@/lib/config-fields";
import { parseJsonObject } from "@/lib/json";
import { readStoredText, readStoredValue, writeStoredBoolean, writeStoredValue } from "@/lib/local-storage";
import { companyRouteFromPath, configTabFromPath, DEFAULT_PAGE_PERMISSION, normalizeRoutePath, pageFromPath, pathForCompany, pathForPage } from "@/lib/routes";
import { effectiveTheme, isMobileShellViewport, isTheme, systemTheme } from "@/lib/shell-layout";
import { useThemeColor } from "@/lib/theme-color";
import { cn } from "@/lib/utils";
import type { CompanyTab } from "@/pages/CompanyWorkspacePage";
import type { ConfigTab } from "@/pages/ConfigPage";
import type {
  AppConfig,
  ConfigDraft,
  LongbridgeOAuthStatus
} from "@/types/app";
import type { EffectiveTheme, Page, Theme } from "@/types/ui";
import {
  Loader2,
  ShieldCheck
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";

const ChatPage = lazy(() => import("@/pages/ChatPage").then((module) => ({ default: module.ChatPage })));

const AuthPage = lazy(() => import("@/pages/AuthPage").then((module) => ({ default: module.AuthPage })));

const ConfigPage = lazy(() => import("@/pages/ConfigPage").then((module) => ({ default: module.ConfigPage })));

const DashboardPage = lazy(() => import("@/pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));

const CompanyWorkspacePage = lazy(() => import("@/pages/CompanyWorkspacePage").then((module) => ({ default: module.CompanyWorkspacePage })));

const SchedulerPage = lazy(() => import("@/pages/SchedulerPage").then((module) => ({ default: module.SchedulerPage })));

const FinancialReportsPage = lazy(() => import("@/components/FinancialReportsPage").then((module) => ({ default: module.FinancialReportsPage })));

const KnowledgePage = lazy(() => import("@/pages/KnowledgePage").then((module) => ({ default: module.KnowledgePage })));

const MCPPage = lazy(() => import("@/pages/MCPPage").then((module) => ({ default: module.MCPPage })));

const MemoryPage = lazy(() => import("@/pages/MemoryPage").then((module) => ({ default: module.MemoryPage })));

const NewsPage = lazy(() => import("@/pages/NewsPage").then((module) => ({ default: module.NewsPage })));

const PortfolioPage = lazy(() => import("@/components/PortfolioPage").then((module) => ({ default: module.PortfolioPage })));

const SecurityPage = lazy(() => import("@/pages/SecurityPage").then((module) => ({ default: module.SecurityPage })));

const SkillsPage = lazy(() => import("@/pages/SkillsPage").then((module) => ({ default: module.SkillsPage })));

const SubAgentsPage = lazy(() => import("@/pages/SubAgentsPage").then((module) => ({ default: module.SubAgentsPage })));

const TracingPage = lazy(() => import("@/pages/TracingPage").then((module) => ({ default: module.TracingPage })));

const UsersPage = lazy(() => import("@/pages/UsersPage").then((module) => ({ default: module.UsersPage })));

const WatchlistPage = lazy(() => import("@/pages/WatchlistPage").then((module) => ({ default: module.WatchlistPage })));

const MOBILE_HEADER_VISIBLE_KEY = "stocks-assistant-mobile-header-visible";

const LEGACY_MOBILE_CHROME_HIDDEN_KEY = "stocks-assistant-mobile-chrome-hidden";

function isChatScrolledToBottom(element: HTMLDivElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= CHAT_AUTO_SCROLL_THRESHOLD;
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
  return <ConsoleApp key={auth.user.id} />;
}

function ConsoleApp() {
  const auth = useAuth();
  const { showToast } = useToast();
  const [page, setPage] = useState<Page>(() => pageFromPath(window.location.pathname));
  const [companyRoute, setCompanyRoute] = useState(() => companyRouteFromPath(window.location.pathname) ?? { symbol: "AAPL.US", tab: "chart" as CompanyTab });
  const [selectedSymbol, setSelectedSymbol] = useState<string>("");
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = readStoredValue("stocks-assistant-theme", ["system", "dark", "light"], "system");
    return isTheme(stored) ? stored : "system";
  });
  const [systemPreference, setSystemPreference] = useState<EffectiveTheme>(() => systemTheme());
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [draft, setDraft] = useState<ConfigDraft | null>(null);
  const [configState, setConfigState] = useState<ConfigSaveState>("idle");
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
  const configAutosaveRef = useRef<ReturnType<typeof createConfigAutosave> | null>(null);
  const persistConfigRef = useRef(persistConfigChanges);
  persistConfigRef.current = persistConfigChanges;
  const routeReadyRef = useRef(false);
  const chatHistory = useConversations();
  const confirmDialog = useConfirmDialog();
  const language = normalizeLanguage(draft?.app_language ?? config?.app_language);
  useThemeColor(draft?.app_theme_color ?? config?.app_theme_color);
  const ui = i18n[language];
  const marketSettings = useMarketConfig(language, auth.can("market:read"), auth.can("market:write"));
  const configSuccessRef = useRef(() => showConfigToast("success", ui.config.saved));
  configSuccessRef.current = () => showConfigToast("success", ui.config.saved);
  const configErrorRef = useRef((caught: unknown) => {
    showConfigToast("error", caught instanceof Error ? caught.message : ui.config.saveFailed);
  });
  configErrorRef.current = (caught) => {
    showConfigToast("error", caught instanceof Error ? caught.message : ui.config.saveFailed);
  };

  const messages = chatHistory.activeConversation?.messages ?? [];
  const activeConvId = chatHistory.activeId;
  const { prompt, setPrompt, activeIsSending, canSteer, handleSend, handleStopStreaming,
    handleCancelInput, handleResumeInputQueue, isInputBusy, inputError, inputRetryMode } = useChatRunController({
      chatHistory, language, productAnalyticsEnabled: config?.product_analytics_enabled === true,
      onSendStart(resuming) {
        shouldAutoScrollChatRef.current = true;
        if (!resuming) handleNavigate("overview");
      },
    });
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
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
    document.documentElement.style.colorScheme = resolvedTheme;
    writeStoredValue("stocks-assistant-theme", theme);
  }, [resolvedTheme, theme]);

  useEffect(() => {
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
    const autosave = createConfigAutosave({
      persist: (source, patch) => persistConfigRef.current(source, patch),
      toDraft,
      onDraft: setDraft,
      onSaved: setConfig,
      onState: setConfigState,
      onError: (caught) => configErrorRef.current(caught),
      onPersisted: () => configSuccessRef.current(),
      canSave: () => !document.getElementById("config-form")?.querySelector("input:invalid, textarea:invalid, select:invalid"),
    });
    configAutosaveRef.current = autosave;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!autosave.isDirty()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      autosave.dispose();
      window.removeEventListener("beforeunload", beforeUnload);
      if (configAutosaveRef.current === autosave) configAutosaveRef.current = null;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      const [configResult] = await Promise.allSettled([loadConfig()]);
      if (!mounted) return;

      if (configResult.status === "fulfilled") {
        configAutosaveRef.current?.acceptSaved(configResult.value);
      } else {
        const message = configResult.reason instanceof Error ? configResult.reason.message : (getMessages(language).shell.loadConfigFailed);
        showToast({ kind: "error", message, title: getMessages(language).shell.configuration });
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
      app_theme_color: source.app_theme_color,
      auth_max_devices_per_user: Number(source.auth_max_devices_per_user) || 5,
      agent_max_steps: Number(source.agent_max_steps),
      agent_max_context_tokens: Number(source.agent_max_context_tokens),
      agent_max_context_turns: Number(source.agent_max_context_turns),
      agent_tool_allowlist: source.agent_tool_allowlist,
      agent_allow_all_mcp_tools: source.agent_allow_all_mcp_tools,
      multi_agent_enabled: source.multi_agent_enabled,
      multi_agent_max_parallel_agents: Number(source.multi_agent_max_parallel_agents),
      multi_agent_max_tasks_per_batch: Number(source.multi_agent_max_tasks_per_batch ?? 12),
      multi_agent_task_timeout_seconds: Number(source.multi_agent_task_timeout_seconds ?? 180),
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
      longbridge_auth_mode: source.longbridge_auth_mode ?? "apikey",
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
    if (source.search_api_key.trim()) {
      payload.search_api_key = source.search_api_key.trim();
    }
    return Object.fromEntries(
      Object.entries(payload).filter(([key]) => shouldInclude(key)),
    );
  }

  function showConfigToast(kind: "success" | "error", message: string) {
    showToast({ kind, message, title: ui.config.title });
  }

  async function persistConfigChanges(source: ConfigDraft, patch: Partial<ConfigDraft>) {
    const changedKeys = Object.keys(patch) as Array<keyof ConfigDraft>;
    if (changedKeys.length === 0) return null;
    const payload = buildConfigPayload(source, changedKeys);
    return Object.keys(payload).length ? saveConfig(payload) : null;
  }

  function handleSaveConfig() {
    const invalid = document.getElementById("config-form")?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input:invalid, textarea:invalid, select:invalid");
    if (invalid) { invalid.reportValidity(); return; }
    void configAutosaveRef.current?.flush();
    marketSettings.editor.onSave();
  }

  function patchDraft(patch: Partial<ConfigDraft>) {
    configAutosaveRef.current?.patch(patch);
  }

  function applySavedConfig(next: AppConfig) {
    configAutosaveRef.current?.acceptSaved(next);
  }

  function applyLongbridgeOAuthStatus(status: LongbridgeOAuthStatus, replaceDraftMode = false) {
    configAutosaveRef.current?.acceptSavedPatch({
      longbridge_auth_mode: status.auth_mode,
      longbridge_oauth_connected: status.status === "connected",
      longbridge_oauth_client_id: status.client_id,
    }, replaceDraftMode ? ["longbridge_auth_mode"] : []);
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

  function openCompany(symbol: string, tab: CompanyTab = "chart") {
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
      handleStopStreaming={() => { void handleStopStreaming(); }}
      isSending={activeIsSending}
      canSteer={canSteer}
      isInputBusy={isInputBusy}
      inputError={inputError}
      inputRetryMode={inputRetryMode}
      handleCancelInput={handleCancelInput}
      handleResumeInputQueue={handleResumeInputQueue}
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
      chatHistory={chatHistory}
      setPrompt={setPrompt}
    />
  );

  return (
    <I18nProvider language={language}>
      <div className={cn("console-shell h-[100dvh] overflow-hidden", activePage === "watchlist" && "console-shell-watchlist")}>
        <a className="skip-link" href="#main-content">{getMessages(language).shell.skipToContent}</a>
        {confirmDialog.dialog}
        <ReauthDialog />
        <div className="app-frame flex h-full min-h-0 w-full flex-col gap-0 p-0">
          <button
            aria-hidden={isMobileHeaderVisible}
            aria-label={getMessages(language).shell.showHeader}
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
                    marketConfig={marketSettings.savedConfig}
                    onOpenMarketConfig={() => openConfig("market")}
                    onOpenPortfolio={() => handleNavigate("portfolio")}
                    onOpenWatchlist={() => handleNavigate("watchlist")}
                    refreshInterval={marketSettings.savedConfig?.refresh_interval ?? 60}
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
                    language={language}
                    onSymbolChange={(symbol) => openCompany(symbol, "chart")}
                    onNavigateTab={(tab) => setCompanyRoute((current) => ({ ...current, tab }))}
                    onOpenPortfolio={() => handleNavigate("portfolio")}
                    symbol={companyRoute.symbol}
                    tab={companyRoute.tab}
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
                    refreshInterval={marketSettings.savedConfig?.refresh_interval ?? 60}
                    onOpenFinancials={(symbol) => {
                      openCompany(symbol, "financials");
                    }}
                  />
                ) : null}

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

                {activePage === "scheduler" ? <SchedulerPage confirmAction={confirmDialog.confirm} language={language} telegramEnabled={Boolean(config?.telegram_enabled)} /> : null}

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
                    onConfigBlur={handleSaveConfig}
                    onConfigCompositionStart={() => configAutosaveRef.current?.compositionStart()}
                    onConfigCompositionEnd={() => configAutosaveRef.current?.compositionEnd()}
                    onLongbridgeAuthChanged={applyLongbridgeOAuthStatus}
                    initialTab={configInitialTab}
                    language={language}
                    marketSettings={marketSettings.editor}
                    patchDraft={patchDraft}
                    setDraft={() => { configAutosaveRef.current?.reset(); marketSettings.reset(); }}
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
    </I18nProvider>
  );
}

export default App;
