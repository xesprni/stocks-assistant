import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, ExternalLink, KeyRound, Link2, Loader2, RefreshCw, Unplug } from "lucide-react";

import { ConfigChoiceCard, ConfigField as Field } from "@/components/config/ConfigForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { disconnectLongbridgeOAuth, getLongbridgeOAuthStatus, startLongbridgeOAuth } from "@/lib/api";
import { i18n, type AppLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { ConfigDraft, LongbridgeOAuthStatus } from "@/types/app";

export function LongbridgeAuthPanel({ draft, language, patchDraft, onAuthChanged }: {
  draft: ConfigDraft;
  language: AppLanguage;
  patchDraft: (patch: Partial<ConfigDraft>) => void;
  onAuthChanged: (status: LongbridgeOAuthStatus, replaceDraftMode?: boolean) => void;
}) {
  const copy = i18n[language].config.longbridgeOAuth;
  const [status, setStatus] = useState<LongbridgeOAuthStatus | null>(null);
  const [busy, setBusy] = useState<"connect" | "disconnect" | "refresh" | null>(null);
  const [error, setError] = useState("");
  const onChangedRef = useRef(onAuthChanged);
  const previousStatusRef = useRef<LongbridgeOAuthStatus["status"] | null>(null);
  const mountedRef = useRef(false);
  onChangedRef.current = onAuthChanged;
  const isOAuth = draft.longbridge_auth_mode === "oauth";
  const pending = status?.status === "pending";
  const connected = status?.status === "connected";

  function acceptStatus(next: LongbridgeOAuthStatus, persist = false) {
    const completed = previousStatusRef.current === "pending" && next.status === "connected";
    previousStatusRef.current = next.status;
    setStatus(next);
    if (next.status !== "pending") onChangedRef.current(next, persist || completed);
  }

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    getLongbridgeOAuthStatus({ signal: controller.signal })
      .then((next) => { if (!controller.signal.aborted) acceptStatus(next); })
      .catch((caught) => {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : copy.checkFailed);
      });
    return () => { mountedRef.current = false; controller.abort(); };
  }, [copy.checkFailed]);

  useEffect(() => {
    if (!pending) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    // Wait for each response before scheduling another poll; cleanup stops it when leaving the page.
    async function poll() {
      try {
        const next = await getLongbridgeOAuthStatus({ signal: controller.signal });
        if (controller.signal.aborted) return;
        acceptStatus(next);
        setError("");
        if (next.status !== "pending") return;
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : copy.checkFailed);
      }
      timer = setTimeout(poll, 2500);
    }
    timer = setTimeout(poll, 2000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [pending, copy.checkFailed]);

  async function perform(action: "connect" | "disconnect" | "refresh") {
    setBusy(action);
    setError("");
    try {
      const next = await (action === "connect" ? startLongbridgeOAuth()
        : action === "disconnect" ? disconnectLongbridgeOAuth() : getLongbridgeOAuthStatus());
      if (!mountedRef.current) return;
      acceptStatus(next, action === "disconnect" || (action === "connect" && next.status === "connected"));
    } catch (caught) {
      if (mountedRef.current) setError(caught instanceof Error ? caught.message : copy.checkFailed);
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-3 text-[13px] font-medium text-foreground">{copy.authMethod}</p>
        <div aria-label={copy.authMethod} className="grid gap-3 md:grid-cols-2" role="group">
          {([
            { mode: "oauth", label: "OAuth 2.0", hint: copy.oauthHint, icon: Link2 },
            { mode: "apikey", label: "API Key", hint: copy.apiKeyHint, icon: KeyRound },
          ] as const).map(({ mode, label, hint, icon: Icon }) => {
            const selected = (isOAuth ? "oauth" : "apikey") === mode;
            return <ConfigChoiceCard
              description={hint}
              disabled={Boolean(busy) || pending}
              icon={<Icon className="size-4" />}
              key={mode}
              label={label}
              onSelect={() => patchDraft({ longbridge_auth_mode: mode })}
              selected={selected}
            />;
          })}
        </div>
      </div>

      {isOAuth || pending ? (
        <div className="space-y-4 rounded-xl border border-border bg-muted/15 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2" role="status">
              {pending ? <Loader2 className="size-4 animate-spin text-primary" /> : <Link2 className="size-4 text-muted-foreground" />}
              <span className="text-sm font-semibold">Longbridge</span>
              <Badge variant={connected ? "secondary" : "outline"}>{pending ? copy.pending : connected ? copy.connected : status?.status === "error" ? copy.failed : copy.disconnected}</Badge>
            </div>
            <Button aria-label={copy.refresh} disabled={Boolean(busy)} onClick={() => void perform("refresh")} size="icon" type="button" variant="ghost">
              <RefreshCw className={cn("size-4", busy === "refresh" && "animate-spin")} />
            </Button>
          </div>
          {status ? <p className="text-xs leading-5 text-muted-foreground">{status.scope === "system" ? copy.systemScope : copy.personalScope}</p> : null}
          <p className="text-sm leading-6 text-muted-foreground">{pending ? copy.pendingHint : connected ? copy.savedHint : copy.oauthHint}</p>
          {!connected ? <p className="text-xs leading-5 text-muted-foreground">{copy.localHint}</p> : null}
          {pending && status?.callback_url ? <p className="break-all text-xs leading-5 text-muted-foreground">{copy.callback}：<code>{status.callback_url}</code></p> : null}
          {pending && status?.expires_at ? <p className="text-xs text-muted-foreground">{copy.expires} {new Date(status.expires_at).toLocaleTimeString(language === "zh" ? "zh-CN" : "en-US")}</p> : null}
          <div className="flex flex-wrap gap-2">
            {pending && status?.authorization_url ? (
              <Button asChild><a href={status.authorization_url} rel="noopener noreferrer" target="_blank">{copy.openAuthorization}<ArrowUpRight className="size-4" /></a></Button>
            ) : !connected && !pending ? (
              <Button disabled={Boolean(busy) || !status} onClick={() => void perform("connect")} type="button">
                {busy === "connect" ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}{busy === "connect" ? copy.connecting : copy.connect}
              </Button>
            ) : null}
            {connected || pending ? (
              <Button disabled={Boolean(busy)} onClick={() => void perform("disconnect")} type="button" variant="outline">
                {busy === "disconnect" ? <Loader2 className="size-4 animate-spin" /> : <Unplug className="size-4" />}{pending ? copy.cancel : copy.disconnect}
              </Button>
            ) : null}
          </div>
          {error || status?.error ? <p className="text-sm leading-6 text-destructive" role="alert">{error || status?.error}</p> : null}
        </div>
      ) : (
        <div className="grid items-start gap-x-5 gap-y-5 md:grid-cols-2">
          <Field label="App Key"><Input autoComplete="off" placeholder={draft.has_longbridge_app_key ? draft.longbridge_app_key_masked : "Longbridge app key"} type="password" value={draft.longbridge_app_key} onChange={(event) => patchDraft({ longbridge_app_key: event.target.value })} /></Field>
          <Field label="App Secret"><Input autoComplete="off" placeholder={draft.has_longbridge_app_secret ? draft.longbridge_app_secret_masked : "Longbridge app secret"} type="password" value={draft.longbridge_app_secret} onChange={(event) => patchDraft({ longbridge_app_secret: event.target.value })} /></Field>
          <Field className="md:col-span-2" label="Access Token"><Input autoComplete="off" placeholder={draft.has_longbridge_access_token ? draft.longbridge_access_token_masked : "Longbridge access token"} type="password" value={draft.longbridge_access_token} onChange={(event) => patchDraft({ longbridge_access_token: event.target.value })} /></Field>
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3 text-xs leading-5 text-muted-foreground">
        <p className="max-w-lg">{copy.apiKeySaveHint}</p>
        <a className="inline-flex items-center gap-1 font-medium text-primary hover:underline" href="https://open.longbridge.com/zh-CN/docs/getting-started" rel="noopener noreferrer" target="_blank">{copy.docs}<ExternalLink className="size-3" /></a>
      </div>
    </div>
  );
}
