import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  BarChart2,
  BookOpen,
  Bot,
  BrainCircuit,
  BriefcaseBusiness,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Cpu,
  Database,
  FileText,
  Home,
  Loader2,
  MessageSquareText,
  Monitor,
  Moon,
  Plug,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Star,
  Sun,
  TrendingUp,
  WandSparkles,
  Zap,
} from "lucide-react";

import { MarketPulse } from "@/components/MarketPulse";
import { StatusTile } from "@/components/common/StatusTile";
import { useConfirmDialog } from "@/components/common/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  checkHealth,
  getMarketConfig,
  loadConfig,
  saveConfig,
  streamChat,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { toDraft } from "@/lib/config";
import { parseJsonObject } from "@/lib/json";
import { createInitialMessages, formatTemplate, i18n, localeFor, normalizeLanguage } from "@/lib/i18n";
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
const ConfigPage = lazy(() => import("@/pages/ConfigPage").then((module) => ({ default: module.ConfigPage })));
const FinancialReportsPage = lazy(() => import("@/components/FinancialReportsPage").then((module) => ({ default: module.FinancialReportsPage })));
const KnowledgePage = lazy(() => import("@/pages/KnowledgePage").then((module) => ({ default: module.KnowledgePage })));
const MarketConfigPage = lazy(() => import("@/components/MarketConfigPage").then((module) => ({ default: module.MarketConfigPage })));
const MarketDashboard = lazy(() => import("@/components/MarketDashboard").then((module) => ({ default: module.MarketDashboard })));
const MCPPage = lazy(() => import("@/pages/MCPPage").then((module) => ({ default: module.MCPPage })));
const MemoryPage = lazy(() => import("@/pages/MemoryPage").then((module) => ({ default: module.MemoryPage })));
const PortfolioPage = lazy(() => import("@/components/PortfolioPage").then((module) => ({ default: module.PortfolioPage })));
const SchedulerPage = lazy(() => import("@/pages/SchedulerPage").then((module) => ({ default: module.SchedulerPage })));
const SkillsPage = lazy(() => import("@/pages/SkillsPage").then((module) => ({ default: module.SkillsPage })));
const SubAgentsPage = lazy(() => import("@/pages/SubAgentsPage").then((module) => ({ default: module.SubAgentsPage })));
const TechnicalAnalysis = lazy(() => import("@/components/TechnicalAnalysis"));
const TracingPage = lazy(() => import("@/pages/TracingPage").then((module) => ({ default: module.TracingPage })));
const WatchlistPage = lazy(() => import("@/pages/WatchlistPage").then((module) => ({ default: module.WatchlistPage })));

type NavItem = { id: Page; label: string; icon: ReactNode; hint: string };
type NavGroup = { id: string; label: string; items: NavItem[] };

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

// ── Chat History ───────────────────────────────────────────────────────────

