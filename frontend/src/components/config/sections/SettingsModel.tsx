import { ConfigChoiceCard, ConfigField as Field } from "@/components/config/ConfigForm";
import { ConfigSection } from "@/components/config/ConfigSection";
import { CODEX_DEFAULT_MODEL, CODEX_OAUTH_API_BASE } from "@/components/config/settings-model";
import type { ConfigPageState } from "@/components/config/useSettings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TabsContent } from "@/components/ui/tabs";
import { Cpu, Database, KeyRound, TerminalSquare } from "lucide-react";

type Props = Pick<ConfigPageState, "copy" | "isCodexOAuth" | "selectLlmProvider" | "patchDraft" | "draft" | "isEmbeddingCodexOAuth" | "selectEmbeddingProvider"> & { draft: NonNullable<ConfigPageState["draft"]> };

export function SettingsModel({ copy, isCodexOAuth, selectLlmProvider, patchDraft, draft, isEmbeddingCodexOAuth, selectEmbeddingProvider }: Props) {
  return (<TabsContent value="model" className="mt-0 space-y-5">
    <ConfigSection
      description={copy.modelSectionHint}
      icon={<KeyRound className="size-4 text-primary" />}
      title={copy.modelSection}
    >
      <p className="mb-3 text-[13px] font-medium text-foreground">{copy.invocationMode}</p>
      <div aria-label={copy.invocationMode} className="mb-5 grid gap-3 md:grid-cols-2" role="group">
        <ConfigChoiceCard
          description={copy.openaiCompatibleHint}
          icon={<Cpu className="size-4 text-primary" />}
          label={copy.openaiCompatible}
          selected={!isCodexOAuth}
          onSelect={() => selectLlmProvider("openai_compatible")}
        />
        <ConfigChoiceCard
          description={copy.codexOauthHint}
          icon={<TerminalSquare className="size-4 text-secondary" />}
          label={copy.codexOauth}
          selected={isCodexOAuth}
          onSelect={() => selectLlmProvider("openai_responses")}
        />
      </div>
      <div className="mb-5 flex flex-col gap-3 rounded-lg bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-muted-foreground">{isCodexOAuth ? copy.codexProviderHint : copy.compatibleProviderHint}</p>
        {!isCodexOAuth ? (
          <Button
            className="shrink-0 self-start sm:self-center"
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
        ) : null}
      </div>
      <div className="grid items-start gap-x-5 gap-y-5 md:grid-cols-2">
        {isCodexOAuth ? (
          <>
            <Field className="md:col-span-2" label={copy.codexApiBase}>
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
            <div className="rounded-lg bg-muted/30 px-4 py-3 text-xs leading-5 text-muted-foreground md:col-span-2">
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
            <Field className="md:col-span-2" label={copy.llmApiBase}>
              <Input value={draft.llm_api_base} onChange={(event) => patchDraft({ llm_api_base: event.target.value })} />
            </Field>
            <Field label={copy.llmModel}>
              <Input
                value={draft.llm_model}
                onChange={(event) => patchDraft({ llm_model: event.target.value })}
              />
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
      <p className="mb-3 text-[13px] font-medium text-foreground">{copy.invocationMode}</p>
      <div aria-label={copy.invocationMode} className="mb-5 grid gap-3 md:grid-cols-2" role="group">
        <ConfigChoiceCard
          description={copy.embeddingCompatibleHint}
          icon={<Database className="size-4 text-secondary" />}
          label={copy.openaiCompatible}
          selected={!isEmbeddingCodexOAuth}
          onSelect={() => selectEmbeddingProvider("api_key")}
        />
        <ConfigChoiceCard
          description={copy.embeddingCodexHint}
          icon={<TerminalSquare className="size-4 text-secondary" />}
          label={copy.codexOauth}
          selected={isEmbeddingCodexOAuth}
          onSelect={() => selectEmbeddingProvider("codex")}
        />
      </div>
      <div className="grid items-start gap-x-5 gap-y-5 md:grid-cols-2">
        {isEmbeddingCodexOAuth ? (
          <>
            <Field className="md:col-span-2" label={copy.codexApiBase}>
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
            <div className="rounded-lg bg-muted/30 px-4 py-3 text-xs leading-5 text-muted-foreground md:col-span-2">
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
            <Field className="md:col-span-2" label={copy.embeddingApiBase}>
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
  </TabsContent>);
}
