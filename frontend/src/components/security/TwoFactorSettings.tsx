import { useRef, useState, type FormEvent } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/react";
import { disableTwoFactor, enableTwoFactor, startTwoFactorSetup } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { TwoFactorSetupResponse } from "@/types/auth";
import { TwoFactorCodeField } from "./TwoFactorCodeField";
import { twoFactorError } from "./two-factor-utils";

export function TwoFactorSettings({ onChanged }: { onChanged?: () => Promise<void> }) {
  const auth = useAuth();
  const { messages } = useI18n();
  const copy = messages.twoFactor;
  const [editing, setEditing] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<TwoFactorSetupResponse | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef(false);
  const enabled = Boolean(auth.user?.two_factor_enabled);

  function reset() {
    setEditing(false); setPassword(""); setCode(""); setSetup(null); setCodes([]); setSaved(false); setError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try {
      if (enabled) {
        await disableTwoFactor(password, code.trim());
        reset(); setNotice(copy.disabledSuccess);
        await auth.refreshUser();
        await onChanged?.();
      } else if (setup) {
        const result = await enableTwoFactor(password, code.trim());
        setCodes(result.recovery_codes); setSetup(null); setPassword(""); setCode(""); setEditing(false);
        await auth.refreshUser();
        await onChanged?.();
      } else {
        setSetup(await startTwoFactorSetup(password));
      }
    } catch (caught) {
      setError(twoFactorError(caught, copy));
    } finally {
      pending.current = false; setBusy(false);
    }
  }

  return <section className="mt-5 space-y-4 border-t border-border/60 pt-5" aria-label={copy.title}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="size-4 text-primary" />{copy.title}</h3>
        <p className="text-xs leading-5 text-muted-foreground">{copy.description}</p>
      </div>
      <span className="text-xs font-medium">{enabled ? copy.enabled : copy.disabled}</span>
    </div>
    {codes.length > 0 ? <div className="space-y-3">
      <h4 className="text-sm font-semibold">{copy.recoveryTitle}</h4>
      <p className="max-w-prose text-sm leading-6 text-muted-foreground">{copy.recoveryHint}</p>
      <pre className="overflow-x-auto rounded-md border border-border bg-muted/30 p-3 text-sm select-all">{codes.join("\n")}</pre>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />{copy.saved}</label>
      <Button type="button" size="sm" disabled={!saved || busy} onClick={reset}>{copy.done}</Button>
    </div> : editing ? <form className="max-w-lg space-y-4" onSubmit={submit} aria-busy={busy}>
      {enabled && <p className="text-sm leading-6 text-muted-foreground">{copy.disableHint}</p>}
      <label className="block space-y-2 text-sm font-medium"><span>{copy.currentPassword}</span>
        <Input type="password" autoComplete="current-password" maxLength={256} required disabled={busy} value={password} onChange={(event) => setPassword(event.target.value)} />
      </label>
      {setup && <div className="space-y-3">
        <p className="text-sm leading-6 text-muted-foreground">{copy.setupHint}</p>
        <label className="block space-y-2 text-sm font-medium"><span>{copy.secret}</span><Input readOnly value={setup.secret} className="font-mono text-xs" onFocus={(event) => event.target.select()} /></label>
        <p className="text-xs leading-5 text-muted-foreground">{copy.expiryHint}</p>
      </div>}
      {(setup || enabled) && <TwoFactorCodeField value={code} onChange={setCode} disabled={busy} setup={!enabled} autoFocus />}
      {!enabled && <p className="text-xs leading-5 text-muted-foreground">{copy.sessionsHint}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={busy || !password || Boolean((setup || enabled) && !code.trim())}>
          {busy && <Loader2 className="animate-spin" />}{enabled ? copy.confirmDisable : setup ? copy.confirmEnable : copy.start}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={reset}>{copy.cancel}</Button>
      </div>
    </form> : <Button type="button" size="sm" variant="outline" onClick={() => { setEditing(true); setNotice(""); }}>{enabled ? copy.disable : copy.enable}</Button>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
  </section>;
}
