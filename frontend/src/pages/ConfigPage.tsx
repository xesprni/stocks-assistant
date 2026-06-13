import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Bot, BrainCircuit, Check, ChevronDown, Cpu, Database, Globe2, KeyRound, Loader2, LockKeyhole, MessageCircle, Plug, RefreshCw, Save, Send, ShieldCheck, SlidersHorizontal, TerminalSquare, TrendingUp, WandSparkles, Wrench, X } from "lucide-react";

import { Field } from "@/components/common/Field";
import { ToggleRow } from "@/components/common/ToggleRow";
import { MarketConfigPage } from "@/components/MarketConfigPage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { changeOwnPassword, listTools, sendTelegramTestMessage } from "@/lib/api";
import { useColorScheme } from "@/lib/color-scheme";
import { toDraft } from "@/lib/config";
import { formatTemplate, i18n } from "@/lib/i18n";
import type { AppLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { AppConfig, ConfigDraft, MarketDashboardConfig, ToolInfo } from "@/types/app";

function isMcpToolName(name: string): boolean {
  return name.startsWith("mcp_");
}

const OPENAI_API_BASE = "https://api.openai.com/v1";
const CODEX_OAUTH_API_BASE = "https://chatgpt.com/backend-api/codex";
const CODEX_DEFAULT_MODEL = "gpt-5.2-codex";
const EMBEDDING_DEFAULT_MODEL = "text-embedding-3-small";
const REASONING_EFFORT_OPTIONS = ["minimal", "low", "medium", "high"] as const;
const TOOL_CHOICE_OPTIONS = ["auto", "none", "required"] as const;
export type ConfigTab = "model" | "agent" | "longbridge" | "market" | "channels" | "features";

type PasswordForm = { current: string; next: string; confirm: string };
type PasswordState = "idle" | "saving" | "saved" | "error";

function isCompatibleBase(value?: string | null): value is string {
  const normalized = value?.trim().replace(/\/+$/, "");
  return Boolean(normalized && normalized !== CODEX_OAUTH_API_BASE);
}

export function ConfigPage({
  canManageSystem,
  canReadMarket,
  canWriteMarket,
  config,
  configState,
  draft,
  enabledCount,
  handleSaveConfig,
  initialTab,
  language,
  onConfigBlur,
  onMarketConfigSaved,
  patchDraft,
  setDraft,
}: {
  canManageSystem: boolean;
  canReadMarket: boolean;
  canWriteMarket: boolean;
  config: AppConfig | null;
  configState: "idle" | "saving" | "saved" | "error";
  draft: ConfigDraft | null;
  enabledCount: number;
  handleSaveConfig: () => void;
  initialTab?: ConfigTab;
  language: AppLanguage;
  onConfigBlur: () => void;
  onMarketConfigSaved: (config: MarketDashboardConfig) => void;
  patchDraft: (patch: Partial<ConfigDraft>) => void;
  setDraft: (draft: ConfigDraft) => void;
}) {
  const copy = i18n[language].config;
  const common = i18n[language].common;
  const defaultTab = initialTab === "market" && !canReadMarket ? "model" : initialTab ?? "model";
  const [telegramTestMessage, setTelegramTestMessage] = useState(copy.telegramTestDefault);
  const [telegramTestState, setTelegramTestState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [telegramTestResult, setTelegramTestResult] = useState("");
  const [passwordForm, setPasswordForm] = useState<PasswordForm>({ current: "", next: "", confirm: "" });
  const [passwordState, setPasswordState] = useState<PasswordState>("idle");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [isLoadingTools, setIsLoadingTools] = useState(false);
  const [expandedMcpServers, setExpandedMcpServers] = useState<Record<string, boolean>>({});
  const [compatibleSnapshot, setCompatibleSnapshot] = useState({ apiBase: "", model: "" });

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
    if (!telegramTestMessage.trim()) return;
    setTelegramTestState("sending");
    setTelegramTestResult("");
    try {
      const res = await sendTelegramTestMessage({ message: telegramTestMessage.trim() });
      setTelegramTestState("sent");
      setTelegramTestResult(res.detail || (res.chunks > 1 ? formatTemplate(copy.telegramTestSentChunks, { chunks: res.chunks }) : copy.telegramTestSent));
    } catch (caught) {
      setTelegramTestState("error");
      setTelegramTestResult(caught instanceof Error ? caught.message : copy.telegramTestFailed);
    }
  }

  function openPasswordDialog() {
    setPasswordForm({ current: "", next: "", confirm: "" });
    setPasswordState("idle");
    setPasswordMessage("");
    setIsPasswordDialogOpen(true);
  }

  function closePasswordDialog() {
    if (passwordState === "saving") return;
    setIsPasswordDialogOpen(false);
    setPasswordForm({ current: "", next: "", confirm: "" });
    setPasswordState("idle");
    setPasswordMessage("");
  }

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!passwordForm.current || !passwordForm.next || passwordForm.next !== passwordForm.confirm) {
      setPasswordState("error");
      setPasswordMessage(copy.passwordMismatch);
      return;
    }
    setPasswordState("saving");
    setPasswordMessage("");
    try {
      await changeOwnPassword({
        current_password: passwordForm.current,
        new_password: passwordForm.next,
      });
      setPasswordForm({ current: "", next: "", confirm: "" });
      setPasswordState("saved");
      setPasswordMessage(copy.passwordChanged);
      window.setTimeout(() => {
        setPasswordState("idle");
        setPasswordMessage("");
        setIsPasswordDialogOpen(false);
      }, 1200);
    } catch (caught) {
      setPasswordState("error");
      setPasswordMessage(caught instanceof Error ? caught.message : copy.passwordChangeFailed);
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

  return (
    <section className="panel motion-panel page-enter flex min-h-0 min-w-0 flex-1 flex-col rounded-md lg:h-full" onBlurCapture={onConfigBlur}>
      <div className="page-toolbar flex flex-wrap items-center justify-end gap-2">
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

      {draft ? (
        <div className="panel-body min-h-0 flex-1 lg:overflow-y-auto">
          <div className="space-y-4">
          <ConfigSection
            description={copy.accountSecurityHint}
            icon={<LockKeyhole className="size-4 text-secondary" />}
            title={copy.accountSecurity}
          >
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={openPasswordDialog}>
                <KeyRound />
                {copy.changePassword}
              </Button>
            </div>
            {canManageSystem ? (
              <div className="mt-3 grid gap-3 rounded-md border border-border/80 bg-muted/15 p-3 lg:grid-cols-[minmax(0,1fr)_180px] lg:items-center">
                <div className="flex items-start gap-2">
                  <ShieldCheck className="mt-0.5 size-4 text-primary" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{copy.maxLoginDevices}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{copy.maxLoginDevicesHint}</p>
                  </div>
                </div>
                <Field label={copy.maxLoginDevicesValue}>
                  <Input
                    min={1}
                    max={50}
                    type="number"
                    value={draft.auth_max_devices_per_user}
                    onChange={(event) => patchDraft({ auth_max_devices_per_user: Number(event.target.value) })}
                  />
                </Field>
              </div>
            ) : null}
          </ConfigSection>

          <PasswordChangeDialog
            common={common}
            copy={copy}
            form={passwordForm}
            isOpen={isPasswordDialogOpen}
            message={passwordMessage}
            onChange={(patch) => {
              setPasswordState("idle");
              setPasswordMessage("");
              setPasswordForm((current) => ({ ...current, ...patch }));
            }}
            onClose={closePasswordDialog}
            onSubmit={handleChangePassword}
            state={passwordState}
          />

          <Tabs defaultValue={defaultTab}>
            <TabsList className={cn("grid h-auto w-full grid-cols-2", canReadMarket ? "sm:grid-cols-3 lg:grid-cols-6" : "sm:grid-cols-5")}>
              <TabsTrigger value="model">{copy.modelTab}</TabsTrigger>
              <TabsTrigger value="agent">{copy.agentTab}</TabsTrigger>
              <TabsTrigger value="longbridge">{copy.longbridgeTab}</TabsTrigger>
              {canReadMarket ? <TabsTrigger value="market">{copy.marketTab}</TabsTrigger> : null}
              <TabsTrigger value="channels">{copy.channelsTab}</TabsTrigger>
              <TabsTrigger value="features">{copy.featuresTab}</TabsTrigger>
            </TabsList>

            <TabsContent value="model" className="space-y-4">
              <ConfigSection
                description={copy.modelSectionHint}
                icon={<KeyRound className="size-4 text-primary" />}
                title={copy.modelSection}
              >
                <p className="mb-2 text-xs font-semibold text-muted-foreground">{copy.invocationMode}</p>
                <div className="mb-3 grid gap-3 lg:grid-cols-2">
                  <ModelProviderCard
                    description={copy.openaiCompatibleHint}
                    icon={<Cpu className="size-4 text-primary" />}
                    label={copy.openaiCompatible}
                    selected={!isCodexOAuth}
                    onSelect={() => selectLlmProvider("openai_compatible")}
                  />
                  <ModelProviderCard
                    description={copy.codexOauthHint}
                    icon={<TerminalSquare className="size-4 text-secondary" />}
                    label={copy.codexOauth}
                    selected={isCodexOAuth}
                    onSelect={() => selectLlmProvider("openai_responses")}
                  />
                </div>
                <div className="mb-3 rounded-md border border-border/80 bg-muted/20 px-3 py-2 text-xs leading-5 text-muted-foreground">
                  {isCodexOAuth ? copy.codexProviderHint : copy.compatibleProviderHint}
                </div>
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
                  {isCodexOAuth ? (
                    <>
                      <Field label={copy.codexApiBase}>
                        <Input
                          value={draft.llm_codex_api_base ?? ""}
                          onChange={(event) => patchDraft({ llm_codex_api_base: event.target.value })}
                        />
                      </Field>
                      <Field label={copy.codexModel}>
                        <Input
                          value={draft.llm_codex_model ?? ""}
                          onChange={(event) => patchDraft({ llm_codex_model: event.target.value })}
                        />
                      </Field>
                      <Field label={copy.codexAuthFile}>
                        <Input
                          placeholder="~/.codex/auth.json"
                          value={draft.llm_codex_auth_file ?? ""}
                          onChange={(event) => patchDraft({ llm_codex_auth_file: event.target.value })}
                        />
                      </Field>
                      <div className="rounded-md border border-border/80 bg-muted/20 px-3 py-2 text-xs leading-5 text-muted-foreground">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={draft.has_codex_oauth ? "secondary" : "outline"}>
                            {draft.has_codex_oauth ? copy.codexOauthReady : copy.codexOauthMissing}
                          </Badge>
                          {draft.codex_oauth_account_id_masked ? <span>{draft.codex_oauth_account_id_masked}</span> : null}
                        </div>
                        <p className="mt-1">{draft.has_codex_oauth ? copy.codexOauthReadyHint : copy.codexOauthMissingHint}</p>
                        {!draft.has_codex_oauth && draft.codex_oauth_error ? <p className="mt-1 text-destructive">{draft.codex_oauth_error}</p> : null}
                      </div>
                    </>
                  ) : (
                    <>
                      <Field label={copy.llmApiBase}>
                        <Input value={draft.llm_api_base} onChange={(event) => patchDraft({ llm_api_base: event.target.value })} />
                      </Field>
                      <Field label={copy.llmModel}>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Input
                            className="flex-1"
                            value={draft.llm_model}
                            onChange={(event) => patchDraft({ llm_model: event.target.value })}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            type="button"
                            onClick={() => patchDraft({
                              llm_provider: "openai_responses",
                              llm_auth_mode: "codex",
                              llm_codex_api_base: CODEX_OAUTH_API_BASE,
                              llm_codex_model: CODEX_DEFAULT_MODEL,
                            })}
                          >
                            <TerminalSquare />
                            {copy.useCodexPreset}
                          </Button>
                        </div>
                      </Field>
                    <Field label={copy.llmApiKey}>
                      <Input
                        placeholder={draft.has_llm_api_key ? draft.llm_api_key_masked : "sk-..."}
                        type="password"
                        value={draft.llm_api_key}
                        onChange={(event) => patchDraft({ llm_api_key: event.target.value })}
                      />
                    </Field>
                    </>
                  )}
                </div>
              </ConfigSection>

              <ConfigSection
                description={copy.embeddingSectionHint}
                icon={<Database className="size-4 text-secondary" />}
                title={copy.embeddingSection}
              >
                <p className="mb-2 text-xs font-semibold text-muted-foreground">{copy.invocationMode}</p>
                <div className="mb-3 grid gap-3 lg:grid-cols-2">
                  <ModelProviderCard
                    description={copy.embeddingCompatibleHint}
                    icon={<Database className="size-4 text-secondary" />}
                    label={copy.openaiCompatible}
                    selected={!isEmbeddingCodexOAuth}
                    onSelect={() => selectEmbeddingProvider("api_key")}
                  />
                  <ModelProviderCard
                    description={copy.embeddingCodexHint}
                    icon={<TerminalSquare className="size-4 text-secondary" />}
                    label={copy.codexOauth}
                    selected={isEmbeddingCodexOAuth}
                    onSelect={() => selectEmbeddingProvider("codex")}
                  />
                </div>
                <div className="grid gap-3 lg:grid-cols-3">
                  {isEmbeddingCodexOAuth ? (
                    <>
                      <Field label={copy.codexApiBase}>
                        <Input
                          value={draft.embedding_codex_api_base ?? ""}
                          onChange={(event) => patchDraft({ embedding_codex_api_base: event.target.value })}
                        />
                      </Field>
                      <Field label={copy.embeddingModel}>
                        <Input
                          value={draft.embedding_codex_model ?? ""}
                          onChange={(event) => patchDraft({ embedding_codex_model: event.target.value })}
                        />
                      </Field>
                      <Field label={copy.codexAuthFile}>
                        <Input
                          placeholder="~/.codex/auth.json"
                          value={draft.embedding_codex_auth_file ?? ""}
                          onChange={(event) => patchDraft({ embedding_codex_auth_file: event.target.value })}
                        />
                      </Field>
                      <div className="rounded-md border border-border/80 bg-muted/20 px-3 py-2 text-xs leading-5 text-muted-foreground lg:col-span-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={draft.has_embedding_codex_oauth ? "secondary" : "outline"}>
                            {draft.has_embedding_codex_oauth ? copy.codexOauthReady : copy.codexOauthMissing}
                          </Badge>
                          {draft.embedding_codex_oauth_account_id_masked ? <span>{draft.embedding_codex_oauth_account_id_masked}</span> : null}
                        </div>
                        <p className="mt-1">{draft.has_embedding_codex_oauth ? copy.codexOauthReadyHint : copy.codexOauthMissingHint}</p>
                        {!draft.has_embedding_codex_oauth && draft.embedding_codex_oauth_error ? (
                          <p className="mt-1 text-destructive">{draft.embedding_codex_oauth_error}</p>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <>
                      <Field label={copy.embeddingApiBase}>
                        <Input
                          value={draft.embedding_api_base}
                          onChange={(event) => patchDraft({ embedding_api_base: event.target.value })}
                        />
                      </Field>
                      <Field label={copy.embeddingModel}>
                        <Input value={draft.embedding_model} onChange={(event) => patchDraft({ embedding_model: event.target.value })} />
                      </Field>
                      <Field label={copy.embeddingApiKey}>
                        <Input
                          placeholder={draft.has_embedding_api_key ? draft.embedding_api_key_masked : copy.embeddingKeyFallback}
                          type="password"
                          value={draft.embedding_api_key}
                          onChange={(event) => patchDraft({ embedding_api_key: event.target.value })}
                        />
                      </Field>
                    </>
                  )}
                </div>
              </ConfigSection>
            </TabsContent>

            <TabsContent value="agent" className="space-y-4">
              <ConfigSection
                description={copy.agentRuntimeHint}
                icon={<Bot className="size-4 text-primary" />}
                title={copy.agentRuntimeSection}
              >
                {canManageSystem ? (
                  <div className="grid gap-3">
                    <Field label={copy.workspace}>
                      <Input value={draft.workspace_dir} onChange={(event) => patchDraft({ workspace_dir: event.target.value })} />
                    </Field>
                  </div>
                ) : null}
                <div className={cn("grid gap-3 sm:grid-cols-3", canManageSystem && "mt-3")}>
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
                <div className="mt-3 grid gap-3 lg:grid-cols-4">
                  <Field label={copy.temperature}>
                    <Input
                      max={2}
                      min={0}
                      step={0.1}
                      type="number"
                      value={draft.llm_temperature}
                      onChange={(event) => patchDraft({ llm_temperature: Number(event.target.value) })}
                    />
                  </Field>
                  <Field label={copy.maxOutputTokens}>
                    <Input
                      min={0}
                      step={1024}
                      type="number"
                      value={draft.llm_max_output_tokens}
                      onChange={(event) => patchDraft({ llm_max_output_tokens: Number(event.target.value) })}
                    />
                    <p className="text-xs leading-5 text-muted-foreground">{copy.maxOutputTokensHint}</p>
                  </Field>
                  <Field label={copy.reasoningEffort}>
                    <div className="grid grid-cols-2 gap-1 rounded-md border border-border/60 bg-muted/30 p-1">
                      {REASONING_EFFORT_OPTIONS.map((effort) => (
                        <Button
                          className="min-w-0"
                          key={effort}
                          size="sm"
                          type="button"
                          variant={draft.llm_reasoning_effort === effort ? "default" : "ghost"}
                          onClick={() => patchDraft({ llm_reasoning_effort: effort })}
                        >
                          {reasoningEffortLabels[effort]}
                        </Button>
                      ))}
                    </div>
                  </Field>
                  <Field label={copy.toolChoice}>
                    <div className="grid grid-cols-3 gap-1 rounded-md border border-border/60 bg-muted/30 p-1">
                      {TOOL_CHOICE_OPTIONS.map((choice) => (
                        <Button
                          className="min-w-0"
                          key={choice}
                          size="sm"
                          type="button"
                          variant={draft.llm_tool_choice === choice ? "default" : "ghost"}
                          onClick={() => patchDraft({ llm_tool_choice: choice })}
                        >
                          {toolChoiceLabels[choice]}
                        </Button>
                      ))}
                    </div>
                  </Field>
                </div>
              </ConfigSection>

              {canManageSystem ? (
                <ConfigSection
                  description={copy.mainToolHint}
                  icon={<Wrench className="size-4 text-secondary" />}
                  title={copy.mainToolSection}
                >
                  <MainAgentToolPermissions
                    builtinTools={builtinTools}
                    copy={copy}
                    dangerousTools={dangerousTools}
                    draft={draft}
                    expandedMcpServers={expandedMcpServers}
                    isLoadingTools={isLoadingTools}
                    mcpToolGroups={mcpToolGroups}
                    onSelectAllBuiltinTools={selectAllBuiltinTools}
                    onToggleAllMcp={(checked) => patchDraft({ agent_allow_all_mcp_tools: checked })}
                    onToggleMcpServer={(server) => setExpandedMcpServers((current) => ({ ...current, [server]: !current[server] }))}
                    onToggleTool={toggleAgentTool}
                    selectedTools={selectedTools}
                  />
                </ConfigSection>
              ) : null}

              <ConfigSection
                description={copy.multiAgentHint}
                icon={<Plug className="size-4 text-primary" />}
                title={copy.multiAgentSection}
              >
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_repeat(3,minmax(120px,160px))]">
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
              </ConfigSection>

              {canManageSystem ? (
                <ConfigSection
                  description={copy.promptSectionHint}
                  icon={<TerminalSquare className="size-4 text-primary" />}
                  title={copy.promptSection}
                >
                  <Field label={copy.systemPrompt}>
                    <Textarea
                      className="min-h-[220px]"
                      value={draft.system_prompt}
                      onChange={(event) => patchDraft({ system_prompt: event.target.value })}
                    />
                  </Field>
                </ConfigSection>
              ) : null}
            </TabsContent>

            <TabsContent value="longbridge" className="space-y-4">
              <ConfigSection
                description={copy.credentialSectionHint}
                icon={<ShieldCheck className="size-4 text-primary" />}
                title={copy.credentialSection}
              >
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
              </ConfigSection>
              <ConfigSection
                description={copy.endpointSectionHint}
                icon={<Database className="size-4 text-secondary" />}
                title={copy.endpointSection}
              >
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
              </ConfigSection>
              <ConfigSection
                description={copy.guardianSectionHint}
                icon={<Globe2 className="size-4 text-primary" />}
                title={copy.guardianSection}
              >
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                  <Field label={copy.guardianApiKey}>
                    <Input
                      placeholder={draft.has_guardian_api_key ? draft.guardian_api_key_masked : "Guardian Open Platform API key"}
                      type="password"
                      value={draft.guardian_api_key}
                      onChange={(event) => patchDraft({ guardian_api_key: event.target.value })}
                    />
                  </Field>
                  <div className="rounded-md border border-border/80 bg-muted/20 px-3 py-2 text-xs leading-5 text-muted-foreground">
                    {copy.guardianApiKeyHint}
                  </div>
                </div>
              </ConfigSection>
            </TabsContent>

            {canReadMarket ? (
              <TabsContent value="market" className="space-y-4">
                <MarketConfigPage
                  embedded
                  language={language}
                  onSaved={onMarketConfigSaved}
                  readOnly={!canWriteMarket}
                />
              </TabsContent>
            ) : null}

            <TabsContent value="channels" className="space-y-4">
              <ConfigSection
                description={copy.telegramChannelHint}
                icon={<MessageCircle className="size-4 text-primary" />}
                title={copy.telegramChannel}
              >
                <div className="space-y-3">
                  <ToggleRow
                    checked={draft.telegram_enabled}
                    icon={<MessageCircle className="size-4 text-primary" />}
                    label={copy.telegramEnabled}
                    onCheckedChange={(checked) => patchDraft({ telegram_enabled: checked })}
                  />
                  <div className="grid gap-3 lg:grid-cols-2">
                    <Field label={copy.telegramBotToken}>
                      <Input
                        placeholder={draft.has_telegram_bot_token ? draft.telegram_bot_token_masked : "123456:ABC..."}
                        type="password"
                        value={draft.telegram_bot_token}
                        onChange={(event) => patchDraft({ telegram_bot_token: event.target.value })}
                      />
                    </Field>
                    <Field label={copy.telegramChatId}>
                      <Input
                        placeholder={copy.telegramChatIdPlaceholder}
                        value={draft.telegram_chat_id ?? ""}
                        onChange={(event) => patchDraft({ telegram_chat_id: event.target.value })}
                      />
                    </Field>
                    <Field label={copy.telegramApiBase}>
                      <Input
                        placeholder="https://api.telegram.org"
                        value={draft.telegram_api_base ?? ""}
                        onChange={(event) => patchDraft({ telegram_api_base: event.target.value })}
                      />
                    </Field>
                    <Field label={copy.telegramParseMode}>
                      <Input
                        placeholder={copy.telegramParseModePlaceholder}
                        value={draft.telegram_parse_mode ?? ""}
                        onChange={(event) => patchDraft({ telegram_parse_mode: event.target.value })}
                      />
                    </Field>
                  </div>
                </div>
              </ConfigSection>
              <ConfigSection
                description={copy.channelTestSavedHint}
                icon={<Send className="size-4 text-secondary" />}
                title={copy.channelTestMessage}
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                  <Field label={copy.telegramTestMessage} className="flex-1">
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
                    {copy.telegramTestSend}
                  </Button>
                </div>
                <div className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
                  {telegramTestResult ? (
                    <span className={telegramTestState === "error" ? "text-destructive" : "text-emerald-600 dark:text-emerald-300"}>
                      {telegramTestResult}
                    </span>
                  ) : null}
                </div>
              </ConfigSection>
            </TabsContent>

            <TabsContent value="features" className="space-y-4">
              <ConfigSection
                description={copy.personalPreferencesHint}
                icon={<SlidersHorizontal className="size-4 text-primary" />}
                title={copy.personalPreferences}
              >
                <div className="grid gap-3 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-end">
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
                  <ColorSchemeRow language={language} />
                </div>
              </ConfigSection>
              <ConfigSection
                description={copy.featureSectionHint}
                icon={<WandSparkles className="size-4 text-primary" />}
                title={copy.featureSection}
              >
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  <ToggleRow
                    checked={draft.memory_enabled}
                    icon={<BrainCircuit className="size-4 text-primary" />}
                    label={copy.memory}
                    onCheckedChange={(checked) => patchDraft({ memory_enabled: checked })}
                  />
                  <ToggleRow
                    checked={draft.knowledge_enabled}
                    icon={<Database className="size-4 text-accent" />}
                    label={copy.knowledge}
                    onCheckedChange={(checked) => patchDraft({ knowledge_enabled: checked })}
                  />
                  <ToggleRow
                    checked={draft.scheduler_enabled}
                    icon={<RefreshCw className="size-4 text-secondary" />}
                    label={copy.scheduler}
                    onCheckedChange={(checked) => patchDraft({ scheduler_enabled: checked })}
                  />
                  <ToggleRow
                    checked={draft.tracing_enabled}
                    icon={<Cpu className="size-4 text-primary" />}
                    label={copy.tracing}
                    onCheckedChange={(checked) => patchDraft({ tracing_enabled: checked })}
                  />
                  <ToggleRow
                    checked={draft.memory_auto_curate_enabled}
                    icon={<WandSparkles className="size-4 text-primary" />}
                    label={copy.memoryAutoCurate}
                    onCheckedChange={(checked) => patchDraft({ memory_auto_curate_enabled: checked })}
                  />
                  <ToggleRow
                    checked={draft.debug}
                    icon={<TerminalSquare className="size-4 text-destructive" />}
                    label={copy.debug}
                    onCheckedChange={(checked) => patchDraft({ debug: checked })}
                  />
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <Field label={copy.memoryImportanceThreshold}>
                    <Input
                      max={1}
                      min={0}
                      step={0.05}
                      type="number"
                      value={draft.memory_curator_min_importance}
                      onChange={(event) => patchDraft({ memory_curator_min_importance: Number(event.target.value) })}
                    />
                  </Field>
                  <Field label={copy.memoryConfidenceThreshold}>
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
              </ConfigSection>
            </TabsContent>
          </Tabs>
          </div>
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


function PasswordChangeDialog({
  common,
  copy,
  form,
  isOpen,
  message,
  onChange,
  onClose,
  onSubmit,
  state,
}: {
  common: typeof i18n.zh.common;
  copy: typeof i18n.zh.config;
  form: PasswordForm;
  isOpen: boolean;
  message: string;
  onChange: (patch: Partial<PasswordForm>) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  state: PasswordState;
}) {
  if (!isOpen) return null;

  const disabled = state === "saving" || form.next.length < 8 || !form.current || !form.confirm;

  return (
    <div className="fixed inset-0 z-[1100] grid place-items-center bg-background/70 p-4 backdrop-blur-sm">
      <button aria-label={common.close} className="absolute inset-0" onClick={onClose} type="button" />
      <form
        aria-labelledby="change-password-title"
        aria-modal="true"
        className="panel motion-panel relative w-full max-w-[440px] rounded-md p-5 shadow-2xl"
        onSubmit={onSubmit}
        role="dialog"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-md border border-primary/35 bg-primary/10 text-primary">
              <KeyRound className="size-5" />
            </div>
            <div className="min-w-0">
              <h2 id="change-password-title" className="text-base font-semibold">{copy.changePassword}</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{copy.accountSecurityHint}</p>
            </div>
          </div>
          <Button aria-label={common.close} className="h-8 w-8 shrink-0" disabled={state === "saving"} onClick={onClose} size="icon" type="button" variant="ghost">
            <X className="size-4" />
          </Button>
        </div>

        <div className="space-y-3">
          <Field label={copy.currentPassword}>
            <Input
              autoFocus
              autoComplete="current-password"
              type="password"
              value={form.current}
              onChange={(event) => onChange({ current: event.target.value })}
            />
          </Field>
          <Field label={copy.newPassword}>
            <Input
              autoComplete="new-password"
              type="password"
              value={form.next}
              onChange={(event) => onChange({ next: event.target.value })}
            />
          </Field>
          <Field label={copy.confirmPassword}>
            <Input
              autoComplete="new-password"
              type="password"
              value={form.confirm}
              onChange={(event) => onChange({ confirm: event.target.value })}
            />
          </Field>
        </div>

        {message ? (
          <p className={cn("mt-3 rounded-md border px-3 py-2 text-xs", state === "error" ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300")}>
            {message}
          </p>
        ) : null}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button disabled={state === "saving"} onClick={onClose} size="sm" type="button" variant="outline">
            {common.cancel}
          </Button>
          <Button disabled={disabled} size="sm" type="submit">
            {state === "saving" ? <Loader2 className="animate-spin" /> : state === "saved" ? <Check /> : <KeyRound />}
            {state === "saving" ? copy.changingPassword : copy.changePassword}
          </Button>
        </div>
      </form>
    </div>
  );
}


function ModelProviderCard({
  description,
  icon,
  label,
  onSelect,
  selected,
}: {
  description: string;
  icon: ReactNode;
  label: string;
  onSelect: () => void;
  selected: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex min-h-[96px] w-full items-start gap-3 rounded-md border p-3 text-left transition-colors",
        selected ? "border-primary/60 bg-primary/10" : "border-border/75 bg-background/60 hover:border-primary/40",
      )}
      onClick={onSelect}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted/70">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}


function MainAgentToolPermissions({
  builtinTools,
  copy,
  dangerousTools,
  draft,
  expandedMcpServers,
  isLoadingTools,
  mcpToolGroups,
  onSelectAllBuiltinTools,
  onToggleAllMcp,
  onToggleMcpServer,
  onToggleTool,
  selectedTools,
}: {
  builtinTools: ToolInfo[];
  copy: typeof i18n.zh.config;
  dangerousTools: string[];
  draft: ConfigDraft;
  expandedMcpServers: Record<string, boolean>;
  isLoadingTools: boolean;
  mcpToolGroups: [string, ToolInfo[]][];
  onSelectAllBuiltinTools: () => void;
  onToggleAllMcp: (checked: boolean) => void;
  onToggleMcpServer: (server: string) => void;
  onToggleTool: (name: string) => void;
  selectedTools: Set<string>;
}) {
  const mcpToolCount = mcpToolGroups.reduce((total, [, items]) => total + items.length, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{isLoadingTools ? copy.loadingTools : formatTemplate(copy.toolsAvailable, { count: builtinTools.length + mcpToolCount })}</Badge>
          <Badge variant="secondary">{formatTemplate(copy.selectedTools, { count: selectedTools.size })}</Badge>
        </div>
        <Button size="sm" variant="outline" onClick={onSelectAllBuiltinTools} disabled={builtinTools.length === 0}>
          <Check />
          {copy.selectAllBuiltinTools}
        </Button>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground">{copy.builtinTools}</p>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {builtinTools.map((tool) => (
            <ToolPermissionTile
              key={tool.name}
              copy={copy}
              dangerous={dangerousTools.includes(tool.name)}
              disabled={false}
              selected={selectedTools.has(tool.name)}
              tool={tool}
              onToggle={() => onToggleTool(tool.name)}
            />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <ToggleRow
          checked={draft.agent_allow_all_mcp_tools}
          icon={<Plug className="size-4 text-primary" />}
          label={copy.allowAllMcpTools}
          onCheckedChange={onToggleAllMcp}
        />
        <p className="px-1 text-xs text-muted-foreground">{copy.allowAllMcpToolsHint}</p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground">{copy.mcpTools}</p>
        {mcpToolGroups.length > 0 ? (
          <div className="space-y-2">
            {mcpToolGroups.map(([server, serverTools]) => {
              const expanded = Boolean(expandedMcpServers[server]);
              const enabledCount = serverTools.filter((tool) => selectedTools.has(tool.name)).length;
              return (
                <div key={server} className="rounded-md border border-border/80 bg-muted/10">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                    onClick={() => onToggleMcpServer(server)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{server}</span>
                      <span className="block text-xs text-muted-foreground">{enabledCount}/{serverTools.length}</span>
                    </span>
                    <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} />
                  </button>
                  {expanded ? (
                    <div className="grid gap-2 border-t border-border/70 p-2 md:grid-cols-2 xl:grid-cols-3">
                      {serverTools.map((tool) => (
                        <ToolPermissionTile
                          key={tool.name}
                          copy={copy}
                          dangerous={false}
                          disabled={draft.agent_allow_all_mcp_tools}
                          selected={selectedTools.has(tool.name)}
                          tool={tool}
                          onToggle={() => onToggleTool(tool.name)}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border/80 bg-muted/20 px-4 py-6 text-center text-xs text-muted-foreground">
            {copy.noMcpTools}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolPermissionTile({
  copy,
  dangerous,
  disabled,
  onToggle,
  selected,
  tool,
}: {
  copy: typeof i18n.zh.config;
  dangerous: boolean;
  disabled: boolean;
  onToggle: () => void;
  selected: boolean;
  tool: ToolInfo;
}) {
  return (
    <label
      className={cn(
        "flex min-h-[90px] cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors",
        selected ? "border-primary/60 bg-primary/10" : "border-border/75 bg-muted/10 hover:border-primary/40",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <input
        checked={selected}
        className="mt-1"
        disabled={disabled}
        type="checkbox"
        onChange={onToggle}
      />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          <span className="truncate font-medium">{tool.name}</span>
          {dangerous ? <Badge variant="danger">{copy.dangerousTool}</Badge> : null}
        </span>
        <span className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{tool.description || copy.noDescription}</span>
      </span>
    </label>
  );
}


function ConfigSection({
  children,
  className,
  description,
  icon,
  title,
}: {
  children: ReactNode;
  className?: string;
  description?: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <section className={cn("rounded-md border border-border/80 bg-background/50 p-4", className)}>
      <div className="mb-3 flex items-start gap-3">
        <div className="grid size-8 shrink-0 place-items-center rounded-md bg-muted/70">{icon}</div>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          {description ? <p className="text-xs leading-5 text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

// ── Color Scheme Toggle ─────────────────────────────────────────────────────────

function ColorSchemeRow({ language }: { language: AppLanguage }) {
  const { scheme, setScheme } = useColorScheme();
  const copy = i18n[language].config;
  return (
    <div className="flex items-center justify-between rounded-md border border-border/80 bg-background/50 px-3 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid size-8 shrink-0 place-items-center rounded-md bg-muted">
          <TrendingUp className="size-4 text-secondary" />
        </div>
        <div className="min-w-0">
          <span className="truncate text-sm font-medium">{copy.colorScheme}</span>
          <p className="text-[10px] text-muted-foreground">
            {scheme === "cn" ? copy.colorSchemeCn : copy.colorSchemeIntl}
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
          {copy.colorSchemeIntl}
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
          {copy.colorSchemeCn}
        </button>
      </div>
    </div>
  );
}
