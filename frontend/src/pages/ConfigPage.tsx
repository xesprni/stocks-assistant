import { useState } from "react";
import { Bot, BrainCircuit, Check, Cpu, Database, Loader2, RefreshCw, Save, Send, SlidersHorizontal, TerminalSquare, TrendingUp, WandSparkles } from "lucide-react";

import { Field } from "@/components/common/Field";
import { ToggleRow } from "@/components/common/ToggleRow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { sendTelegramTestMessage } from "@/lib/api";
import { useColorScheme } from "@/lib/color-scheme";
import { toDraft } from "@/lib/config";
import { i18n } from "@/lib/i18n";
import type { AppLanguage } from "@/lib/i18n";
import type { AppConfig, ConfigDraft } from "@/types/app";

export function ConfigPage({
  config,
  configState,
  draft,
  enabledCount,
  handleSaveConfig,
  language,
  patchDraft,
  setDraft,
}: {
  config: AppConfig | null;
  configState: "idle" | "saving" | "saved" | "error";
  draft: ConfigDraft | null;
  enabledCount: number;
  handleSaveConfig: () => void;
  language: AppLanguage;
  patchDraft: (patch: Partial<ConfigDraft>) => void;
  setDraft: (draft: ConfigDraft) => void;
}) {
  const copy = i18n[language].config;
  const [telegramTestMessage, setTelegramTestMessage] = useState("Stocks Assistant Telegram 测试消息");
  const [telegramTestState, setTelegramTestState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [telegramTestResult, setTelegramTestResult] = useState("");

  async function handleTelegramTest() {
    if (!telegramTestMessage.trim()) return;
    setTelegramTestState("sending");
    setTelegramTestResult("");
    try {
      const res = await sendTelegramTestMessage({ message: telegramTestMessage.trim() });
      setTelegramTestState("sent");
      setTelegramTestResult(`${res.detail || "测试消息已发送"}${res.chunks > 1 ? `（${res.chunks} 段）` : ""}`);
    } catch (caught) {
      setTelegramTestState("error");
      setTelegramTestResult(caught instanceof Error ? caught.message : "Telegram 测试发送失败");
    }
  }

  return (
    <section className="panel motion-panel page-enter flex h-full min-h-0 min-w-0 flex-1 flex-col rounded-md">
      <div className="panel-header flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="size-5 text-secondary" />
            <p className="font-semibold">{copy.title}</p>
          </div>
          <p className="text-xs text-muted-foreground">{copy.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{enabledCount}/4 ON</Badge>
          <Button
            aria-label={copy.reload}
            disabled={!config}
            variant="outline"
            size="sm"
            onClick={() => config && setDraft(toDraft(config))}
          >
            <RefreshCw />
            {copy.reload}
          </Button>
          <Button size="sm" disabled={configState === "saving" || !draft} onClick={handleSaveConfig}>
            {configState === "saving" ? <Loader2 className="animate-spin" /> : configState === "saved" ? <Check /> : <Save />}
            {configState === "saving" ? copy.saving : configState === "saved" ? copy.saved : copy.save}
          </Button>
        </div>
      </div>

      {draft ? (
        <div className="panel-body min-h-0 flex-1 overflow-y-auto">
          <Tabs defaultValue="model">
            <TabsList className="grid h-auto w-full grid-cols-2 sm:grid-cols-5">
              <TabsTrigger value="model">{copy.modelTab}</TabsTrigger>
              <TabsTrigger value="agent">{copy.agentTab}</TabsTrigger>
              <TabsTrigger value="longbridge">{copy.longbridgeTab}</TabsTrigger>
              <TabsTrigger value="telegram">{copy.telegramTab}</TabsTrigger>
              <TabsTrigger value="features">{copy.featuresTab}</TabsTrigger>
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
              <Field label={copy.language}>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button
                    size="sm"
                    variant={draft.app_language === "zh" ? "default" : "outline"}
                    onClick={() => patchDraft({ app_language: "zh" })}
                  >
                    {copy.chinese}
                  </Button>
                  <Button
                    size="sm"
                    variant={draft.app_language === "en" ? "default" : "outline"}
                    onClick={() => patchDraft({ app_language: "en" })}
                  >
                    {copy.english}
                  </Button>
                </div>
              </Field>
              <Field label={copy.workspace}>
                <Input value={draft.workspace_dir} onChange={(event) => patchDraft({ workspace_dir: event.target.value })} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label={copy.maxSteps}>
                  <Input
                    min={1}
                    type="number"
                    value={draft.agent_max_steps}
                    onChange={(event) => patchDraft({ agent_max_steps: Number(event.target.value) })}
                  />
                </Field>
                <Field label={copy.contextTokens}>
                  <Input
                    min={1000}
                    step={1000}
                    type="number"
                    value={draft.agent_max_context_tokens}
                    onChange={(event) => patchDraft({ agent_max_context_tokens: Number(event.target.value) })}
                  />
                </Field>
                <Field label={copy.contextTurns}>
                  <Input
                    min={1}
                    type="number"
                    value={draft.agent_max_context_turns}
                    onChange={(event) => patchDraft({ agent_max_context_turns: Number(event.target.value) })}
                  />
                </Field>
              </div>
              <div className="grid gap-3 rounded-md border border-border/80 bg-muted/15 p-3 lg:grid-cols-[minmax(0,1fr)_repeat(3,minmax(120px,160px))]">
                <ToggleRow
                  checked={draft.multi_agent_enabled}
                  icon={<Bot className="size-4 text-primary" />}
                  label={copy.multiAgent}
                  onCheckedChange={(checked) => patchDraft({ multi_agent_enabled: checked })}
                />
                <Field label={copy.parallelLimit}>
                  <Input
                    min={1}
                    type="number"
                    value={draft.multi_agent_max_parallel_agents}
                    onChange={(event) => patchDraft({ multi_agent_max_parallel_agents: Number(event.target.value) })}
                  />
                </Field>
                <Field label={copy.subAgentSteps}>
                  <Input
                    min={1}
                    type="number"
                    value={draft.multi_agent_default_max_steps}
                    onChange={(event) => patchDraft({ multi_agent_default_max_steps: Number(event.target.value) })}
                  />
                </Field>
                <Field label={copy.maxDepth}>
                  <Input
                    min={1}
                    type="number"
                    value={draft.multi_agent_max_depth}
                    onChange={(event) => patchDraft({ multi_agent_max_depth: Number(event.target.value) })}
                  />
                </Field>
              </div>
              <Field label={copy.systemPrompt}>
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

            <TabsContent value="telegram" className="space-y-4">
              <ToggleRow
                checked={draft.telegram_enabled}
                icon={<Send className="size-4 text-primary" />}
                label="启用 Telegram 通知"
                onCheckedChange={(checked) => patchDraft({ telegram_enabled: checked })}
              />
              <div className="grid gap-3 lg:grid-cols-2">
                <Field label="Bot Token">
                  <Input
                    placeholder={draft.has_telegram_bot_token ? draft.telegram_bot_token_masked : "123456:ABC..."}
                    type="password"
                    value={draft.telegram_bot_token}
                    onChange={(event) => patchDraft({ telegram_bot_token: event.target.value })}
                  />
                </Field>
                <Field label="Chat ID">
                  <Input
                    placeholder="@channel 或 chat_id"
                    value={draft.telegram_chat_id ?? ""}
                    onChange={(event) => patchDraft({ telegram_chat_id: event.target.value })}
                  />
                </Field>
                <Field label="API Base">
                  <Input
                    placeholder="https://api.telegram.org"
                    value={draft.telegram_api_base ?? ""}
                    onChange={(event) => patchDraft({ telegram_api_base: event.target.value })}
                  />
                </Field>
                <Field label="Parse Mode">
                  <Input
                    placeholder="留空自动渲染，plain 为纯文本"
                    value={draft.telegram_parse_mode ?? ""}
                    onChange={(event) => patchDraft({ telegram_parse_mode: event.target.value })}
                  />
                </Field>
              </div>
              <div className="rounded-md border border-border/80 bg-muted/15 p-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                  <Field label="测试消息" className="flex-1">
                    <Textarea
                      className="min-h-[72px]"
                      value={telegramTestMessage}
                      onChange={(event) => {
                        setTelegramTestMessage(event.target.value);
                        setTelegramTestState("idle");
                        setTelegramTestResult("");
                      }}
                    />
                  </Field>
                  <Button
                    size="sm"
                    className="lg:mb-0.5"
                    disabled={telegramTestState === "sending" || !telegramTestMessage.trim()}
                    onClick={handleTelegramTest}
                  >
                    {telegramTestState === "sending" ? <Loader2 className="animate-spin" /> : <Send />}
                    Send Test
                  </Button>
                </div>
                <div className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
                  <span>测试使用已保存配置；修改 Token、Chat ID 或开关后请先 Save。</span>
                  {telegramTestResult ? (
                    <span className={telegramTestState === "error" ? "text-destructive" : "text-emerald-600 dark:text-emerald-300"}>
                      {telegramTestResult}
                    </span>
                  ) : null}
                </div>
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
                checked={draft.memory_auto_curate_enabled}
                icon={<WandSparkles className="size-4 text-primary" />}
                label="自动筛选关键记忆"
                onCheckedChange={(checked) => patchDraft({ memory_auto_curate_enabled: checked })}
              />
              <div className="grid gap-3 rounded-md border border-border/80 bg-muted/15 p-3 md:col-span-2 md:grid-cols-2">
                <Field label="记忆重要性阈值">
                  <Input
                    max={1}
                    min={0}
                    step={0.05}
                    type="number"
                    value={draft.memory_curator_min_importance}
                    onChange={(event) => patchDraft({ memory_curator_min_importance: Number(event.target.value) })}
                  />
                </Field>
                <Field label="记忆置信度阈值">
                  <Input
                    max={1}
                    min={0}
                    step={0.05}
                    type="number"
                    value={draft.memory_curator_min_confidence}
                    onChange={(event) => patchDraft({ memory_curator_min_confidence: Number(event.target.value) })}
                  />
                </Field>
              </div>
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
                checked={draft.tracing_enabled}
                icon={<Cpu className="size-4 text-primary" />}
                label="调用追踪"
                onCheckedChange={(checked) => patchDraft({ tracing_enabled: checked })}
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
            {copy.loading}
          </div>
        </div>
      )}
    </section>
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