function App() {
  const [page, setPage] = useState<Page>("chat");
  const [selectedSymbol, setSelectedSymbol] = useState<string>("");
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = window.localStorage.getItem("stocks-assistant-theme");
    return isTheme(stored) ? stored : "system";
  });
  const [systemPreference, setSystemPreference] = useState<EffectiveTheme>(() => systemTheme());
  const [prompt, setPrompt] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isNavCollapsed, setIsNavCollapsed] = useState(() => {
    const defaultExpandedKey = "stocks-assistant-nav-default-expanded-v2";
    if (window.localStorage.getItem(defaultExpandedKey) !== "true") {
      window.localStorage.setItem(defaultExpandedKey, "true");
      window.localStorage.setItem("stocks-assistant-nav-collapsed", "false");
      return false;
    }
    return window.localStorage.getItem("stocks-assistant-nav-collapsed") === "true";
  });
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [draft, setDraft] = useState<ConfigDraft | null>(null);
  const [health, setHealth] = useState<"checking" | "online" | "offline">("checking");
  const [configState, setConfigState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const [marketConfig, setMarketConfig] = useState<MarketDashboardConfig>({ indices: [], refresh_interval: 60 });
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollChatRef = useRef(true);
  const streamAbortRef = useRef<AbortController | null>(null);
  const chatHistory = useConversations();
  const confirmDialog = useConfirmDialog();
  const language = normalizeLanguage(draft?.app_language ?? config?.app_language);
  const ui = i18n[language];
  const quickPrompts = ui.quickPrompts;

  const messages = chatHistory.activeConversation?.messages.length
    ? chatHistory.activeConversation.messages
    : createInitialMessages(language);
  const activeConvId = chatHistory.activeId;

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
    window.localStorage.setItem("stocks-assistant-theme", theme);
  }, [resolvedTheme, theme]);

  useEffect(() => {
    window.localStorage.setItem("stocks-assistant-nav-collapsed", String(isNavCollapsed));
  }, [isNavCollapsed]);

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

  const modelName = config?.llm_model ?? ui.shell.notConfigured;
  const enabledCount = useMemo(() => {
    if (!config) return 0;
    return [config.memory_enabled, config.knowledge_enabled, config.scheduler_enabled, config.tracing_enabled].filter(Boolean).length;
  }, [config]);

  async function handleSend(event?: { preventDefault: () => void }, value = prompt) {
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

    let convId = activeConvId;
    let assistantMessageId = pendingMessage.id;
    let streamedContent = "";
    let currentStatus = ui.chat.connecting;
    let trace = pendingMessage.trace ?? [];
    let sawAgentEnd = false;
    const abortController = new AbortController();
    streamAbortRef.current = abortController;

    try {
      if (!convId) {
        convId = await chatHistory.createConversation(userMessage);
        chatHistory.addMessage(convId, pendingMessage);
      } else {
        chatHistory.addMessage(convId, userMessage);
        chatHistory.addMessage(convId, pendingMessage);
      }

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
      }, false, abortController.signal);

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
      const msg = caught instanceof Error ? caught.message : (language === "en" ? "Chat request failed" : "对话请求失败");
      setError(msg);
      if (convId) {
        chatHistory.updateMessage(convId, pendingMessage.id, {
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

  async function handleSaveConfig() {
    if (!draft) return;

    setConfigState("saving");
    setError("");

    try {
      const mcpServers = parseJsonObject(draft.mcp_servers_text || "{}", "MCP Servers JSON") as Record<string, Record<string, unknown>>;
      const payload: Record<string, unknown> = {
        llm_api_base: draft.llm_api_base,
        llm_model: draft.llm_model,
        embedding_api_base: draft.embedding_api_base,
        embedding_model: draft.embedding_model,
        embedding_provider: draft.embedding_provider,
        workspace_dir: draft.workspace_dir,
        app_language: draft.app_language,
        agent_max_steps: Number(draft.agent_max_steps),
        agent_max_context_tokens: Number(draft.agent_max_context_tokens),
        agent_max_context_turns: Number(draft.agent_max_context_turns),
        multi_agent_enabled: draft.multi_agent_enabled,
        multi_agent_max_parallel_agents: Number(draft.multi_agent_max_parallel_agents),
        multi_agent_default_max_steps: Number(draft.multi_agent_default_max_steps),
        multi_agent_max_depth: Number(draft.multi_agent_max_depth),
        multi_agent_dangerous_tools: draft.multi_agent_dangerous_tools,
        multi_agent_roles: draft.multi_agent_roles,
        knowledge_enabled: draft.knowledge_enabled,
        memory_enabled: draft.memory_enabled,
        memory_auto_curate_enabled: draft.memory_auto_curate_enabled,
        memory_curator_min_importance: Number(draft.memory_curator_min_importance),
        memory_curator_min_confidence: Number(draft.memory_curator_min_confidence),
        scheduler_enabled: draft.scheduler_enabled,
        tracing_enabled: draft.tracing_enabled,
        telegram_enabled: draft.telegram_enabled,
        telegram_chat_id: draft.telegram_chat_id ?? "",
        telegram_api_base: draft.telegram_api_base ?? "https://api.telegram.org",
        telegram_parse_mode: draft.telegram_parse_mode ?? "",
        debug: draft.debug,
        system_prompt: draft.system_prompt,
        mcp_servers: mcpServers,
        mcp_tool_timeout_seconds: Number(draft.mcp_tool_timeout_seconds) || 60,
        longbridge_http_url: draft.longbridge_http_url ?? "",
        longbridge_quote_ws_url: draft.longbridge_quote_ws_url ?? "",
      };

      if (draft.llm_api_key.trim()) {
        payload.llm_api_key = draft.llm_api_key.trim();
      }
      if (draft.embedding_api_key.trim()) {
        payload.embedding_api_key = draft.embedding_api_key.trim();
      }
      if (draft.telegram_bot_token.trim()) {
        payload.telegram_bot_token = draft.telegram_bot_token.trim();
      }
      if (draft.longbridge_app_key.trim()) {
        payload.longbridge_app_key = draft.longbridge_app_key.trim();
      }
      if (draft.longbridge_app_secret.trim()) {
        payload.longbridge_app_secret = draft.longbridge_app_secret.trim();
      }
      if (draft.longbridge_access_token.trim()) {
        payload.longbridge_access_token = draft.longbridge_access_token.trim();
      }

      const next = await saveConfig(payload);
      setConfig(next);
      setDraft(toDraft(next));
      setConfigState("saved");
      window.setTimeout(() => setConfigState("idle"), 1400);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : ui.config.saveFailed;
      setError(message);
      setConfigState("error");
    }
  }

  function patchDraft(patch: Partial<ConfigDraft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
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
      <div className="app-frame flex h-full w-full flex-col gap-0 p-0">
        <Header
          health={health}
          language={language}
          modelName={modelName}
          onThemeChange={setTheme}
          resolvedTheme={resolvedTheme}
          theme={theme}
        />
        <MobileNav language={language} page={page} setPage={handleNavigate} />

        <div
          className={cn(
            "app-main-grid grid min-h-0 flex-1 gap-0 transition-[grid-template-columns] duration-200",
            isNavCollapsed ? "lg:grid-cols-[64px_minmax(0,1fr)]" : "lg:grid-cols-[220px_minmax(0,1fr)]",
          )}
        >
          <DesktopNav
            collapsed={isNavCollapsed}
            language={language}
            onToggleCollapsed={() => setIsNavCollapsed((current) => !current)}
            page={page}
            setPage={handleNavigate}
          />

          <main className="app-main-stage flex min-h-0 min-w-0 flex-col overflow-hidden border-l border-border/80 bg-background/70" key={page}>
            {error ? (
              <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            ) : null}

            <Suspense fallback={<PageFallback />}>
              {page === "overview" ? (
                <OverviewPage
                  config={config}
                  enabledCount={enabledCount}
                  language={language}
                  onOpenConfig={() => setPage("config")}
                  onPrompt={(value) => {
                    setPrompt(value);
                    setPage("chat");
                  }}
                />
              ) : null}

            {page === "chat" ? (
              <ChatPage
                chatScrollRef={chatScrollRef}
                endRef={endRef}
                handleSend={handleSend}
                handleChatScroll={handleChatScroll}
                handleStopStreaming={handleStopStreaming}
                isSending={isSending}
                language={language}
                messages={messages}
                prompt={prompt}
                quickPrompts={quickPrompts}
                chatHistory={chatHistory}
                setPage={setPage}
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
              />
            ) : null}

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

            {page === "skills" ? <SkillsPage language={language} /> : null}

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

              {page === "config" ? (
                <ConfigPage
                  config={config}
                  configState={configState}
                  draft={draft}
                  enabledCount={enabledCount}
                  handleSaveConfig={handleSaveConfig}
                  language={language}
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
  language,
  modelName,
  onThemeChange,
  resolvedTheme,
  theme,
}: {
  health: "checking" | "online" | "offline";
  language: AppLanguage;
  modelName: string;
  onThemeChange: (theme: Theme) => void;
  resolvedTheme: EffectiveTheme;
  theme: Theme;
}) {
  const themeLabels = language === "en"
    ? { system: "System", dark: "Dark", light: "Light", current: "Theme", switchTo: "Switch to", darkNow: "dark", lightNow: "light" }
    : { system: "系统", dark: "黑暗", light: "亮色", current: "主题切换，当前", switchTo: "切换到", darkNow: "黑暗", lightNow: "亮色" };
  const themeOptions: Array<{ value: Theme; label: string; icon: ReactNode }> = [
    { value: "system", label: themeLabels.system, icon: <Monitor /> },
    { value: "dark", label: themeLabels.dark, icon: <Moon /> },
    { value: "light", label: themeLabels.light, icon: <Sun /> },
  ];

  return (
    <header className="panel app-header flex shrink-0 flex-col gap-2 rounded-none border-x-0 border-t-0 px-3 py-2 shadow-none sm:px-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-lg border border-primary/40 bg-primary/10 text-primary shadow-glow sm:size-11">
          <Sparkles className="size-5" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-foreground sm:text-xl">Stocks Assistant Console</h1>
          <p className="truncate text-xs text-muted-foreground sm:text-sm">Agent chat, runtime config, market intelligence</p>
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge variant={health === "online" ? "default" : health === "checking" ? "muted" : "danger"}>
          {health === "online" ? "API ONLINE" : health === "checking" ? "CHECKING" : "API OFFLINE"}
        </Badge>
        <Badge variant="outline" className="max-w-full gap-1.5 truncate">
          <Cpu className="size-3.5" />
          <span className="truncate">{modelName}</span>
        </Badge>
        <div
          aria-label={`${themeLabels.current}${theme === "system" ? `${themeLabels.system} (${resolvedTheme === "dark" ? themeLabels.darkNow : themeLabels.lightNow})` : theme === "dark" ? themeLabels.dark : themeLabels.light}`}
          className="theme-toggle inline-flex h-7 shrink-0 items-center rounded-full border border-border bg-muted/45 p-0.5"
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
                  "grid h-6 w-7 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground [&_svg]:size-3.5",
                  active && "bg-background text-foreground shadow-sm",
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

function MobileNav({ language, page, setPage }: { language: AppLanguage; page: Page; setPage: (page: Page) => void }) {
  const navItems = getNavItems(language);
  const copy = i18n[language].shell;
  return (
    <nav className="panel app-mobile-nav flex shrink-0 gap-1 overflow-x-auto rounded-none border-x-0 border-t-0 p-1 shadow-none lg:hidden" aria-label={copy.navigation}>
      {navItems.map((item) => (
        <button
          className={cn(
            "nav-item inline-flex h-8 min-w-[82px] items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors",
            page === item.id ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:text-foreground",
          )}
          key={item.id}
          onClick={() => setPage(item.id)}
          type="button"
        >
          <span className="[&_svg]:size-3.5">{item.icon}</span>
          {item.label}
        </button>
      ))}
    </nav>
  );
}

function NavButton({
  collapsed = false,
  item,
  page,
  setPage,
}: {
  collapsed?: boolean;
  item: NavItem;
  page: Page;
  setPage: (page: Page) => void;
}) {
  return (
    <button
      aria-label={item.label}
      className={cn(
        "nav-item flex w-full items-center rounded-md text-xs transition-colors",
        collapsed ? "h-6 justify-center px-0 py-0" : "h-7 gap-1.5 px-2 text-left",
        page === item.id
          ? "bg-primary text-primary-foreground shadow-glow"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
      onClick={() => setPage(item.id)}
      title={collapsed ? `${item.label} · ${item.hint}` : undefined}
      type="button"
    >
      <span className="[&_svg]:size-3">{item.icon}</span>
      <span className={cn("min-w-0 flex-1", collapsed && "sr-only")}>
        <span className="block truncate font-medium leading-none">{item.label}</span>
        <span className="hidden truncate text-[9px] leading-[10px] opacity-70">{item.hint}</span>
      </span>
    </button>
  );
}

function DesktopNav({
  collapsed,
  language,
  onToggleCollapsed,
  page,
  setPage,
}: {
  collapsed: boolean;
  language: AppLanguage;
  onToggleCollapsed: () => void;
  page: Page;
  setPage: (page: Page) => void;
}) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const pinnedNavItems = getPinnedNavItems(language);
  const navGroups = getNavGroups(language);
  const collapsedNavItems = [...pinnedNavItems, ...navGroups.flatMap((group) => group.items)];
  const copy = i18n[language];

  function toggleGroup(groupId: string) {
    setOpenGroups((current) => ({ ...current, [groupId]: current[groupId] === false }));
  }

  return (
    <aside className="hidden min-h-0 min-w-0 bg-muted/35 lg:block">
      <div className="panel app-sidebar-surface flex h-full min-h-0 flex-col overflow-hidden rounded-none border-y-0 border-l-0 border-r shadow-none">
        <div className={cn("flex items-center gap-2 border-b border-border/80 px-2 py-2", collapsed ? "justify-center" : "justify-between")}>
          <div className={cn("min-w-0", collapsed && "sr-only")}>
            <p className="text-sm font-semibold">{copy.shell.navigation}</p>
            <p className="text-xs text-muted-foreground">{copy.shell.pageSwitch}</p>
          </div>
          <Button
            aria-label={collapsed ? copy.shell.expandNavigation : copy.shell.collapseNavigation}
            className="h-7 w-7 shrink-0"
            onClick={onToggleCollapsed}
            size="icon"
            title={collapsed ? copy.shell.expandNavigation : copy.shell.collapseNavigation}
            variant="ghost"
          >
            {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronLeft className="size-3.5" />}
          </Button>
        </div>
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-1.5" aria-label={copy.shell.navigation}>
          {collapsed ? (
            <div className="space-y-1">
              {collapsedNavItems.map((item) => (
                <NavButton collapsed item={item} key={item.id} page={page} setPage={setPage} />
              ))}
            </div>
          ) : (
            <>
              <div className="space-y-0.5">
                <p className="px-2.5 pt-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/70">{copy.groups.pinned}</p>
                {pinnedNavItems.map((item) => (
                  <NavButton item={item} key={item.id} page={page} setPage={setPage} />
                ))}
              </div>

              <div className="space-y-0.5">
                {navGroups.map((group) => {
                  const active = group.items.some((item) => item.id === page);
                  const open = active || openGroups[group.id] !== false;
                  return (
                    <div className="rounded-md border border-border/45 bg-muted/10" key={group.id}>
                      <button
                        className="flex w-full items-center justify-between gap-2 px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
                        onClick={() => toggleGroup(group.id)}
                        type="button"
                      >
                        <span>{group.label}</span>
                        {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                      </button>
                      {open ? (
                        <div className="space-y-0.5 px-1 pb-1">
                          {group.items.map((item) => (
                            <NavButton item={item} key={item.id} page={page} setPage={setPage} />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </nav>
      </div>
    </aside>
  );
}

function OverviewPage({
  config,
  enabledCount,
  language,
  onOpenConfig,
  onPrompt,
}: {
  config: AppConfig | null;
  enabledCount: number;
  language: AppLanguage;
  onOpenConfig: () => void;
  onPrompt: (value: string) => void;
}) {
  const copy = i18n[language].overview;
  const quickPrompts = i18n[language].quickPrompts;
  const loading = language === "en" ? "Loading" : "加载中";
  return (
    <div className="page-enter grid h-full min-h-0 flex-1 gap-3 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-4 lg:overflow-hidden">
      <section className="panel motion-panel flex min-h-0 min-w-0 flex-col rounded-md">
        <div className="panel-header flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
	            <div className="flex items-center gap-2">
	              <ShieldCheck className="size-5 text-primary" />
	              <p className="font-semibold">{copy.title}</p>
	            </div>
	            <p className="text-xs text-muted-foreground">{copy.subtitle}</p>
	          </div>
	          <Button size="sm" variant="outline" onClick={onOpenConfig}>
	            <Settings2 />
	            {copy.config}
	          </Button>
        </div>
        <div className="panel-body flex-1 space-y-4 overflow-y-auto">
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
	            <StatusTile label={copy.llmModel} value={config?.llm_model ?? i18n[language].shell.notConfigured} icon={<Cpu className="size-4 text-primary" />} />
	            <StatusTile label={copy.workspace} value={config?.workspace_dir ?? loading} icon={<Database className="size-4 text-accent" />} />
	            <StatusTile label={copy.contextTurns} value={String(config?.agent_max_context_turns ?? "-")} icon={<Bot className="size-4 text-secondary" />} />
	            <StatusTile label={copy.capabilities} value={`${enabledCount}/4 ON`} icon={<Sparkles className="size-4 text-primary" />} />
          </div>

          <div className="grid gap-3 md:grid-cols-4">
	            <CapabilityCard active={config?.memory_enabled} icon={<BrainCircuit />} label={copy.memory} />
	            <CapabilityCard active={config?.knowledge_enabled} icon={<Database />} label={copy.knowledge} />
	            <CapabilityCard active={config?.scheduler_enabled} icon={<RefreshCw />} label={copy.scheduler} />
	            <CapabilityCard active={config?.tracing_enabled} icon={<Cpu />} label={copy.tracing} />
          </div>

          <div className="rounded-lg border border-border/80 bg-background/45 p-3">
	            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
	              <WandSparkles className="size-4 text-secondary" />
	              {copy.quickPrompts}
	            </div>
            <div className="grid gap-2 lg:grid-cols-3">
              {quickPrompts.map((item) => (
                <button
                  className="min-h-16 rounded-md border border-border/80 bg-muted/30 px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                  key={item}
                  onClick={() => onPrompt(item)}
                  type="button"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="panel motion-panel min-h-0 min-w-0 flex flex-col rounded-md">
        <div className="panel-header">
          <p className="font-semibold">Signal Deck</p>
          <p className="text-xs text-muted-foreground">{copy.signalDeckSubtitle}</p>
        </div>
        <div className="panel-body min-h-0 flex-1">
          <MarketPulse />
        </div>
      </section>
    </div>
  );
}

function CapabilityCard({ active, icon, label }: { active?: boolean; icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border/80 bg-background/50 px-3 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-primary [&_svg]:size-4">{icon}</div>
        <span className="truncate text-sm font-medium">{label}</span>
      </div>
      <Badge variant={active ? "default" : "muted"}>{active ? "ON" : "OFF"}</Badge>
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
