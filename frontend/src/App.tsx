import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BarChart2,
  BookOpen,
  Bot,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleDot,
  Clock,
  Copy,
  Cpu,
  Database,
  ExternalLink,
  Eye,
  FileText,
  GripVertical,
  Home,
  Loader2,
  MessageSquareText,
  Moon,
  Plug,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Sun,
  TerminalSquare,
  Trash2,
  TrendingUp,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { MarketDashboard } from "@/components/MarketDashboard";
import { MarketConfigPage } from "@/components/MarketConfigPage";
import TechnicalAnalysis from "@/components/TechnicalAnalysis";
import { MarketPulse } from "@/components/MarketPulse";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  addMemory,
  addWatchlistItem,
  checkHealth,
  createSchedulerTask,
  deleteSchedulerTask,
  deleteWatchlistItem,
  getKnowledgeFile,
  getKnowledgeGraph,
  getKnowledgeTree,
  getMarketConfig,
  getMcpStatus,
  getMcpOAuthAuthorizeUrl,
  getMcpTools,
  getMemoryFile,
  getMemoryStatus,
  listMemoryFiles,
  listSchedulerTasks,
  listSkills,
  listWatchlist,
  loadConfig,
  deleteMcpOAuth,
  reconnectMcpServers,
  refreshSkills,
  reorderWatchlist,
  saveConfig,
  searchMemory,
  searchWatchlist,
  syncMemory,
  toggleSchedulerTask,
  toggleSkill,
  sendChat,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { useColorScheme } from "@/lib/color-scheme";
import type {
  AppConfig,
  ChatMessage,
  ConfigDraft,
  Conversation,
  KnowledgeDir,
  KnowledgeFile,
  KnowledgeGraph,
  KnowledgeTree,
  MCPServerStatus,
  MCPToolInfo,
  MarketDashboardConfig,
  MemoryFile,
  MemorySearchResult,
  MemoryStatus,
  SchedulerTask,
  SkillInfo,
  WatchlistCategory,
  WatchlistItem,
  WatchlistSearchResult,
} from "@/types/app";

type Page = "overview" | "chat" | "market" | "market_config" | "watchlist" | "config" | "chart" | "skills" | "mcp" | "memory" | "knowledge" | "scheduler";
type Theme = "dark" | "light";

const initialMessage: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content: "控制台已就绪。可以直接询问行情、策略、知识库内容，或让 Agent 调用工具完成分析任务。",
  createdAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
};

const quickPrompts = [
  "总结今天值得关注的美股科技股信号",
  "帮我制定一份低波动组合观察清单",
  "基于知识库检查最近的交易规则",
  "使用market-analysis技能分析今天的美股",
  "使用market-analysis技能分析今天的A股",
];

const navItems: Array<{ id: Page; label: string; icon: ReactNode; hint: string }> = [
  { id: "overview", label: "概览", icon: <Home />, hint: "状态与信号" },
  { id: "chat", label: "对话", icon: <MessageSquareText />, hint: "Agent chat" },
  { id: "market", label: "行情", icon: <BarChart2 />, hint: "大盘/个股" },
  { id: "chart", label: "分析", icon: <TrendingUp />, hint: "技术分析" },
  { id: "watchlist", label: "自选", icon: <Star />, hint: "美/A/H股" },
  { id: "skills", label: "技能", icon: <Zap />, hint: "Agent 技能" },
  { id: "memory", label: "记忆", icon: <BrainCircuit />, hint: "长期记忆" },
  { id: "knowledge", label: "知识库", icon: <BookOpen />, hint: "Markdown 知识" },
  { id: "scheduler", label: "任务", icon: <Clock />, hint: "Cron/间隔" },
  { id: "mcp", label: "MCP", icon: <Plug />, hint: "工具服务器" },
  { id: "config", label: "配置", icon: <Settings2 />, hint: "运行时参数" },
];

const watchlistCategories: Array<{ id: WatchlistCategory; label: string; hint: string }> = [
  { id: "US", label: "美股", hint: "US" },
  { id: "A", label: "A股", hint: "SH/SZ" },
  { id: "H", label: "H股", hint: "HK" },
];

function toDraft(config: AppConfig): ConfigDraft {
  return {
    ...config,
    llm_api_key: "",
    embedding_api_key: "",
    longbridge_app_key: "",
    longbridge_app_secret: "",
    longbridge_access_token: "",
    longbridge_http_url: config.longbridge_http_url ?? "",
    longbridge_quote_ws_url: config.longbridge_quote_ws_url ?? "",
    mcp_servers_text: JSON.stringify(config.mcp_servers ?? {}, null, 2),
  };
}

function formatJsonParseError(error: unknown, label = "JSON") {
  const message = error instanceof Error ? error.message : "格式错误";
  if (/Unexpected non-whitespace character after JSON/i.test(message)) {
    return `${label} 格式错误：一个完整 JSON 对象后面还有多余内容。请删除第二段 JSON、注释或 Markdown 代码围栏，只保留一个 JSON 对象。`;
  }
  return `${label} 格式错误：${message}`;
}

