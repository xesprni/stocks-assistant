import {
  CODEX_DEFAULT_MODEL,
  CODEX_OAUTH_API_BASE,
  EMBEDDING_DEFAULT_MODEL,
  isCompatibleBase,
  isMcpToolName,
  OPENAI_API_BASE,
  type ConfigTab,
  type SettingsTab,
} from "@/components/config/settings-model";
import type { AppLanguage } from "@/i18n";
import { formatTemplate, getMessages, i18n } from "@/i18n";
import { getConfigReadiness, listTools, seedDemoData, sendTelegramTestMessage, testConfigConnection } from "@/lib/api";
import { toDraft } from "@/lib/config";
import type { MarketConfigEditor } from "@/lib/market-config-controller";
import { MAX_TELEGRAM_PHOTOS, parseTelegramPhotos } from "@/lib/telegram";
import type { AppConfig, ConfigDraft, ConfigReadinessResponse, LongbridgeOAuthStatus, ToolInfo } from "@/types/app";
import { Bot, Cpu, LayoutDashboard, LockKeyhole, MessageCircle, Plug, SlidersHorizontal, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
export type ConfigPageProps = {
  canManageSystem: boolean;
  canReadMarket: boolean;
  canWriteMarket: boolean;
  config: AppConfig | null;
  configState: "idle" | "pending" | "saving" | "saved" | "error";
  draft: ConfigDraft | null;
  enabledCount: number;
  handleSaveConfig: () => void;
  initialTab?: ConfigTab;
  language: AppLanguage;
  onConfigBlur: () => void;
  onConfigCompositionStart: () => void;
  onConfigCompositionEnd: () => void;
  onLongbridgeAuthChanged: (status: LongbridgeOAuthStatus, replaceDraftMode?: boolean) => void;
  marketSettings: MarketConfigEditor;
  patchDraft: (patch: Partial<ConfigDraft>) => void;
  setDraft: (draft: ConfigDraft) => void;
};
export function useSettings({
  canManageSystem,
  canReadMarket,
  canWriteMarket,
  config,
  configState: appConfigState,
  draft,
  enabledCount,
  handleSaveConfig,
  initialTab,
  language,
  onConfigBlur,
  onConfigCompositionStart,
  onConfigCompositionEnd,
  onLongbridgeAuthChanged,
  marketSettings,
  patchDraft,
  setDraft,
}: ConfigPageProps) {

  const configState = (["error", "saving", "pending", "saved", "idle"] as const)
    .find((state) => state === appConfigState || state === marketSettings.saveState) ?? "idle";
  const copy = i18n[language].config;

  const layoutCopy = copy.settingsLayout;

  const defaultTab = initialTab === "market" && !canReadMarket ? "model" : initialTab ?? "model";

  const [activeTab, setActiveTab] = useState<SettingsTab>(defaultTab);

  const [wideNavigation, setWideNavigation] = useState(() => window.matchMedia("(min-width: 1024px)").matches);

  const [telegramTestMessage, setTelegramTestMessage] = useState(copy.telegramTestDefault);

  const [telegramTestPhotos, setTelegramTestPhotos] = useState("");

  const [telegramTestState, setTelegramTestState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const [telegramTestResult, setTelegramTestResult] = useState("");

  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false);

  const [tools, setTools] = useState<ToolInfo[]>([]);

  const [isLoadingTools, setIsLoadingTools] = useState(false);

  const [expandedMcpServers, setExpandedMcpServers] = useState<Record<string, boolean>>({});

  const [compatibleSnapshot, setCompatibleSnapshot] = useState({ apiBase: "", model: "" });

  const [readiness, setReadiness] = useState<ConfigReadinessResponse | null>(null);

  const [readinessLoading, setReadinessLoading] = useState(false);

  const [testingComponent, setTestingComponent] = useState<string | null>(null);

  const [connectionMessage, setConnectionMessage] = useState("");

  const [demoDataLoading, setDemoDataLoading] = useState(false);

  const hasChanges = useMemo(() => Boolean(config && draft && JSON.stringify(draft) !== JSON.stringify(toDraft(config))), [config, draft]);

  const navigationGroups: { label: string; items: { value: SettingsTab; label: string; description: string; icon: ReactNode }[] }[] = [
    {
      label: layoutCopy.workspace,
      items: [
        { value: "overview", label: layoutCopy.overview, description: layoutCopy.overviewHint, icon: <LayoutDashboard /> },
        { value: "model", label: copy.modelTab, description: copy.modelSectionHint, icon: <Cpu /> },
        { value: "agent", label: copy.agentTab, description: copy.agentRuntimeHint, icon: <Bot /> },
      ],
    },
    {
      label: layoutCopy.integrations,
      items: [
        { value: "longbridge", label: copy.longbridgeTab, description: layoutCopy.dataSourcesHint, icon: <Plug /> },
        ...(canReadMarket ? [{ value: "market" as const, label: copy.marketTab, description: layoutCopy.marketHint, icon: <TrendingUp /> }] : []),
        { value: "channels", label: copy.channelsTab, description: copy.telegramChannelHint, icon: <MessageCircle /> },
      ],
    },
    {
      label: layoutCopy.accountPreferences,
      items: [
        { value: "features", label: layoutCopy.preferences, description: copy.personalPreferencesHint, icon: <SlidersHorizontal /> },
        { value: "security", label: copy.accountSecurity, description: copy.accountSecurityHint, icon: <LockKeyhole /> },
      ],
    },
  ];

  const activeSection = navigationGroups.flatMap((group) => group.items).find((item) => item.value === activeTab);

  useEffect(() => {
    setActiveTab(defaultTab);
  }, [defaultTab]);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const updateNavigation = () => setWideNavigation(query.matches);
    query.addEventListener("change", updateNavigation);
    return () => query.removeEventListener("change", updateNavigation);
  }, []);

  const dangerousTools = ["bash", "write_file", "scheduler", "watchlist", "portfolio"];

  const builtinTools = useMemo(() => tools.filter((tool) => !isMcpToolName(tool.name)), [tools]);

  const mcpToolGroups = useMemo(() => {
    const groups: Record<string, ToolInfo[]> = {};
    for (const tool of tools) {
      if (!isMcpToolName(tool.name)) continue;
      const server = tool.server_name || tool.name.replace(/^mcp_/, "").split("_")[0] || "mcp";
      groups[server] = [...(groups[server] ?? []), tool];
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [tools]);

  const selectedTools = useMemo(() => {
    const available = new Set(tools.map((tool) => tool.name));
    const selected = new Set((draft?.agent_tool_allowlist ?? []).filter((name) => available.has(name)));
    if (draft?.agent_allow_all_mcp_tools) {
      for (const tool of tools) {
        if (isMcpToolName(tool.name)) selected.add(tool.name);
      }
    }
    return selected;
  }, [draft?.agent_allow_all_mcp_tools, draft?.agent_tool_allowlist, tools]);

  const llmProvider = draft?.llm_provider === "openai_responses" ? "openai_responses" : "openai_compatible";

  const isCodexOAuth = llmProvider === "openai_responses" && draft?.llm_auth_mode === "codex";

  const isEmbeddingCodexOAuth = draft?.embedding_auth_mode === "codex";

  const reasoningEffortLabels = {
    minimal: copy.reasoningEffortMinimal,
    low: copy.reasoningEffortLow,
    medium: copy.reasoningEffortMedium,
    high: copy.reasoningEffortHigh,
  };

  const toolChoiceLabels = {
    auto: copy.toolChoiceAuto,
    none: copy.toolChoiceNone,
    required: copy.toolChoiceRequired,
  };

  useEffect(() => {
    setTelegramTestMessage((current) => (
      current === i18n.zh.config.telegramTestDefault || current === i18n.en.config.telegramTestDefault
        ? copy.telegramTestDefault
        : current
    ));
  }, [copy.telegramTestDefault]);

  useEffect(() => {
    if (!canManageSystem) {
      setTools([]);
      return;
    }
    setIsLoadingTools(true);
    listTools()
      .then((res) => setTools(res.tools))
      .catch(() => setTools([]))
      .finally(() => setIsLoadingTools(false));
  }, [canManageSystem]);

  useEffect(() => {
    if (!config) return;
    setReadinessLoading(true);
    getConfigReadiness()
      .then(setReadiness)
      .catch(() => setReadiness(null))
      .finally(() => setReadinessLoading(false));
  }, [config]);

  useEffect(() => {
    if (mcpToolGroups.length === 0) return;
    setExpandedMcpServers((current) => {
      const next = { ...current };
      for (const [server] of mcpToolGroups) {
        if (!(server in next)) next[server] = false;
      }
      return next;
    });
  }, [mcpToolGroups]);

  useEffect(() => {
    if (!draft || isCodexOAuth) return;
    setCompatibleSnapshot({
      apiBase: draft.llm_api_base || OPENAI_API_BASE,
      model: draft.llm_model || "",
    });
  }, [draft?.llm_api_base, draft?.llm_model, draft, isCodexOAuth]);

  async function handleTelegramTest() {
    const photos = parseTelegramPhotos(telegramTestPhotos);
    if ((!telegramTestMessage.trim() && !photos.length) || photos.length > MAX_TELEGRAM_PHOTOS) return;
    setTelegramTestState("sending");
    setTelegramTestResult("");
    try {
      const res = await sendTelegramTestMessage({ message: telegramTestMessage.trim(), photos });
      setTelegramTestState("sent");
      setTelegramTestResult(res.photos
        ? formatTemplate(copy.telegramTestSentPhotos, { chunks: res.chunks, photos: res.photos })
        : res.chunks > 1 ? formatTemplate(copy.telegramTestSentChunks, { chunks: res.chunks }) : copy.telegramTestSent);
    } catch (caught) {
      setTelegramTestState("error");
      setTelegramTestResult(caught instanceof Error ? caught.message : copy.telegramTestFailed);
    }
  }

  async function handleConnectionTest(component: "llm" | "embedding" | "longbridge") {
    setTestingComponent(component);
    setConnectionMessage("");
    try {
      const result = await testConfigConnection(component);
      setConnectionMessage(result.detail);
      setReadiness((current) => current ? {
        ...current,
        checks: current.checks.map((check) => check.component === component ? { ...check, configured: true, status: "ready", detail: result.detail } : check),
      } : current);
    } catch (caught) {
      setConnectionMessage(caught instanceof Error ? caught.message : (getMessages(language).settings.connectionFailed));
    } finally {
      setTestingComponent(null);
    }
  }

  async function handleSeedDemoData() {
    setDemoDataLoading(true);
    setConnectionMessage("");
    try {
      const result = await seedDemoData();
      setConnectionMessage(
        formatTemplate(getMessages(language).settings.sampleDataCreated, { result_detail: result.detail, result_watchlist_created: result.watchlist_created, result_portfolio_created: result.portfolio_created }),
      );
    } catch (caught) {
      setConnectionMessage(caught instanceof Error ? caught.message : (getMessages(language).settings.sampleDataFailed));
    } finally {
      setDemoDataLoading(false);
    }
  }

  function toggleAgentTool(name: string) {
    if (!draft) return;
    const allowlist = new Set(draft.agent_tool_allowlist ?? []);
    if (allowlist.has(name)) {
      allowlist.delete(name);
    } else {
      allowlist.add(name);
    }
    patchDraft({ agent_tool_allowlist: Array.from(allowlist).sort() });
  }

  function selectAllBuiltinTools() {
    if (!draft) return;
    const allowlist = new Set(draft.agent_tool_allowlist ?? []);
    for (const tool of builtinTools) allowlist.add(tool.name);
    patchDraft({ agent_tool_allowlist: Array.from(allowlist).sort() });
  }

  function selectLlmProvider(provider: "openai_compatible" | "openai_responses") {
    if (provider === "openai_responses") {
      if (draft && !isCodexOAuth) {
        setCompatibleSnapshot({
          apiBase: isCompatibleBase(draft.llm_api_base) ? draft.llm_api_base : compatibleSnapshot.apiBase,
          model: draft.llm_model || compatibleSnapshot.model,
        });
      }
      patchDraft({
        llm_provider: provider,
        llm_auth_mode: "codex",
        llm_codex_api_base: draft?.llm_codex_api_base || CODEX_OAUTH_API_BASE,
        llm_codex_model: draft?.llm_codex_model || CODEX_DEFAULT_MODEL,
      });
      return;
    }
    const nextApiBase = isCompatibleBase(draft?.llm_api_base)
      ? draft.llm_api_base
      : isCompatibleBase(compatibleSnapshot.apiBase)
        ? compatibleSnapshot.apiBase
        : OPENAI_API_BASE;
    const nextModel = draft?.llm_model && draft.llm_model !== CODEX_DEFAULT_MODEL
      ? draft.llm_model
      : compatibleSnapshot.model && compatibleSnapshot.model !== CODEX_DEFAULT_MODEL
        ? compatibleSnapshot.model
        : "gpt-4o";
    patchDraft({
      llm_provider: provider,
      llm_auth_mode: "api_key",
      llm_api_base: nextApiBase,
      llm_model: nextModel,
    });
  }

  function selectEmbeddingProvider(mode: "api_key" | "codex") {
    if (mode === "codex") {
      patchDraft({
        embedding_auth_mode: "codex",
        embedding_codex_api_base: draft?.embedding_codex_api_base || CODEX_OAUTH_API_BASE,
        embedding_codex_model: draft?.embedding_codex_model || EMBEDDING_DEFAULT_MODEL,
      });
      return;
    }
    patchDraft({ embedding_auth_mode: "api_key" });
  }
  return {
    canManageSystem, canReadMarket, canWriteMarket, config, configState,
    draft, enabledCount, handleSaveConfig, initialTab, language,
    onConfigBlur, onConfigCompositionStart, onConfigCompositionEnd, onLongbridgeAuthChanged, marketSettings,
    patchDraft, setDraft, copy, layoutCopy, hasChanges,
    setActiveTab, wideNavigation, activeTab, navigationGroups, activeSection,
    readinessLoading, readiness, testingComponent, handleConnectionTest, connectionMessage,
    demoDataLoading, handleSeedDemoData, setIsPasswordDialogOpen, isCodexOAuth, selectLlmProvider,
    isEmbeddingCodexOAuth, selectEmbeddingProvider, reasoningEffortLabels, toolChoiceLabels, builtinTools,
    dangerousTools, expandedMcpServers, isLoadingTools, mcpToolGroups, selectAllBuiltinTools,
    setExpandedMcpServers, toggleAgentTool, selectedTools, telegramTestMessage, setTelegramTestMessage,
    setTelegramTestState, setTelegramTestResult, telegramTestPhotos, setTelegramTestPhotos, telegramTestState,
    handleTelegramTest, telegramTestResult, isPasswordDialogOpen,
  };
}
export type ConfigPageState = ReturnType<typeof useSettings>;
