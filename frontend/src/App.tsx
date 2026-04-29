import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Bot,
  BrainCircuit,
  Check,
  Cpu,
  Database,
  Home,
  Loader2,
  MessageSquareText,
  Moon,
  RefreshCw,
  Save,
  Send,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  TerminalSquare,
  Trash2,
  WandSparkles,
} from "lucide-react";

import { MarketPulse } from "@/components/MarketPulse";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { checkHealth, loadConfig, saveConfig, sendChat } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { AppConfig, ChatMessage, ConfigDraft } from "@/types/app";

type Page = "overview" | "chat" | "config";
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
];

const navItems: Array<{ id: Page; label: string; icon: ReactNode; hint: string }> = [
  { id: "overview", label: "概览", icon: <Home />, hint: "状态与信号" },
  { id: "chat", label: "对话", icon: <MessageSquareText />, hint: "Agent chat" },
  { id: "config", label: "配置", icon: <Settings2 />, hint: "运行时参数" },
];

function toDraft(config: AppConfig): ConfigDraft {
  return {
    ...config,
    llm_api_key: "",
    embedding_api_key: "",
    mcp_servers_text: JSON.stringify(config.mcp_servers ?? {}, null, 2),
  };
}

function App() {
  const [page, setPage] = useState<Page>("chat");
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = window.localStorage.getItem("stocks-assistant-theme");
    return stored === "light" || stored === "dark" ? stored : "dark";
  });
  const [messages, setMessages] = useState<ChatMessage[]>([initialMessage]);
  const [prompt, setPrompt] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [draft, setDraft] = useState<ConfigDraft | null>(null);
  const [health, setHealth] = useState<"checking" | "online" | "offline">("checking");
  const [configState, setConfigState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

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
      const [healthResult, configResult] = await Promise.allSettled([checkHealth(), loadConfig()]);
      if (!mounted) return;

      setHealth(healthResult.status === "fulfilled" ? "online" : "offline");
      if (configResult.status === "fulfilled") {
        setConfig(configResult.value);
        setDraft(toDraft(configResult.value));
      } else {
        setError(configResult.reason instanceof Error ? configResult.reason.message : "配置加载失败");
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
    setMessages((current) => [...current, userMessage, pendingMessage]);

    try {
      const response = await sendChat(text);
      setMessages((current) =>
        current.map((item) =>
          item.id === pendingMessage.id
            ? {
                ...item,
                content: response.response || "没有返回内容。",
                pending: false,
                createdAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
              }
            : item,
        ),
      );
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "对话请求失败";
      setError(message);
      setMessages((current) =>
        current.map((item) =>
          item.id === pendingMessage.id
            ? {
                ...item,
                content: `请求失败：${message}`,
                pending: false,
              }
            : item,
        ),
      );
    } finally {
      setIsSending(false);
    }
  }

  async function handleSaveConfig() {
    if (!draft) return;

    setConfigState("saving");
    setError("");

    try {
      const mcpServers = JSON.parse(draft.mcp_servers_text || "{}") as Record<string, Record<string, unknown>>;
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
      };

      if (draft.llm_api_key.trim()) {
        payload.llm_api_key = draft.llm_api_key.trim();
      }
      if (draft.embedding_api_key.trim()) {
        payload.embedding_api_key = draft.embedding_api_key.trim();
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
                setMessages={setMessages}
                setPage={setPage}
                setPrompt={setPrompt}
              />
            ) : null}

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
        <nav className="space-y-1 p-2" aria-label="桌面导航">
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
        <div className="mt-auto space-y-3 p-3">
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
    <div className="page-enter grid h-full min-h-0 flex-1 gap-3 overflow-y-auto xl:grid-cols-[minmax(0,1fr)_380px] xl:gap-4 xl:overflow-hidden">
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

      <section className="panel motion-panel min-h-0 min-w-0 rounded-md xl:flex xl:h-full xl:flex-col">
        <div className="panel-header">
          <p className="font-semibold">Signal Deck</p>
          <p className="text-xs text-muted-foreground">市场状态预览</p>
        </div>
        <div className="panel-body xl:min-h-0 xl:flex-1">
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
  setMessages,
  setPage,
  setPrompt,
}: {
  endRef: React.RefObject<HTMLDivElement | null>;
  handleSend: (event?: { preventDefault: () => void }, value?: string) => void;
  isSending: boolean;
  messages: ChatMessage[];
  prompt: string;
  quickPrompts: string[];
  setMessages: (messages: ChatMessage[]) => void;
  setPage: (page: Page) => void;
  setPrompt: (value: string) => void;
}) {
  return (
    <div className="page-enter flex h-full min-h-0 flex-1 flex-col gap-3 overflow-y-auto xl:grid xl:grid-cols-[minmax(0,1fr)_340px] xl:gap-4 xl:overflow-hidden">
      <section className="panel motion-panel flex min-h-[520px] min-w-0 flex-1 flex-col rounded-md xl:min-h-0">
        <div className="panel-header flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Bot className="size-5 text-primary" />
              <p className="font-semibold">Agent Chat</p>
            </div>
            <p className="text-xs text-muted-foreground">同步对话接口：/api/v1/agent/chat</p>
          </div>
          <Button aria-label="清空对话" variant="outline" size="sm" onClick={() => setMessages([initialMessage])}>
            <Trash2 />
            Clear
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4 sm:py-4">
          <div className="space-y-4">
            {messages.map((message) => (
              <div className={cn("flex gap-2 sm:gap-3", message.role === "user" ? "justify-end" : "justify-start")} key={message.id}>
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
                  <div className="whitespace-pre-wrap break-words">{message.content}</div>
                  <div
                    className={cn(
                      "mt-2 text-[11px]",
                      message.role === "user" ? "text-primary-foreground/70" : "text-muted-foreground",
                    )}
                  >
                    {message.createdAt}
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

      <aside className="panel motion-panel min-h-0 min-w-0 rounded-md xl:flex xl:h-full xl:flex-col">
        <div className="panel-header flex items-center justify-between">
          <div>
            <p className="font-semibold">Prompt Dock</p>
            <p className="text-xs text-muted-foreground">快捷输入</p>
          </div>
          <WandSparkles className="size-5 text-secondary" />
        </div>
        <div className="panel-body space-y-2 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
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
              <TabsTrigger value="features">能力</TabsTrigger>
              <TabsTrigger value="mcp">MCP</TabsTrigger>
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
            </TabsContent>

            <TabsContent value="mcp" className="space-y-3">
              <Field label="MCP Servers JSON">
                <Textarea
                  className="min-h-[320px] font-mono text-xs lg:min-h-[420px]"
                  spellCheck={false}
                  value={draft.mcp_servers_text}
                  onChange={(event) => patchDraft({ mcp_servers_text: event.target.value })}
                />
              </Field>
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

export default App;