function parseJsonObject(text: string, label = "JSON") {
  const trimmed = text.trim();
  if (!trimmed) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(formatJsonParseError(error, label));
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} 必须是对象`);
  }
  return parsed as Record<string, unknown>;
}

// ── Chat History (localStorage) ────────────────────────────────────────────

const STORAGE_KEY = "stocks-assistant-conversations";
const MAX_CONVERSATIONS = 50;

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Conversation[];
  } catch {
    return [];
  }
}

function saveConversations(convs: Conversation[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(convs.slice(0, MAX_CONVERSATIONS)));
}

function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>(() => loadConversations());
  const [activeId, setActiveId] = useState<string | null>(null);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  function createConversation(firstMessage?: ChatMessage): string {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const conv: Conversation = {
      id,
      title: "新对话",
      messages: firstMessage ? [firstMessage] : [],
      createdAt: now,
      updatedAt: now,
    };
    const next = [conv, ...conversations].slice(0, MAX_CONVERSATIONS);
    setConversations(next);
    saveConversations(next);
    setActiveId(id);
    return id;
  }

  function switchConversation(id: string) {
    setActiveId(id);
  }

  function addMessage(convId: string, message: ChatMessage) {
    setConversations((prev) => {
      const next = prev.map((c) => {
        if (c.id !== convId) return c;
        const messages = [...c.messages, message];
        const title = c.messages.length === 0 && message.role === "user"
          ? message.content.slice(0, 30) + (message.content.length > 30 ? "..." : "")
          : c.title;
        return { ...c, messages, title, updatedAt: new Date().toISOString() };
      });
      saveConversations(next);
      return next;
    });
  }

  function updateMessage(convId: string, messageId: string, patch: Partial<ChatMessage>) {
    setConversations((prev) => {
      const next = prev.map((c) => {
        if (c.id !== convId) return c;
        return { ...c, messages: c.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)) };
      });
      saveConversations(next);
      return next;
    });
  }

  function deleteConversation(id: string) {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      saveConversations(next);
      return next;
    });
    if (activeId === id) setActiveId(null);
  }

  function clearMessages(convId: string) {
    setConversations((prev) => {
      const next = prev.map((c) => {
        if (c.id !== convId) return c;
        return { ...c, messages: [], title: "新对话", updatedAt: new Date().toISOString() };
      });
      saveConversations(next);
      return next;
    });
  }

  function updateTitle(convId: string, title: string) {
    setConversations((prev) => {
      const next = prev.map((c) => {
        if (c.id !== convId) return c;
        return { ...c, title, updatedAt: new Date().toISOString() };
      });
      saveConversations(next);
      return next;
    });
  }

  return {
    conversations,
    activeId,
    activeConversation,
    createConversation,
    switchConversation,
    addMessage,
    updateMessage,
    updateTitle,
    deleteConversation,
    clearMessages,
  };
}

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API not available
    }
  }

  return (
    <button
      type="button"
      className={cn(
        "shrink-0 rounded p-1 text-muted-foreground/60 transition-colors hover:bg-muted/60 hover:text-foreground",
        className,
      )}
      onClick={handleCopy}
      title={copied ? "已复制" : "复制"}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const msgDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (msgDate.getTime() === today.getTime()) return "今天";
  if (msgDate.getTime() === yesterday.getTime()) return "昨天";
  return "更早";
}

function App() {
  const [page, setPage] = useState<Page>("chat");
  const [selectedSymbol, setSelectedSymbol] = useState<string>("");
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = window.localStorage.getItem("stocks-assistant-theme");
    return stored === "light" || stored === "dark" ? stored : "dark";
  });
  const [prompt, setPrompt] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [draft, setDraft] = useState<ConfigDraft | null>(null);
  const [health, setHealth] = useState<"checking" | "online" | "offline">("checking");
  const [configState, setConfigState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const [marketConfig, setMarketConfig] = useState<MarketDashboardConfig>({ indices: [], refresh_interval: 60 });
  const endRef = useRef<HTMLDivElement | null>(null);
  const chatHistory = useConversations();

  const messages = chatHistory.activeConversation?.messages ?? [initialMessage];
  const activeConvId = chatHistory.activeId;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, page]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem("stocks-assistant-theme", theme);
  }, [theme]);

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
        setError(configResult.reason instanceof Error ? configResult.reason.message : "配置加载失败");
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

  const modelName = config?.llm_model ?? "未配置";
  const enabledCount = useMemo(() => {
    if (!config) return 0;
    return [config.memory_enabled, config.knowledge_enabled, config.scheduler_enabled].filter(Boolean).length;
  }, [config]);

  async function handleSend(event?: { preventDefault: () => void }, value = prompt) {
    event?.preventDefault();
    const text = value.trim();
    if (!text || isSending) return;

    const createdAt = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      createdAt,
    };
    const pendingMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "正在分析请求并调用可用工具...",
      createdAt,
      pending: true,
    };

    setPrompt("");
    setError("");
    setIsSending(true);
    setPage("chat");

    let convId = activeConvId;
    const isNewConv = !convId;
    if (!convId) {
      convId = chatHistory.createConversation(userMessage);
      chatHistory.addMessage(convId, pendingMessage);
    } else {
      chatHistory.addMessage(convId, userMessage);
      chatHistory.addMessage(convId, pendingMessage);
    }

    // 收集已有历史消息（不含当前 userMessage 和 pendingMessage）
    const currentConv = chatHistory.conversations.find((c) => c.id === convId);
    const history = (currentConv?.messages ?? [])
      .filter((m) => m.id !== userMessage.id && m.id !== pendingMessage.id && !m.pending)
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const response = await sendChat(text, history);
      chatHistory.updateMessage(convId, pendingMessage.id, {
        content: response.response || "没有返回内容。",
        pending: false,
        createdAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
      });

      // 第一次提问后自动生成标题
      if (isNewConv) {
        generateTitle(convId, text, response.response);
      }
    } catch (caught) {
      const msg = caught instanceof Error ? caught.message : "对话请求失败";
      setError(msg);
      chatHistory.updateMessage(convId, pendingMessage.id, {
        content: `请求失败：${msg}`,
        pending: false,
      });
    } finally {
      setIsSending(false);
    }
  }

  async function generateTitle(convId: string, userMessage: string, assistantResponse: string) {
    try {
      const titlePrompt = `根据以下对话内容，生成一个简短的标题（不超过20个字，不要加引号）。\n\n用户：${userMessage.slice(0, 500)}\n助手：${assistantResponse.slice(0, 500)}`;
      const res = await sendChat(titlePrompt, []);
      const title = res.response?.trim().replace(/^["'「」『』]|["'「」『』]$/g, "").slice(0, 30);
      if (title) {
        chatHistory.updateTitle(convId, title);
      }
    } catch {
      // 标题生成失败不影响主流程，保持默认标题
    }
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
        agent_max_steps: Number(draft.agent_max_steps),
        agent_max_context_tokens: Number(draft.agent_max_context_tokens),
        agent_max_context_turns: Number(draft.agent_max_context_turns),
        knowledge_enabled: draft.knowledge_enabled,
        memory_enabled: draft.memory_enabled,
        scheduler_enabled: draft.scheduler_enabled,
        debug: draft.debug,
        system_prompt: draft.system_prompt,
        mcp_servers: mcpServers,
        longbridge_http_url: draft.longbridge_http_url ?? "",
        longbridge_quote_ws_url: draft.longbridge_quote_ws_url ?? "",
      };

      if (draft.llm_api_key.trim()) {
        payload.llm_api_key = draft.llm_api_key.trim();
      }
      if (draft.embedding_api_key.trim()) {
        payload.embedding_api_key = draft.embedding_api_key.trim();
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
      const message = caught instanceof Error ? caught.message : "配置保存失败";
      setError(message);
      setConfigState("error");
    }
  }

  function patchDraft(patch: Partial<ConfigDraft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  return (
    <div className="console-shell h-[100dvh] overflow-hidden">
      <div className="flex h-full w-full flex-col gap-3 p-3 lg:p-4">
        <Header
          health={health}
          modelName={modelName}
          onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
          theme={theme}
        />
        <MobileNav page={page} setPage={setPage} />

        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[240px_minmax(0,1fr)] xl:gap-4">
          <DesktopNav
            config={config}
            enabledCount={enabledCount}
            health={health}
            page={page}
            setPage={setPage}
          />

          <main className="flex min-h-0 min-w-0 flex-col overflow-hidden" key={page}>
            {error ? (
              <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            ) : null}

            {page === "overview" ? (
              <OverviewPage
                config={config}
                enabledCount={enabledCount}
                onOpenConfig={() => setPage("config")}
                onPrompt={(value) => {
                  setPrompt(value);
                  setPage("chat");
                }}
              />
            ) : null}

            {page === "chat" ? (
              <ChatPage
                endRef={endRef}
                handleSend={handleSend}
                isSending={isSending}
                messages={messages}
                prompt={prompt}
                quickPrompts={quickPrompts}
                chatHistory={chatHistory}
                setPage={setPage}
                setPrompt={setPrompt}
              />
            ) : null}

            {page === "watchlist" ? <WatchlistPage onAnalyzeStock={(symbol) => { setPrompt(`使用stock-analysis技能分析${symbol}股票`); setPage("chat"); }} /> : null}

            {page === "market" ? (
              <MarketDashboard
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
                symbol={selectedSymbol}
                onSymbolChange={setSelectedSymbol}
                onBack={() => setPage("market")}
              />
            ) : null}

            {page === "market_config" ? (
              <MarketConfigPage
                onBack={() => setPage("market")}
                onSaved={(cfg) => {
                  setMarketConfig(cfg);
                  setPage("market");
                }}
              />
            ) : null}

            {page === "skills" ? <SkillsPage /> : null}

            {page === "memory" ? <MemoryPage /> : null}

            {page === "knowledge" ? <KnowledgePage /> : null}

            {page === "scheduler" ? <SchedulerPage /> : null}

            {page === "mcp" ? <MCPPage /> : null}

            {page === "config" ? (
              <ConfigPage
                config={config}
                configState={configState}
                draft={draft}
                enabledCount={enabledCount}
                handleSaveConfig={handleSaveConfig}
                patchDraft={patchDraft}
                setDraft={setDraft}
              />
            ) : null}
          </main>
        </div>
      </div>
    </div>
  );
}

function Header({
  health,
  modelName,
  onToggleTheme,
  theme,
}: {
  health: "checking" | "online" | "offline";
  modelName: string;
  onToggleTheme: () => void;
  theme: Theme;
}) {
  return (
    <header className="panel motion-panel flex shrink-0 flex-col gap-3 rounded-md px-3 py-3 sm:px-4 lg:flex-row lg:items-center lg:justify-between">
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
        <Button
          aria-label={theme === "dark" ? "切换到亮色主题" : "切换到暗色主题"}
          size="icon"
          variant="outline"
          onClick={onToggleTheme}
          className="theme-toggle h-8 w-8 shrink-0 rounded-md bg-muted/40 hover:bg-muted [&_svg]:size-3.5"
          title={theme === "dark" ? "切换到亮色主题" : "切换到暗色主题"}
        >
          {theme === "dark" ? <Sun /> : <Moon />}
        </Button>
      </div>
    </header>
  );
}

function MobileNav({ page, setPage }: { page: Page; setPage: (page: Page) => void }) {
  return (
    <nav className="panel shrink-0 rounded-md flex gap-2 overflow-x-auto p-2 lg:hidden" aria-label="移动端导航">
      {navItems.map((item) => (
        <button
          className={cn(
            "nav-item inline-flex h-10 min-w-[96px] items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors",
            page === item.id ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:text-foreground",
          )}
          key={item.id}
          onClick={() => setPage(item.id)}
          type="button"
        >
          <span className="[&_svg]:size-4">{item.icon}</span>
          {item.label}
        </button>
      ))}
    </nav>
  );
}

function DesktopNav({
  config,
  enabledCount,
  health,
  page,
  setPage,
}: {
  config: AppConfig | null;
  enabledCount: number;
  health: "checking" | "online" | "offline";
  page: Page;
  setPage: (page: Page) => void;
}) {
  return (
    <aside className="hidden min-h-0 min-w-0 lg:block">
      <div className="panel flex h-full min-h-0 flex-col overflow-hidden rounded-md">
        <div className="panel-header">
          <p className="text-sm font-semibold">Navigation</p>
          <p className="text-xs text-muted-foreground">页面切换</p>
        </div>
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2" aria-label="桌面导航">
          {navItems.map((item) => (
            <button
              className={cn(
                "nav-item flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors",
                page === item.id
                  ? "bg-primary text-primary-foreground shadow-glow"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
              key={item.id}
              onClick={() => setPage(item.id)}
              type="button"
            >
              <span className="[&_svg]:size-4">{item.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{item.label}</span>
                <span className="block truncate text-[11px] opacity-75">{item.hint}</span>
              </span>
            </button>
          ))}
        </nav>
        <Separator />
        <div className="shrink-0 space-y-3 p-3">
          <div className="metric-tile">
            <p className="text-[11px] text-muted-foreground">API</p>
            <p className="text-sm font-semibold">{health === "online" ? "ONLINE" : health === "checking" ? "CHECKING" : "OFFLINE"}</p>
          </div>
          <div className="metric-tile">
            <p className="text-[11px] text-muted-foreground">Model</p>
            <p className="truncate text-sm font-semibold">{config?.llm_model ?? "未配置"}</p>
          </div>
          <div className="metric-tile">
            <p className="text-[11px] text-muted-foreground">Capabilities</p>
            <p className="text-sm font-semibold">{enabledCount}/3 ON</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

function OverviewPage({
  config,
  enabledCount,
  onOpenConfig,
  onPrompt,
}: {
  config: AppConfig | null;
  enabledCount: number;
  onOpenConfig: () => void;
  onPrompt: (value: string) => void;
}) {
  return (
    <div className="page-enter grid h-full min-h-0 flex-1 gap-3 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-4 lg:overflow-hidden">
      <section className="panel motion-panel flex min-h-0 min-w-0 flex-col rounded-md">
        <div className="panel-header flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-primary" />
              <p className="font-semibold">Workspace Overview</p>
            </div>
            <p className="text-xs text-muted-foreground">模型、能力和工作区状态</p>
          </div>
          <Button size="sm" variant="outline" onClick={onOpenConfig}>
            <Settings2 />
            Config
          </Button>
        </div>
        <div className="panel-body flex-1 space-y-4 overflow-y-auto">
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
            <StatusTile label="LLM Model" value={config?.llm_model ?? "未配置"} icon={<Cpu className="size-4 text-primary" />} />
            <StatusTile label="Workspace" value={config?.workspace_dir ?? "加载中"} icon={<Database className="size-4 text-accent" />} />
            <StatusTile label="Context Turns" value={String(config?.agent_max_context_turns ?? "-")} icon={<Bot className="size-4 text-secondary" />} />
            <StatusTile label="Capabilities" value={`${enabledCount}/3 ON`} icon={<Sparkles className="size-4 text-primary" />} />
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <CapabilityCard active={config?.memory_enabled} icon={<BrainCircuit />} label="长期记忆" />
            <CapabilityCard active={config?.knowledge_enabled} icon={<Database />} label="知识库" />
            <CapabilityCard active={config?.scheduler_enabled} icon={<RefreshCw />} label="定时任务" />
          </div>

          <div className="rounded-lg border border-border/80 bg-background/45 p-3">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <WandSparkles className="size-4 text-secondary" />
              Quick Prompts
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
          <p className="text-xs text-muted-foreground">市场状态预览</p>
        </div>
        <div className="panel-body min-h-0 flex-1">
          <MarketPulse />
        </div>
      </section>
    </div>
  );
}

function ChatPage({
  endRef,
  handleSend,
  isSending,
  messages,
  prompt,
  quickPrompts,
  chatHistory,
  setPage,
  setPrompt,
}: {
  endRef: React.RefObject<HTMLDivElement | null>;
  handleSend: (event?: { preventDefault: () => void }, value?: string) => void;
  isSending: boolean;
  messages: ChatMessage[];
  prompt: string;
  quickPrompts: string[];
  chatHistory: ReturnType<typeof useConversations>;
  setPage: (page: Page) => void;
  setPrompt: (value: string) => void;
}) {
  const { conversations, activeId, createConversation, switchConversation, deleteConversation, clearMessages } = chatHistory;

  const grouped = useMemo(() => {
    const groups: Record<string, Conversation[]> = {};
    for (const c of conversations) {
      const label = formatRelativeDate(c.updatedAt);
      (groups[label] ??= []).push(c);
    }
    return groups;
  }, [conversations]);

  function handleNew() {
    createConversation();
  }

  return (
    <div className="page-enter grid h-full min-h-0 flex-1 gap-3 overflow-hidden lg:grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_300px] xl:gap-4">
      {/* Conversation list */}
      <aside className="panel motion-panel hidden min-h-0 min-w-0 rounded-md lg:flex lg:h-full lg:flex-col">
        <div className="panel-header flex items-center justify-between">
          <p className="text-sm font-semibold">History</p>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleNew}>
            <Plus className="size-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2 space-y-1">
          {Object.entries(grouped).map(([label, convs]) => (
            <div key={label}>
              <p className="px-2 py-1 text-[10px] font-medium uppercase text-muted-foreground">{label}</p>
              {convs.map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    "group flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors cursor-pointer",
                    activeId === c.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                  onClick={() => switchConversation(c.id)}
                >
                  <MessageSquareText className="size-3.5 shrink-0" />
                  <span className="flex-1 truncate">{c.title}</span>
                  <button
                    type="button"
                    className="hidden shrink-0 text-muted-foreground hover:text-destructive group-hover:block"
                    onClick={(e) => { e.stopPropagation(); deleteConversation(c.id); }}
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          ))}
          {conversations.length === 0 ? (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">暂无对话记录</div>
          ) : null}
        </div>
      </aside>

      {/* Chat area */}
      <section className="panel motion-panel flex min-h-0 min-w-0 flex-1 flex-col rounded-md">
        <div className="panel-header flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Bot className="size-5 text-primary" />
              <p className="font-semibold">Agent Chat</p>
            </div>
            <p className="text-xs text-muted-foreground">同步对话接口：/api/v1/agent/chat</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="xl:hidden" onClick={handleNew}>
              <Plus /> New
            </Button>
            <Button aria-label="清空对话" variant="outline" size="sm" onClick={() => { if (activeId) clearMessages(activeId); }}>
              <Trash2 />
              Clear
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4 sm:py-4">
          <div className="space-y-4">
            {messages.map((message) => (
              <div className={cn("group flex gap-2 sm:gap-3", message.role === "user" ? "justify-end" : "justify-start")} key={message.id}>
                {message.role === "assistant" ? (
                  <div className="mt-1 grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                    {message.pending ? <Loader2 className="size-4 animate-spin" /> : <Bot className="size-4" />}
                  </div>
                ) : null}
                <div
                  className={cn(
                    "message-bubble max-w-[min(760px,92%)] rounded-lg border px-3 py-2.5 text-sm leading-6 shadow-sm sm:px-4 sm:py-3",
                    message.role === "user"
                      ? "border-primary/50 bg-primary text-primary-foreground"
                      : "border-border/80 bg-background/60 text-foreground",
                  )}
                >
                  <div className="prose prose-sm dark:prose-invert max-w-none break-words prose-p:my-1 prose-pre:my-2 prose-pre:rounded-md prose-pre:bg-muted/40 prose-code:text-primary prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-table:my-2">
                    {message.role === "assistant" ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                    ) : (
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    )}
                  </div>
                  <div
                    className={cn(
                      "mt-2 flex items-center gap-1.5",
                      message.role === "user" ? "text-primary-foreground/70" : "text-muted-foreground",
                    )}
                  >
                    <span className="text-[11px]">{message.createdAt}</span>
                    <CopyButton
                      text={message.content}
                      className="opacity-0 transition-opacity group-hover:opacity-100"
                    />
                  </div>
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        </div>

        <form className="border-t border-border/80 p-3 sm:p-4" onSubmit={handleSend}>
          <div className="flex flex-col gap-3 md:flex-row">
            <Textarea
              className="min-h-[76px] resize-none"
              disabled={isSending}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  handleSend(event);
                }
              }}
              placeholder="输入你的问题，例如：分析 AAPL、MSFT、NVDA 的风险收益差异"
              value={prompt}
            />
            <Button className="h-11 md:h-[76px] md:w-28" disabled={isSending || !prompt.trim()} type="submit">
              {isSending ? <Loader2 className="animate-spin" /> : <Send />}
              Send
            </Button>
          </div>
        </form>
      </section>

      {/* Prompt dock */}
      <aside className="panel motion-panel min-h-0 min-w-0 hidden rounded-md xl:flex xl:h-full xl:flex-col">
        <div className="panel-header flex items-center justify-between">
          <div>
            <p className="font-semibold">Prompt Dock</p>
            <p className="text-xs text-muted-foreground">快捷输入</p>
          </div>
          <WandSparkles className="size-5 text-secondary" />
        </div>
        <div className="panel-body min-h-0 flex-1 space-y-2 overflow-y-auto">
          {quickPrompts.map((item) => (
            <button
              className="w-full rounded-md border border-border/80 bg-background/50 px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              key={item}
              onClick={() => {
                setPrompt(item);
                setPage("chat");
              }}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}

function SortableWatchlistItem({
  item,
  onDelete,
  onAnalyze,
}: {
  item: WatchlistItem;
  onDelete: (item: WatchlistItem) => void;
  onAnalyze: (symbol: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="message-bubble rounded-md border border-border/80 bg-card/80 p-3 transition-colors hover:border-primary/50"
    >
      <div className="flex items-start justify-between gap-3">
        <button
          {...attributes}
          {...listeners}
          type="button"
          aria-label="拖拽排序"
          className="mt-0.5 shrink-0 cursor-grab touch-none text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">{item.symbol}</p>
          <p className="truncate text-sm text-muted-foreground">{stockName(item)}</p>
        </div>
        <Button
          aria-label="分析股票"
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-muted-foreground hover:text-primary"
          onClick={() => onAnalyze(item.symbol)}
        >
          <Sparkles />
        </Button>
        <Button
          aria-label="删除自选"
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={() => onDelete(item)}
        >
          <Trash2 />
        </Button>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <QuoteMetric label="Last" value={item.last_done ?? "-"} />
        <QuoteMetric label="Change" value={item.change_value ?? "-"} />
        <QuoteMetric label="Rate" value={item.change_rate ?? "-"} tone={rateTone(item.change_rate)} />
      </div>
    </div>
  );
}

function WatchlistPage({ onAnalyzeStock }: { onAnalyzeStock: (symbol: string) => void }) {
  const [category, setCategory] = useState<WatchlistCategory>("US");
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WatchlistSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [message, setMessage] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    let mounted = true;

    async function loadItems() {
      setIsLoading(true);
      setMessage("");
      try {
        const response = await listWatchlist(category);
        if (mounted) {
          setItems(response.items);
        }
      } catch (caught) {
        if (mounted) {
          setMessage(caught instanceof Error ? caught.message : "加载自选列表失败");
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    loadItems();
    return () => {
      mounted = false;
    };
  }, [category]);

  async function handleSearch(event?: { preventDefault: () => void }) {
    event?.preventDefault();
    const text = query.trim();
    if (!text || isSearching) return;

    setIsSearching(true);
    setMessage("");
    try {
      const response = await searchWatchlist(text, category);
      setResults(response.results);
      if (response.total === 0) {
        setMessage("未找到匹配标的，请输入完整代码，例如 AAPL、700、600519。");
      }
    } catch (caught) {
      setResults([]);
      setMessage(caught instanceof Error ? caught.message : "Longbridge 搜索失败");
    } finally {
      setIsSearching(false);
    }
  }

  async function handleAdd(result: WatchlistSearchResult) {
    setMessage("");
    try {
      const item = await addWatchlistItem(result);
      if (item.category === category) {
        setItems((current) => [...current.filter((e) => e.symbol !== item.symbol), item]);
      }
      setResults((current) => current.filter((e) => e.symbol !== item.symbol));
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "添加自选失败");
    }
  }

  async function handleDelete(item: WatchlistItem) {
    setMessage("");
    try {
      await deleteWatchlistItem(item.id);
      setItems((current) => current.filter((e) => e.id !== item.id));
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "删除自选失败");
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setItems((current) => {
      const oldIndex = current.findIndex((e) => e.id === active.id);
      const newIndex = current.findIndex((e) => e.id === over.id);
      const next = arrayMove(current, oldIndex, newIndex);
      // Persist asynchronously — ignore errors silently
      reorderWatchlist(next.map((e) => e.id)).catch(() => {});
      return next;
    });
  }

  const symbolSet = new Set(items.map((item) => item.symbol));

  return (
    <section className="panel motion-panel page-enter flex h-full min-h-0 min-w-0 flex-1 flex-col rounded-md">
      <div className="panel-header flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Star className="size-5 text-secondary" />
            <p className="font-semibold">Watchlist</p>
          </div>
          <p className="text-xs text-muted-foreground">本地 SQLite 存储，Longbridge SDK 搜索</p>
        </div>

        <div className="flex w-full flex-col gap-3 xl:w-auto xl:flex-row xl:items-center">
          <div className="flex rounded-md border border-border/80 bg-muted/40 p-1">
            {watchlistCategories.map((item) => (
              <button
                className={cn(
                  "h-8 min-w-20 rounded-sm px-3 text-sm font-medium transition-all",
                  category === item.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                key={item.id}
                onClick={() => {
                  setCategory(item.id);
                  setResults([]);
                  setMessage("");
                }}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>
          <Badge variant="outline">{items.length} symbols</Badge>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto p-3 lg:grid-cols-[minmax(0,1fr)_380px] lg:overflow-hidden lg:p-4">
        <div className="flex min-h-0 flex-col rounded-lg border border-border/80 bg-background/45">
          <div className="flex items-center justify-between border-b border-border/80 p-3">
            <div>
              <p className="text-sm font-semibold">
                {watchlistCategories.find((item) => item.id === category)?.label}列表
              </p>
              <p className="text-xs text-muted-foreground">
                {watchlistCategories.find((item) => item.id === category)?.hint} · 拖拽调整顺序
              </p>
            </div>
            {isLoading ? (
              <Badge variant="muted" className="gap-1.5">
                <Loader2 className="size-3.5 animate-spin" />
                Loading
              </Badge>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {items.length > 0 ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                  <div className="grid gap-2 2xl:grid-cols-2">
                    {items.map((item) => (
                      <SortableWatchlistItem key={item.id} item={item} onDelete={handleDelete} onAnalyze={onAnalyzeStock} />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            ) : (
              <div className="grid h-full min-h-56 place-items-center rounded-md border border-dashed border-border/80 bg-muted/20 px-4 text-center">
                <div>
                  <Star className="mx-auto mb-3 size-8 text-muted-foreground" />
                  <p className="text-sm font-medium">暂无自选股</p>
                  <p className="mt-1 text-xs text-muted-foreground">在右侧搜索 Longbridge 标的后添加到当前分类。</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <aside className="flex min-h-0 flex-col rounded-lg border border-border/80 bg-background/45">
          <div className="border-b border-border/80 p-3">
            <form className="flex gap-2" onSubmit={handleSearch}>
              <Input
                placeholder={category === "US" ? "AAPL / TSLA" : category === "H" ? "700 / 00700" : "600519 / 000001"}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <Button className="shrink-0" disabled={isSearching || !query.trim()} type="submit">
                {isSearching ? <Loader2 className="animate-spin" /> : <Search />}
                Search
              </Button>
            </form>
            {message ? (
              <div className="mt-3 rounded-md border border-border/80 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                {message}
              </div>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="space-y-2">
              {results.map((result) => {
                const exists = symbolSet.has(result.symbol);
                return (
                  <div className="rounded-md border border-border/80 bg-card/80 p-3" key={result.symbol}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{result.symbol}</p>
                        <p className="truncate text-xs text-muted-foreground">{stockName(result)}</p>
                      </div>
                      <Button size="sm" variant={exists ? "outline" : "default"} disabled={exists} onClick={() => handleAdd(result)}>
                        <Plus />
                        {exists ? "Added" : "Add"}
                      </Button>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                      <QuoteMetric label="Last" value={result.last_done ?? "-"} />
                      <QuoteMetric label="Change" value={result.change_value ?? "-"} />
                      <QuoteMetric label="Rate" value={result.change_rate ?? "-"} tone={rateTone(result.change_rate)} />
                    </div>
                  </div>
                );
              })}
              {results.length === 0 ? (
                <div className="rounded-md border border-dashed border-border/80 bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
                  输入代码并调用 Longbridge SDK 搜索。
                </div>
              ) : null}
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

function ConfigPage({
  config,
  configState,
  draft,
  enabledCount,
  handleSaveConfig,
  patchDraft,
  setDraft,
}: {
  config: AppConfig | null;
  configState: "idle" | "saving" | "saved" | "error";
  draft: ConfigDraft | null;
  enabledCount: number;
  handleSaveConfig: () => void;
  patchDraft: (patch: Partial<ConfigDraft>) => void;
  setDraft: (draft: ConfigDraft) => void;
}) {
  return (
    <section className="panel motion-panel page-enter flex h-full min-h-0 min-w-0 flex-1 flex-col rounded-md">
      <div className="panel-header flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="size-5 text-secondary" />
            <p className="font-semibold">配置管理</p>
          </div>
          <p className="text-xs text-muted-foreground">保存到 config.json，立即刷新运行时配置</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{enabledCount}/3 ON</Badge>
          <Button
            aria-label="重载配置"
            disabled={!config}
            variant="outline"
            size="sm"
            onClick={() => config && setDraft(toDraft(config))}
          >
            <RefreshCw />
            Reload
          </Button>
          <Button size="sm" disabled={configState === "saving" || !draft} onClick={handleSaveConfig}>
            {configState === "saving" ? <Loader2 className="animate-spin" /> : configState === "saved" ? <Check /> : <Save />}
            {configState === "saving" ? "Saving" : configState === "saved" ? "Saved" : "Save"}
          </Button>
        </div>
      </div>

      {draft ? (
        <div className="panel-body min-h-0 flex-1 overflow-y-auto">
          <Tabs defaultValue="model">
            <TabsList className="grid h-auto w-full grid-cols-2 sm:grid-cols-4">
              <TabsTrigger value="model">模型</TabsTrigger>
              <TabsTrigger value="agent">Agent</TabsTrigger>
              <TabsTrigger value="longbridge">长桥</TabsTrigger>
              <TabsTrigger value="features">能力</TabsTrigger>
            </TabsList>

            <TabsContent value="model" className="space-y-4">
              <div className="grid gap-3 lg:grid-cols-2">
                <Field label="LLM API Base">
                  <Input value={draft.llm_api_base} onChange={(event) => patchDraft({ llm_api_base: event.target.value })} />
                </Field>
                <Field label="LLM Model">
                  <Input value={draft.llm_model} onChange={(event) => patchDraft({ llm_model: event.target.value })} />
                </Field>
                <Field label="LLM API Key">
                  <Input
                    placeholder={draft.has_llm_api_key ? draft.llm_api_key_masked : "sk-..."}
                    type="password"
                    value={draft.llm_api_key}
                    onChange={(event) => patchDraft({ llm_api_key: event.target.value })}
                  />
                </Field>
                <Field label="Embedding API Key">
                  <Input
                    placeholder={draft.has_embedding_api_key ? draft.embedding_api_key_masked : "默认使用 LLM key"}
                    type="password"
                    value={draft.embedding_api_key}
                    onChange={(event) => patchDraft({ embedding_api_key: event.target.value })}
                  />
                </Field>
                <Field label="Embedding API Base">
                  <Input
                    value={draft.embedding_api_base}
                    onChange={(event) => patchDraft({ embedding_api_base: event.target.value })}
                  />
                </Field>
                <Field label="Embedding Model">
                  <Input value={draft.embedding_model} onChange={(event) => patchDraft({ embedding_model: event.target.value })} />
                </Field>
              </div>
            </TabsContent>

            <TabsContent value="agent" className="space-y-4">
              <Field label="Workspace">
                <Input value={draft.workspace_dir} onChange={(event) => patchDraft({ workspace_dir: event.target.value })} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Max Steps">
                  <Input
                    min={1}
                    type="number"
                    value={draft.agent_max_steps}
                    onChange={(event) => patchDraft({ agent_max_steps: Number(event.target.value) })}
                  />
                </Field>
                <Field label="Context Tokens">
                  <Input
                    min={1000}
                    step={1000}
                    type="number"
                    value={draft.agent_max_context_tokens}
                    onChange={(event) => patchDraft({ agent_max_context_tokens: Number(event.target.value) })}
                  />
                </Field>
                <Field label="Context Turns">
                  <Input
                    min={1}
                    type="number"
                    value={draft.agent_max_context_turns}
                    onChange={(event) => patchDraft({ agent_max_context_turns: Number(event.target.value) })}
                  />
                </Field>
              </div>
              <Field label="System Prompt">
                <Textarea
                  className="min-h-[220px]"
                  value={draft.system_prompt}
                  onChange={(event) => patchDraft({ system_prompt: event.target.value })}
                />
              </Field>
            </TabsContent>

            <TabsContent value="longbridge" className="space-y-4">
              <div className="grid gap-3 lg:grid-cols-3">
                <Field label="App Key">
                  <Input
                    placeholder={draft.has_longbridge_app_key ? draft.longbridge_app_key_masked : "Longbridge app key"}
                    type="password"
                    value={draft.longbridge_app_key}
                    onChange={(event) => patchDraft({ longbridge_app_key: event.target.value })}
                  />
                </Field>
                <Field label="App Secret">
                  <Input
                    placeholder={draft.has_longbridge_app_secret ? draft.longbridge_app_secret_masked : "Longbridge app secret"}
                    type="password"
                    value={draft.longbridge_app_secret}
                    onChange={(event) => patchDraft({ longbridge_app_secret: event.target.value })}
                  />
                </Field>
                <Field label="Access Token">
                  <Input
                    placeholder={draft.has_longbridge_access_token ? draft.longbridge_access_token_masked : "Longbridge access token"}
                    type="password"
                    value={draft.longbridge_access_token}
                    onChange={(event) => patchDraft({ longbridge_access_token: event.target.value })}
                  />
                </Field>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <Field label="HTTP URL">
                  <Input
                    placeholder="默认使用 SDK 配置"
                    value={draft.longbridge_http_url ?? ""}
                    onChange={(event) => patchDraft({ longbridge_http_url: event.target.value })}
                  />
                </Field>
                <Field label="Quote WS URL">
                  <Input
                    placeholder="默认使用 SDK 配置"
                    value={draft.longbridge_quote_ws_url ?? ""}
                    onChange={(event) => patchDraft({ longbridge_quote_ws_url: event.target.value })}
                  />
                </Field>
              </div>
            </TabsContent>

            <TabsContent value="features" className="grid gap-3 md:grid-cols-2">
              <ToggleRow
                checked={draft.memory_enabled}
                icon={<BrainCircuit className="size-4 text-primary" />}
                label="长期记忆"
                onCheckedChange={(checked) => patchDraft({ memory_enabled: checked })}
              />
              <ToggleRow
                checked={draft.knowledge_enabled}
                icon={<Database className="size-4 text-accent" />}
                label="知识库"
                onCheckedChange={(checked) => patchDraft({ knowledge_enabled: checked })}
              />
              <ToggleRow
                checked={draft.scheduler_enabled}
                icon={<RefreshCw className="size-4 text-secondary" />}
                label="定时任务"
                onCheckedChange={(checked) => patchDraft({ scheduler_enabled: checked })}
              />
              <ToggleRow
                checked={draft.debug}
                icon={<TerminalSquare className="size-4 text-destructive" />}
                label="Debug"
                onCheckedChange={(checked) => patchDraft({ debug: checked })}
              />
              <ColorSchemeRow />
            </TabsContent>
          </Tabs>
        </div>
      ) : (
        <div className="panel-body">
          <div className="ticker-line rounded-md border border-border/80 bg-background/50 px-3 py-8 text-center text-sm text-muted-foreground">
            正在加载配置...
          </div>
        </div>
      )}
    </section>
  );
}

function StatusTile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="metric-tile min-w-0">
      <div className="mb-2 flex items-center gap-2 text-muted-foreground">
        {icon}
        <p className="text-[11px]">{label}</p>
      </div>
      <p className="truncate text-sm font-semibold">{value}</p>
    </div>
  );
}

function QuoteMetric({ label, tone, value }: { label: string; tone?: "up" | "down" | "flat"; value: string }) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/25 px-2 py-1.5">
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 truncate font-semibold",
          tone === "up" && "text-primary",
          tone === "down" && "text-destructive",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function stockName(item: Pick<WatchlistItem, "name" | "name_cn" | "name_hk" | "name_en">) {
  return item.name || item.name_cn || item.name_hk || item.name_en || "-";
}

function rateTone(value: string | null): "up" | "down" | "flat" {
  if (!value) return "flat";
  if (value.startsWith("-")) return "down";
  if (value !== "-" && value !== "0" && value !== "0.00%") return "up";
  return "flat";
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

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="min-w-0 space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function ToggleRow({
  checked,
  icon,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  icon: ReactNode;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border/80 bg-background/50 px-3 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid size-8 shrink-0 place-items-center rounded-md bg-muted">{icon}</div>
        <span className="truncate text-sm font-medium">{label}</span>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

// ── Color Scheme Toggle ─────────────────────────────────────────────────────────

function ColorSchemeRow() {
  const { scheme, setScheme } = useColorScheme();
  return (
    <div className="flex items-center justify-between rounded-md border border-border/80 bg-background/50 px-3 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid size-8 shrink-0 place-items-center rounded-md bg-muted">
          <TrendingUp className="size-4 text-secondary" />
        </div>
        <div className="min-w-0">
          <span className="truncate text-sm font-medium">涨跌配色</span>
          <p className="text-[10px] text-muted-foreground">
            {scheme === "cn" ? "红涨绿跌" : "绿涨红跌"}
          </p>
        </div>
      </div>
      <div className="flex rounded-md border border-border/80 bg-muted/40 p-0.5">
        <button
          className={`rounded-sm px-2.5 py-1 text-[11px] font-medium transition-all ${
            scheme === "intl"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setScheme("intl")}
          type="button"
        >
          绿涨红跌
        </button>
        <button
          className={`rounded-sm px-2.5 py-1 text-[11px] font-medium transition-all ${
            scheme === "cn"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setScheme("cn")}
          type="button"
        >
          红涨绿跌
        </button>
      </div>
    </div>
  );
}

// ── MCP Servers Management ──────────────────────────────────────────────────────

function MCPPage() {
  const [mcpServersText, setMcpServersText] = useState("{}");
  const [error, setError] = useState("");

  useEffect(() => {
    loadConfig()
      .then((cfg) => setMcpServersText(JSON.stringify(cfg.mcp_servers ?? {}, null, 2)))
      .catch((e) => setError(e instanceof Error ? e.message : "加载 MCP 配置失败"));
  }, []);

  async function handleServersChange(updated: Record<string, Record<string, unknown>>) {
    setError("");
    try {
      const current = await loadConfig();
      const next = await saveConfig({ ...current, mcp_servers: updated });
      setMcpServersText(JSON.stringify(next.mcp_servers ?? {}, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    }
  }

  return (
    <section className="panel motion-panel page-enter flex h-full min-h-0 min-w-0 flex-1 flex-col rounded-md">
      <div className="panel-header flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Plug className="size-5 text-primary" />
            <p className="font-semibold">MCP 服务器</p>
          </div>
          <p className="text-xs text-muted-foreground">Model Context Protocol 工具服务器管理与连接状态</p>
        </div>
      </div>

      {error ? (
        <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="panel-body min-h-0 flex-1 overflow-y-auto">
        <MCPServersPanel mcpServersText={mcpServersText} setMcpServersText={setMcpServersText} onServersChange={handleServersChange} />
      </div>
    </section>
  );
}

interface MCPServersPanelProps {
  mcpServersText: string;
  setMcpServersText: (text: string) => void;
  onServersChange?: (servers: Record<string, Record<string, unknown>>) => void;
}

type MCPTransport = "streamable_http" | "sse" | "stdio";

const emptyMcpAddForm = {
  name: "",
  transport: "streamable_http" as MCPTransport,
  url: "",
  command: "",
  args: "",
  headers: "",
  authToken: "",
  env: "",
};

function MCPServersPanel({ mcpServersText, setMcpServersText, onServersChange }: MCPServersPanelProps) {
  const [serverStatuses, setServerStatuses] = useState<MCPServerStatus[]>([]);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showToolsFor, setShowToolsFor] = useState<string | null>(null);
  const [toolsData, setToolsData] = useState<MCPToolInfo[]>([]);
  const [isLoadingTools, setIsLoadingTools] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);
  const [addMode, setAddMode] = useState<"form" | "json">("form");
  const [addForm, setAddForm] = useState(emptyMcpAddForm);
  const [addJson, setAddJson] = useState("");
  const [addError, setAddError] = useState("");

  function parseMcpServers(text: string): Record<string, Record<string, unknown>> {
    try {
      return parseJsonObject(text || "{}", "MCP Servers JSON") as Record<string, Record<string, unknown>>;
    } catch {
      return {};
    }
  }

  const servers = parseMcpServers(mcpServersText);

  function normalizeMcpTransport(value: unknown, config: Record<string, unknown>): MCPTransport {
    if (value == null || value === "") return config.command ? "stdio" : "streamable_http";
    if (value === "http" || value === "streamable-http" || value === "streamable_http") return "streamable_http";
    if (value === "sse") return "sse";
    if (value === "stdio") return "stdio";
    throw new Error("transport 只支持 streamable_http、sse 或 stdio");
  }

  function parseStringMap(text: string, label: string) {
    const trimmed = text.trim();
    const result: Record<string, string> = {};
    if (!trimmed) return result;
    if (trimmed.startsWith("{")) {
      const parsed = parseJsonObject(trimmed, label);
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value !== "string") throw new Error(`${label}.${key} 必须是字符串`);
        result[key] = value;
      }
      return result;
    }
    for (const line of trimmed.split("\n")) {
      if (!line.trim()) continue;
      const idx = line.indexOf(":");
      if (idx <= 0) throw new Error(`${label} 每行格式应为 key: value`);
      result[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    return result;
  }

  function validateMcpServersConfig(input: unknown) {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      throw new Error('JSON 必须是对象，如 {"server-name": {"transport": "streamable_http", "url": "https://example.com/mcp"}}');
    }
    const normalized: Record<string, Record<string, unknown>> = {};
    for (const [name, rawConfig] of Object.entries(input)) {
      if (!/^[A-Za-z0-9_-]+$/.test(name)) {
        throw new Error(`服务器名称 "${name}" 只能包含字母、数字、下划线和连字符`);
      }
      if (typeof rawConfig !== "object" || rawConfig === null || Array.isArray(rawConfig)) {
        throw new Error(`${name} 的配置必须是对象`);
      }
      const config = { ...(rawConfig as Record<string, unknown>) };
      const transport = normalizeMcpTransport(config.transport, config);
      config.transport = transport;
      if (transport === "stdio") {
        if (typeof config.command !== "string" || !config.command.trim()) {
          throw new Error(`${name} 的 stdio 配置需要 command`);
        }
        if (typeof config.args === "string") {
          config.args = config.args.trim() ? config.args.trim().split(/\s+/) : [];
        }
        if (config.args != null && !Array.isArray(config.args)) {
          throw new Error(`${name} 的 args 必须是字符串数组`);
        }
        if (Array.isArray(config.args) && !config.args.every((item) => typeof item === "string")) {
          throw new Error(`${name} 的 args 必须是字符串数组`);
        }
      } else if (typeof config.url !== "string" || !/^https?:\/\/.+/i.test(config.url)) {
        throw new Error(`${name} 的 ${transport} 配置需要 http(s) URL`);
      }
      if (config.headers != null && (typeof config.headers !== "object" || Array.isArray(config.headers))) {
        throw new Error(`${name} 的 headers 必须是对象`);
      }
      if (config.env != null && (typeof config.env !== "object" || Array.isArray(config.env))) {
        throw new Error(`${name} 的 env 必须是对象`);
      }
      normalized[name] = config;
    }
    return normalized;
  }

  function loadStatus() {
    setIsLoadingStatus(true);
    getMcpStatus()
      .then((res) => setServerStatuses(res.servers))
      .catch(() => setServerStatuses([]))
      .finally(() => setIsLoadingStatus(false));
  }

  function reconnectServers() {
    setIsLoadingStatus(true);
    reconnectMcpServers()
      .then((res) => setServerStatuses(res.servers))
      .catch(() => setServerStatuses([]))
      .finally(() => setIsLoadingStatus(false));
  }

  useEffect(() => {
    loadStatus();
  }, []);

  useEffect(() => {
    const hasPendingServer = serverStatuses.some((status) => status.status === "connecting" || status.status === "auth_required");
    if (!hasPendingServer) return;
    const timer = window.setInterval(loadStatus, 3000);
    return () => window.clearInterval(timer);
  }, [serverStatuses]);

  function handleViewTools(serverName: string) {
    setShowToolsFor(serverName);
    setIsLoadingTools(true);
    setToolsData([]);
    getMcpTools(serverName)
      .then((res) => setToolsData(res.tools))
      .catch(() => setToolsData([]))
      .finally(() => setIsLoadingTools(false));
  }

  function syncServersToDraft(updated: Record<string, Record<string, unknown>>) {
    setMcpServersText(JSON.stringify(updated, null, 2));
    onServersChange?.(updated);
  }

  function handleDeleteServer(name: string) {
    const updated = { ...servers };
    delete updated[name];
    syncServersToDraft(updated);
    deleteMcpOAuth(name).catch(() => {});
  }

  function handleAddFromForm() {
    setAddError("");
    const name = addForm.name.trim();
    if (!name) {
      setAddError("请输入服务器名称");
      return;
    }
    if (servers[name]) {
      setAddError("该名称已存在");
      return;
    }

    const config: Record<string, unknown> = { transport: addForm.transport };
    if (addForm.transport === "streamable_http" || addForm.transport === "sse") {
      if (!addForm.url.trim()) {
        setAddError("HTTP/SSE 模式需要填写 URL");
        return;
      }
      config.url = addForm.url.trim();
    } else {
      if (!addForm.command.trim()) {
        setAddError("stdio 模式需要填写 command");
        return;
      }
      config.command = addForm.command.trim();
      if (addForm.args.trim()) {
        config.args = addForm.args.trim().split(/\s+/);
      }
    }

    try {
      const headers = parseStringMap(addForm.headers, "Headers");
      if (Object.keys(headers).length > 0) {
        config.headers = headers;
      }
      const env = parseStringMap(addForm.env, "Env");
      if (Object.keys(env).length > 0) {
        config.env = env;
      }
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "配置格式错误");
      return;
    }

    if (addForm.authToken.trim()) {
      if (addForm.transport === "stdio") {
        config.env = {
          ...((config.env as Record<string, string> | undefined) ?? {}),
          MCP_AUTH_TOKEN: addForm.authToken.trim(),
        };
      } else {
        config.auth = { type: "bearer", token: addForm.authToken.trim() };
      }
    }

    let updated: Record<string, Record<string, unknown>>;
    try {
      updated = validateMcpServersConfig({ ...servers, [name]: config });
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "MCP 配置格式错误");
      return;
    }
    syncServersToDraft(updated);
    setAddForm(emptyMcpAddForm);
    setShowAddForm(false);
  }

  function handleAddFromJson() {
    setAddError("");
    try {
      const parsed = parseJsonObject(addJson, "MCP JSON");
      const normalized = validateMcpServersConfig(parsed);
      const updated = validateMcpServersConfig({ ...servers, ...normalized });
      syncServersToDraft(updated);
      setAddJson("");
      setShowAddForm(false);
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "JSON 格式错误，请检查语法");
    }
  }

  function startOAuthLogin(serverName: string) {
    window.open(getMcpOAuthAuthorizeUrl(serverName), "_blank", "noopener,noreferrer");
  }

  function maskConfigValue(key: string, value: string) {
    if (!/(authorization|token|secret|password|api-?key|key)/i.test(key)) return value;
    if (value.length <= 8) return "*".repeat(value.length);
    return `${value.slice(0, 4)}********${value.slice(-4)}`;
  }

  const statusMap = new Map(serverStatuses.map((s) => [s.name, s]));

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold">MCP Servers</p>
          <Badge variant="outline">{Object.keys(servers).length} servers</Badge>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadStatus} disabled={isLoadingStatus}>
            {isLoadingStatus ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={reconnectServers} disabled={isLoadingStatus}>
            <Zap />
            Reconnect
          </Button>
          <Button size="sm" onClick={() => { setShowAddForm(true); setAddError(""); }} disabled={showAddForm}>
            <Plus />
            Add
          </Button>
        </div>
      </div>

      {/* Add form */}
      {showAddForm ? (
        <div className="rounded-lg border border-primary/40 bg-background/60 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">添加 MCP 服务器</p>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setShowAddForm(false); setAddError(""); }}>
              <X className="size-4" />
            </Button>
          </div>

          {/* Mode toggle */}
          <div className="flex rounded-md border border-border/80 bg-muted/40 p-1">
            <button
              className={cn(
                "h-7 rounded-sm px-3 text-xs font-medium transition-all",
                addMode === "form" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setAddMode("form")}
              type="button"
            >
              表单模式
            </button>
            <button
              className={cn(
                "h-7 rounded-sm px-3 text-xs font-medium transition-all",
                addMode === "json" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setAddMode("json")}
              type="button"
            >
              JSON 模式
            </button>
          </div>

          {addMode === "form" ? (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="服务器名称">
                  <Input
                    placeholder="my-server"
                    value={addForm.name}
                    onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </Field>
                <Field label="传输方式">
                  <div className="flex rounded-md border border-border/80 bg-muted/40 p-1">
                    <button
                      className={cn(
                        "h-8 flex-1 rounded-sm text-xs font-medium transition-all",
                        addForm.transport === "streamable_http" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                      )}
                      onClick={() => setAddForm((f) => ({ ...f, transport: "streamable_http" }))}
                      type="button"
                    >
                      HTTP
                    </button>
                    <button
                      className={cn(
                        "h-8 flex-1 rounded-sm text-xs font-medium transition-all",
                        addForm.transport === "sse" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                      )}
                      onClick={() => setAddForm((f) => ({ ...f, transport: "sse" }))}
                      type="button"
                    >
                      SSE
                    </button>
                    <button
                      className={cn(
                        "h-8 flex-1 rounded-sm text-xs font-medium transition-all",
                        addForm.transport === "stdio" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                      )}
                      onClick={() => setAddForm((f) => ({ ...f, transport: "stdio" }))}
                      type="button"
                    >
                      stdio
                    </button>
                  </div>
                </Field>
              </div>
              {addForm.transport === "streamable_http" || addForm.transport === "sse" ? (
                <>
                  <Field label="URL">
                    <Input
                      placeholder={addForm.transport === "streamable_http" ? "https://example.com/mcp" : "http://localhost:3001/sse"}
                      value={addForm.url}
                      onChange={(e) => setAddForm((f) => ({ ...f, url: e.target.value }))}
                    />
                  </Field>
                  <Field label="Bearer Token（可选）">
                    <Input
                      type="password"
                      placeholder="OAuth access token"
                      value={addForm.authToken}
                      onChange={(e) => setAddForm((f) => ({ ...f, authToken: e.target.value }))}
                    />
                  </Field>
                  <Field label="Headers（可选，每行 key: value 或 JSON 对象）">
                    <Textarea
                      className="min-h-[60px] font-mono text-xs"
                      spellCheck={false}
                      placeholder={"Authorization: Bearer token123\nX-Custom-Header: value"}
                      value={addForm.headers}
                      onChange={(e) => setAddForm((f) => ({ ...f, headers: e.target.value }))}
                    />
                  </Field>
                </>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Command">
                    <Input
                      placeholder="npx"
                      value={addForm.command}
                      onChange={(e) => setAddForm((f) => ({ ...f, command: e.target.value }))}
                    />
                  </Field>
                  <Field label="Args（空格分隔）">
                    <Input
                      placeholder="-y @modelcontextprotocol/server-memory"
                      value={addForm.args}
                      onChange={(e) => setAddForm((f) => ({ ...f, args: e.target.value }))}
                    />
                  </Field>
                  <Field label="Auth Token（写入 MCP_AUTH_TOKEN，可选）">
                    <Input
                      type="password"
                      placeholder="stdio server token"
                      value={addForm.authToken}
                      onChange={(e) => setAddForm((f) => ({ ...f, authToken: e.target.value }))}
                    />
                  </Field>
                  <Field label="Env（可选，每行 key: value 或 JSON 对象）">
                    <Textarea
                      className="min-h-[60px] font-mono text-xs"
                      spellCheck={false}
                      placeholder={"API_KEY: token123\nBASE_URL: https://example.com"}
                      value={addForm.env}
                      onChange={(e) => setAddForm((f) => ({ ...f, env: e.target.value }))}
                    />
                  </Field>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                粘贴 JSON，格式：{'{'}"server-name": {'{'}"transport": "streamable_http", "url": "https://example.com/mcp"{'}'}{'}'}；stdio 使用 command/args/env。
              </p>
              <Textarea
                className="min-h-[120px] font-mono text-xs"
                spellCheck={false}
                placeholder={'{\n  "longbridge": {\n    "transport": "streamable_http",\n    "url": "https://openapi.longbridge.com/mcp"\n  },\n  "remote": {\n    "transport": "streamable_http",\n    "url": "https://example.com/mcp",\n    "auth": { "type": "bearer", "token": "..." }\n  },\n  "oauth-client": {\n    "transport": "streamable_http",\n    "url": "https://example.com/mcp",\n    "auth": {\n      "type": "oauth_client_credentials",\n      "token_url": "https://example.com/oauth/token",\n      "client_id": "...",\n      "client_secret": "...",\n      "scope": "search"\n    }\n  },\n  "local": {\n    "transport": "stdio",\n    "command": "npx",\n    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]\n  }\n}'}
                value={addJson}
                onChange={(e) => setAddJson(e.target.value)}
              />
            </div>
          )}

          {addError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {addError}
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => { setShowAddForm(false); setAddError(""); }}>
              Cancel
            </Button>
            <Button size="sm" onClick={addMode === "form" ? handleAddFromForm : handleAddFromJson}>
              <Plus />
              Add Server
            </Button>
          </div>
        </div>
      ) : null}

      {/* Server list */}
      {Object.keys(servers).length > 0 ? (
        <div className="space-y-2">
          {Object.entries(servers).map(([name, config]) => {
            const status = statusMap.get(name);
            const transport = String(config.transport || (config.command ? "stdio" : "streamable_http"));
            const statusColor =
              !status
                ? "text-amber-500"
                : status.status === "connecting"
                  ? "text-blue-500"
                : status.status === "auth_required"
                  ? "text-amber-500"
                : status.status === "connected"
                ? "text-green-500"
                : status.status === "error"
                  ? "text-destructive"
                  : "text-muted-foreground";
            const statusLabel =
              !status
                ? "unsaved"
                : status.status === "connecting"
                  ? "connecting"
                : status.status === "auth_required"
                  ? "login required"
                : status.status === "connected"
                ? "connected"
                : status.status === "error"
                  ? "error"
                  : "disconnected";

            return (
              <div
                key={name}
                className="message-bubble rounded-lg border border-border/80 bg-card/80 p-3 transition-colors hover:border-primary/50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <CircleDot className={cn("size-3", statusColor)} />
                      <span className="truncate text-sm font-semibold">{name}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {transport}
                      </Badge>
                      <span className={cn("text-[11px]", statusColor)}>{statusLabel}</span>
                      {status?.tools_count ? (
                        <span className="text-[11px] text-muted-foreground">{status.tools_count} tools</span>
                      ) : null}
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {transport === "streamable_http" || transport === "sse"
                        ? (config.url as string) || "未配置 URL"
                        : [config.command, ...(Array.isArray(config.args) ? (config.args as string[]) : [])].join(" ")}
                    </p>
                    {config.headers && typeof config.headers === "object" && Object.keys(config.headers).length > 0 ? (
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">
                        headers: {Object.entries(config.headers as Record<string, string>).map(([k, v]) => `${k}: ${maskConfigValue(k, v)}`).join("; ")}
                      </p>
                    ) : null}
                    {config.auth ? (
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">auth: configured</p>
                    ) : null}
                    {config.env && typeof config.env === "object" && Object.keys(config.env).length > 0 ? (
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">
                        env: {Object.entries(config.env as Record<string, string>).map(([k, v]) => `${k}: ${maskConfigValue(k, v)}`).join("; ")}
                      </p>
                    ) : null}
                    {status?.error ? (
                      <p className="mt-1 truncate text-xs text-destructive">{status.error}</p>
                    ) : null}
                    {!status ? (
                      <p className="mt-1 truncate text-xs text-amber-700 dark:text-amber-300">配置只在当前草稿中，尚未写入 config.json。</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    {status?.status === "auth_required" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => startOAuthLogin(name)}
                      >
                        <ExternalLink className="size-3" />
                        Login
                      </Button>
                    ) : status?.oauth_enabled ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => startOAuthLogin(name)}
                      >
                        <ExternalLink className="size-3" />
                        Re-login
                      </Button>
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={!status}
                      onClick={() => handleViewTools(name)}
                    >
                      <Eye className="size-3" />
                      Tools
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDeleteServer(name)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid min-h-40 place-items-center rounded-md border border-dashed border-border/80 bg-muted/20 px-4 py-10 text-center">
          <div>
            <Cpu className="mx-auto mb-3 size-8 text-muted-foreground" />
            <p className="text-sm font-medium">暂无 MCP 服务器</p>
            <p className="mt-1 text-xs text-muted-foreground">点击上方 Add 按钮添加 MCP 服务器配置。</p>
          </div>
        </div>
      )}

      {/* Tools dialog overlay */}
      {showToolsFor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowToolsFor(null)}>
          <div
            className="mx-4 max-h-[70vh] w-full max-w-xl overflow-hidden rounded-lg border border-border bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border/80 p-4">
              <div>
                <p className="font-semibold">{showToolsFor} - Tools</p>
                <p className="text-xs text-muted-foreground">{toolsData.length} tools available</p>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowToolsFor(null)}>
                <X className="size-4" />
              </Button>
            </div>
            <div className="max-h-[calc(70vh-60px)] overflow-y-auto p-4">
              {isLoadingTools ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : toolsData.length > 0 ? (
                <div className="space-y-3">
                  {toolsData.map((tool) => (
                    <div key={tool.name} className="rounded-md border border-border/80 bg-background/50 p-3">
                      <div className="flex items-center gap-2">
                        <TerminalSquare className="size-3.5 text-primary" />
                        <span className="text-sm font-semibold">{tool.name}</span>
                      </div>
                      {tool.description ? (
                        <p className="mt-1 text-xs text-muted-foreground">{tool.description}</p>
                      ) : null}
                      {Object.keys(tool.parameters?.properties as Record<string, unknown> || {}).length > 0 ? (
                        <div className="mt-2 space-y-1">
                          <p className="text-[10px] uppercase text-muted-foreground">Parameters</p>
                          <div className="grid gap-1">
                            {Object.entries(
                              (tool.parameters?.properties as Record<string, Record<string, unknown>>) || {},
                            ).map(([pName, pSchema]) => (
                              <div key={pName} className="flex items-center gap-2 text-xs">
                                <code className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-primary">{pName}</code>
                                <span className="text-muted-foreground">{(pSchema.type as string) || "any"}</span>
                                {(tool.parameters?.required as string[])?.includes(pName) ? (
                                  <Badge variant="danger" className="text-[9px] h-4">
                                    required
                                  </Badge>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  未发现工具。服务器可能未连接或尚未注册工具。
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Collapsible raw JSON */}
      <div className="rounded-lg border border-border/80">
        <button
          className="flex w-full items-center justify-between px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
          onClick={() => setShowRawJson((v) => !v)}
          type="button"
        >
          <span className="font-medium">Raw JSON</span>
          {showRawJson ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>
        {showRawJson ? (
          <div className="border-t border-border/80 p-3">
            <Textarea
              className="min-h-[200px] font-mono text-xs"
              spellCheck={false}
              value={mcpServersText}
              onChange={(event) => setMcpServersText(event.target.value)}
              onBlur={() => {
                try {
                  const parsed = validateMcpServersConfig(parseJsonObject(mcpServersText || "{}", "MCP Servers JSON"));
                  onServersChange?.(parsed);
                } catch { /* invalid JSON, ignore */ }
              }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Skills Management ──────────────────────────────────────────────────────────

function SkillsPage() {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [toggling, setToggling] = useState<string | null>(null);

  function loadSkills() {
    setIsLoading(true);
    setError("");
    refreshSkills().catch(() => {})
      .then(() => listSkills())
      .then((res) => setSkills(res.skills))
      .catch((e) => setError(e instanceof Error ? e.message : "加载技能列表失败"))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    loadSkills();
  }, []);

  async function handleToggle(name: string, enabled: boolean) {
    setToggling(name);
    try {
      await toggleSkill(name, !enabled);
      setSkills((prev) => prev.map((s) => s.name === name ? { ...s, enabled: !enabled } : s));
    } catch (e) {
      setError(e instanceof Error ? e.message : "切换失败");
    } finally {
      setToggling(null);
    }
  }

  return (
    <section className="panel motion-panel page-enter flex h-full min-h-0 min-w-0 flex-1 flex-col rounded-md">
      <div className="panel-header flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Zap className="size-5 text-secondary" />
            <p className="font-semibold">技能管理</p>
          </div>
          <p className="text-xs text-muted-foreground">Markdown 技能定义，Agent 可动态调用</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{skills.length} skills</Badge>
          <Button variant="outline" size="sm" onClick={loadSkills} disabled={isLoading}>
            {isLoading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Refresh
          </Button>
        </div>
      </div>

      <div className="panel-body min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : skills.length > 0 ? (
          <div className="space-y-2">
            {skills.map((skill) => (
              <div
                key={skill.name}
                className="message-bubble rounded-lg border border-border/80 bg-card/80 p-3 transition-colors hover:border-primary/50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">{skill.name}</span>
                      <Badge variant={skill.enabled ? "default" : "muted"}>
                        {skill.enabled ? "ON" : "OFF"}
                      </Badge>
                    </div>
                    {skill.description ? (
                      <p className="mt-1 text-xs text-muted-foreground">{skill.description}</p>
                    ) : null}
                    {skill.file_path ? (
                      <p className="mt-1 truncate text-[10px] font-mono text-muted-foreground/60">
                        {skill.file_path}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    variant={skill.enabled ? "outline" : "default"}
                    size="sm"
                    className="h-7 text-xs shrink-0"
                    disabled={toggling === skill.name}
                    onClick={() => handleToggle(skill.name, skill.enabled)}
                  >
                    {toggling === skill.name ? (
                      <Loader2 className="animate-spin" />
                    ) : skill.enabled ? (
                      "Disable"
                    ) : (
                      "Enable"
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid min-h-40 place-items-center rounded-md border border-dashed border-border/80 bg-muted/20 px-4 py-10 text-center">
            <div>
              <Zap className="mx-auto mb-3 size-8 text-muted-foreground" />
              <p className="text-sm font-medium">暂无技能</p>
              <p className="mt-1 text-xs text-muted-foreground">在 workspace/skills/ 目录下添加 Markdown 技能文件。</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Scheduler Page ──────────────────────────────────────────────────────────

const cronTemplates = [
  { label: "每分钟", value: "* * * * *" },
  { label: "每5分钟", value: "*/5 * * * *" },
  { label: "每30分钟", value: "*/30 * * * *" },
  { label: "每小时", value: "0 * * * *" },
  { label: "每天 9:00", value: "0 9 * * *" },
  { label: "工作日 9:00", value: "0 9 * * 1-5" },
  { label: "每天 18:00", value: "0 18 * * *" },
  { label: "每天 22:00", value: "0 22 * * *" },
];

function humanizeSchedule(expr: string): string {
  const m = cronTemplates.find((t) => t.value === expr);
  if (m) return m.label;
  return expr;
}

function SchedulerPage() {
  const [tasks, setTasks] = useState<SchedulerTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", prompt: "", schedule: "0 9 * * *", enabled: true });
  const [isCreating, setIsCreating] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  function loadTasks() {
    setIsLoading(true);
    setError("");
    listSchedulerTasks()
      .then((res) => setTasks(res.tasks))
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { loadTasks(); }, []);

  async function handleCreate() {
    if (!form.name.trim() || !form.prompt.trim() || !form.schedule.trim()) return;
    setIsCreating(true);
    setError("");
    try {
      await createSchedulerTask({ name: form.name.trim(), prompt: form.prompt.trim(), schedule: form.schedule.trim(), enabled: form.enabled });
      setShowForm(false);
      setForm({ name: "", prompt: "", schedule: "0 9 * * *", enabled: true });
      loadTasks();
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleToggle(id: string) {
    setTogglingId(id);
    try {
      const res = await toggleSchedulerTask(id);
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, enabled: res.enabled } : t)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "切换失败");
    } finally {
      setTogglingId(null);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("确定删除该任务？")) return;
    try {
      await deleteSchedulerTask(id);
      setTasks((prev) => prev.filter((t) => t.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  }

  return (
    <section className="panel motion-panel page-enter flex h-full min-h-0 min-w-0 flex-1 flex-col rounded-md">
      <div className="panel-header flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Clock className="size-5 text-secondary" />
            <p className="font-semibold">定时任务</p>
          </div>
          <p className="text-xs text-muted-foreground">Cron / 间隔 / 一次性调度</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{tasks.length} tasks</Badge>
          <Button variant="outline" size="sm" onClick={loadTasks} disabled={isLoading}>
            {isLoading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowForm(true)} disabled={showForm}>
            <Plus />
            Add Task
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mx-3 mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      ) : null}

      <div className="panel-body min-h-0 flex-1 overflow-y-auto">
        {showForm ? (
          <div className="mb-3 rounded-lg border border-primary/40 bg-background/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">创建定时任务</p>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowForm(false)}>
                <X className="size-4" />
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="任务名称">
                <Input placeholder="每日开盘简报" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </Field>
              <Field label="Cron 表达式">
                <Input placeholder="0 9 * * 1-5" value={form.schedule} onChange={(e) => setForm((f) => ({ ...f, schedule: e.target.value }))} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {cronTemplates.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  className={cn(
                    "rounded-md border px-2 py-1 text-[11px] transition-colors",
                    form.schedule === t.value ? "border-primary bg-primary/10 text-primary" : "border-border/80 text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setForm((f) => ({ ...f, schedule: t.value }))}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <Field label="执行提示词">
              <Textarea
                className="min-h-[80px]"
                placeholder="总结今天美股开盘信号，关注 AAPL、MSFT、NVDA 的异动"
                value={form.prompt}
                onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
              />
            </Field>
            <div className="flex items-center justify-between">
              <ToggleRow checked={form.enabled} icon={<Clock className="size-4 text-primary" />} label="创建后启用" onCheckedChange={(c) => setForm((f) => ({ ...f, enabled: c }))} />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
                <Button size="sm" onClick={handleCreate} disabled={isCreating || !form.name.trim() || !form.prompt.trim()}>
                  {isCreating ? <Loader2 className="animate-spin" /> : <Plus />}
                  Create
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {isLoading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
        ) : tasks.length > 0 ? (
          <div className="space-y-2">
            {tasks.map((task) => (
              <div key={task.id} className={cn("message-bubble rounded-lg border bg-card/80 p-3 transition-colors hover:border-primary/50", task.enabled ? "border-border/80" : "border-border/40 opacity-70")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={cn("size-2 rounded-full", task.enabled ? "bg-green-500" : "bg-muted-foreground/40")} />
                      <span className="truncate text-sm font-semibold">{task.name}</span>
                      <Badge variant={task.enabled ? "default" : "muted"}>{task.enabled ? "ON" : "OFF"}</Badge>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{task.prompt}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                      <span className="font-mono">{task.schedule}</span>
                      <span>{humanizeSchedule(task.schedule)}</span>
                      {task.last_run ? <span>Last: {task.last_run}</span> : null}
                      {task.run_count > 0 ? <span>Runs: {task.run_count}</span> : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Button variant="outline" size="sm" className="h-7 text-xs" disabled={togglingId === task.id} onClick={() => handleToggle(task.id)}>
                      {togglingId === task.id ? <Loader2 className="size-3 animate-spin" /> : task.enabled ? "Disable" : "Enable"}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(task.id)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid min-h-40 place-items-center rounded-md border border-dashed border-border/80 bg-muted/20 px-4 py-10 text-center">
            <div>
              <Clock className="mx-auto mb-3 size-8 text-muted-foreground" />
              <p className="text-sm font-medium">暂无定时任务</p>
              <p className="mt-1 text-xs text-muted-foreground">点击 Add Task 创建 Cron 或间隔调度。</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Memory Page ──────────────────────────────────────────────────────────────

function MemoryPage() {
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [files, setFiles] = useState<MemoryFile[]>([]);
  const [results, setResults] = useState<MemorySearchResult[]>([]);
  const [query, setQuery] = useState("");
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addContent, setAddContent] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.allSettled([getMemoryStatus(), listMemoryFiles()])
      .then(([statusRes, filesRes]) => {
        if (statusRes.status === "fulfilled") setStatus(statusRes.value);
        if (filesRes.status === "fulfilled") setFiles(filesRes.value.files);
      })
      .finally(() => setIsLoading(false));
  }, []);

  function handleSearch() {
    const text = query.trim();
    if (!text || isSearching) return;
    setIsSearching(true);
    setError("");
    searchMemory(text, { limit: 20 })
      .then((res) => setResults(res))
      .catch((e) => setError(e instanceof Error ? e.message : "搜索失败"))
      .finally(() => setIsSearching(false));
  }

  function handleSync() {
    setIsSyncing(true);
    syncMemory()
      .then(() => getMemoryStatus().then(setStatus))
      .catch((e) => setError(e instanceof Error ? e.message : "同步失败"))
      .finally(() => setIsSyncing(false));
  }

  async function handleExpand(path: string) {
    if (expandedPath === path) {
      setExpandedPath(null);
      setFileContent(null);
      return;
    }
    setExpandedPath(path);
    setFileContent(null);
    try {
      const res = await getMemoryFile(path);
      setFileContent(res.content);
    } catch {
      setFileContent("加载失败");
    }
  }

  async function handleAdd() {
    if (!addContent.trim() || isAdding) return;
    setIsAdding(true);
    try {
      await addMemory(addContent.trim());
      setAddContent("");
      setShowAddForm(false);
      listMemoryFiles().then((res) => setFiles(res.files));
      getMemoryStatus().then(setStatus);
    } catch (e) {
      setError(e instanceof Error ? e.message : "添加失败");
    } finally {
      setIsAdding(false);
    }
  }

  return (
    <section className="panel motion-panel page-enter flex h-full min-h-0 min-w-0 flex-1 flex-col rounded-md">
      <div className="panel-header flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <BrainCircuit className="size-5 text-primary" />
            <p className="font-semibold">长期记忆</p>
          </div>
          <p className="text-xs text-muted-foreground">混合搜索 · 向量 + FTS5 关键词</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleSync} disabled={isSyncing}>
            {isSyncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Sync
          </Button>
          <Button size="sm" onClick={() => setShowAddForm(true)} disabled={showAddForm}>
            <Plus />
            Add
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mx-3 mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      ) : null}

      {status ? (
        <div className="mx-3 mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatusTile icon={<Database className="size-4 text-primary" />} label="Chunks" value={String(status.chunks)} />
          <StatusTile icon={<FileText className="size-4 text-accent" />} label="Files" value={String(status.files)} />
          <StatusTile icon={<RefreshCw className="size-4 text-secondary" />} label="Dirty" value={status.dirty ? "Yes" : "No"} />
          <StatusTile icon={<Cpu className="size-4 text-primary" />} label="Provider" value={status.embedding_provider || "-"} />
        </div>
      ) : null}

      <div className="panel-body min-h-0 flex-1 overflow-y-auto">
        {showAddForm ? (
          <div className="mb-3 rounded-lg border border-primary/40 bg-background/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">添加记忆</p>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowAddForm(false)}>
                <X className="size-4" />
              </Button>
            </div>
            <Field label="记忆内容">
              <Textarea className="min-h-[100px]" placeholder="输入需要记住的内容..." value={addContent} onChange={(e) => setAddContent(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowAddForm(false)}>Cancel</Button>
              <Button size="sm" onClick={handleAdd} disabled={isAdding || !addContent.trim()}>
                {isAdding ? <Loader2 className="animate-spin" /> : <Plus />}
                Add
              </Button>
            </div>
          </div>
        ) : null}

        <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); handleSearch(); }}>
          <Input placeholder="搜索记忆..." value={query} onChange={(e) => setQuery(e.target.value)} />
          <Button type="submit" disabled={isSearching || !query.trim()} className="shrink-0">
            {isSearching ? <Loader2 className="animate-spin" /> : <Search />}
            Search
          </Button>
        </form>

        {results.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{results.length} results</p>
            {results.map((r, i) => (
              <div key={`${r.path}-${i}`} className="rounded-lg border border-border/80 bg-card/80 p-3">
                <div className="flex items-center gap-2">
                  <FileText className="size-3.5 text-primary" />
                  <span className="truncate text-xs font-medium">{r.path}</span>
                  <Badge variant="outline" className="text-[10px]">L{r.start_line}-{r.end_line}</Badge>
                  <span className="text-[11px] text-muted-foreground">score: {r.score.toFixed(3)}</span>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-xs text-muted-foreground line-clamp-4">{r.snippet}</p>
              </div>
            ))}
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
        ) : files.length > 0 ? (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{files.length} memory files</p>
            {files.map((f) => (
              <div key={f.path}>
                <button
                  type="button"
                  className={cn("flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60", expandedPath === f.path && "bg-muted/60")}
                  onClick={() => handleExpand(f.path)}
                >
                  {expandedPath === f.path ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
                  <FileText className="size-3.5 shrink-0 text-primary" />
                  <span className="flex-1 truncate font-medium">{f.path}</span>
                  <span className="text-[10px] text-muted-foreground">{(f.size / 1024).toFixed(1)}KB</span>
                </button>
                {expandedPath === f.path ? (
                  <pre className="mx-3 mb-1 max-h-64 overflow-auto rounded-md border border-border/80 bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">{fileContent ?? "Loading..."}</pre>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="grid min-h-40 place-items-center rounded-md border border-dashed border-border/80 bg-muted/20 px-4 py-10 text-center">
            <div>
              <BrainCircuit className="mx-auto mb-3 size-8 text-muted-foreground" />
              <p className="text-sm font-medium">暂无记忆文件</p>
              <p className="mt-1 text-xs text-muted-foreground">通过对话或手动添加积累记忆。</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Knowledge Page ───────────────────────────────────────────────────────────

function KnowledgePage() {
  const [tree, setTree] = useState<KnowledgeTree | null>(null);
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [viewMode, setViewMode] = useState<"tree" | "graph">("tree");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.allSettled([getKnowledgeTree(), getKnowledgeGraph()])
      .then(([treeRes, graphRes]) => {
        if (treeRes.status === "fulfilled") {
          setTree(treeRes.value);
          const dirs = new Set<string>();
          treeRes.value.tree.forEach((d) => dirs.add(d.dir));
          setExpandedDirs(dirs);
        }
        if (graphRes.status === "fulfilled") setGraph(graphRes.value);
      })
      .finally(() => setIsLoading(false));
  }, []);

  async function handleSelectFile(path: string) {
    setSelectedPath(path);
    setContent(null);
    setIsLoadingContent(true);
    try {
      const res = await getKnowledgeFile(path);
      setContent(res.content);
    } catch {
      setContent("加载失败");
    } finally {
      setIsLoadingContent(false);
    }
  }

  function toggleDir(dir: string) {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir); else next.add(dir);
      return next;
    });
  }

  function matchesSearch(name: string, title: string): boolean {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return name.toLowerCase().includes(q) || title.toLowerCase().includes(q);
  }

  function renderDir(dir: KnowledgeDir, prefix = "") {
    const key = prefix + dir.dir;
    const isExpanded = expandedDirs.has(key);
    const hasMatchingFiles = dir.files.some((f) => matchesSearch(f.name, f.title)) || dir.children.length > 0;

    if (searchQuery.trim() && !hasMatchingFiles) return null;

    return (
      <div key={key}>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/60"
          onClick={() => toggleDir(key)}
        >
          {isExpanded ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
          <span className="font-medium">{dir.dir}</span>
          <Badge variant="muted" className="text-[10px]">{dir.files.length}</Badge>
        </button>
        {isExpanded ? (
          <div className="ml-4">
            {dir.files.filter((f) => matchesSearch(f.name, f.title)).map((f) => (
              <button
                key={f.name}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted/60",
                  selectedPath === `${dir.dir}/${f.name}` && "bg-primary/10 text-primary",
                )}
                onClick={() => handleSelectFile(`${dir.dir}/${f.name}`)}
              >
                <FileText className="size-3.5 shrink-0" />
                <span className="flex-1 truncate">{f.title}</span>
                <span className="text-[10px] text-muted-foreground">{(f.size / 1024).toFixed(1)}KB</span>
              </button>
            ))}
            {dir.children.map((c) => renderDir(c, key + "/"))}
          </div>
        ) : null}
      </div>
    );
  }

  const totalNodes = graph?.nodes.length ?? 0;
  const totalLinks = graph?.links.length ?? 0;

  return (
    <section className="panel motion-panel page-enter flex h-full min-h-0 min-w-0 flex-1 flex-col rounded-md">
      <div className="panel-header flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <BookOpen className="size-5 text-primary" />
            <p className="font-semibold">知识库</p>
          </div>
          <p className="text-xs text-muted-foreground">Markdown 知识文件 · 目录浏览与搜索</p>
        </div>
        <div className="flex items-center gap-2">
          {tree ? <Badge variant="outline">{tree.stats.pages} pages · {(tree.stats.size / 1024).toFixed(0)}KB</Badge> : null}
          <div className="flex rounded-md border border-border/80 bg-muted/40 p-1">
            <button
              className={cn("h-7 rounded-sm px-3 text-xs font-medium transition-all", viewMode === "tree" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}
              onClick={() => setViewMode("tree")} type="button"
            >
              文件
            </button>
            <button
              className={cn("h-7 rounded-sm px-3 text-xs font-medium transition-all", viewMode === "graph" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}
              onClick={() => setViewMode("graph")} type="button"
            >
              图谱 ({totalNodes})
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="mx-3 mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      ) : null}

      <div className="panel-body min-h-0 flex-1 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
        ) : viewMode === "graph" ? (
          <div className="h-full overflow-y-auto p-3">
            {graph && graph.nodes.length > 0 ? (
              <div className="space-y-4">
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span>{totalNodes} nodes</span>
                  <span>{totalLinks} links</span>
                </div>
                <div className="space-y-1">
                  {graph.nodes.map((node) => {
                    const linkedCount = graph.links.filter((l) => l.source === node.id || l.target === node.id).length;
                    return (
                      <button
                        key={node.id}
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md border border-border/80 bg-card/80 px-3 py-2 text-left transition-colors hover:border-primary/50"
                        onClick={() => handleSelectFile(node.id)}
                      >
                        <FileText className="size-3.5 shrink-0 text-primary" />
                        <span className="flex-1 truncate text-sm font-medium">{node.label}</span>
                        <Badge variant="muted" className="text-[10px]">{node.category}</Badge>
                        {linkedCount > 0 ? <span className="text-[10px] text-muted-foreground">{linkedCount} links</span> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="grid h-full min-h-40 place-items-center rounded-md border border-dashed border-border/80 bg-muted/20 px-4 py-10 text-center">
                <div>
                  <BookOpen className="mx-auto mb-3 size-8 text-muted-foreground" />
                  <p className="text-sm font-medium">暂无知识图谱</p>
                  <p className="mt-1 text-xs text-muted-foreground">在 knowledge/ 目录下添加含内部链接的 Markdown 文件。</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="grid h-full gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
            <div className="flex min-h-0 flex-col overflow-y-auto rounded-lg border border-border/80 bg-background/45 p-2">
              <div className="mb-2">
                <Input placeholder="搜索文件..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="h-8 text-xs" />
              </div>
              {tree && (tree.root_files.length > 0 || tree.tree.length > 0) ? (
                <div className="flex-1 space-y-0.5">
                  {tree.root_files.filter((f) => matchesSearch(f.name, f.title)).map((f) => (
                    <button
                      key={f.name}
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted/60",
                        selectedPath === f.name && "bg-primary/10 text-primary",
                      )}
                      onClick={() => handleSelectFile(f.name)}
                    >
                      <FileText className="size-3.5 shrink-0" />
                      <span className="flex-1 truncate">{f.title}</span>
                    </button>
                  ))}
                  {tree.tree.map((d) => renderDir(d))}
                </div>
              ) : (
                <div className="flex-1 grid place-items-center px-3 text-center">
                  <div>
                    <BookOpen className="mx-auto mb-2 size-6 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">暂无知识文件</p>
                  </div>
                </div>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border/80 bg-background/45">
              {selectedPath ? (
                <div className="p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <FileText className="size-4 text-primary" />
                    <span className="text-sm font-semibold">{selectedPath}</span>
                  </div>
                  {isLoadingContent ? (
                    <div className="flex items-center justify-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
                  ) : (
                    <pre className="whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{content ?? ""}</pre>
                  )}
                </div>
              ) : (
                <div className="grid h-full place-items-center px-4 text-center">
                  <div>
                    <BookOpen className="mx-auto mb-3 size-8 text-muted-foreground" />
                    <p className="text-sm font-medium">选择文件查看内容</p>
                    <p className="mt-1 text-xs text-muted-foreground">点击左侧文件树中的文件。</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default App;
