import { TwoFactorCodeField } from "@/components/security/TwoFactorCodeField";
import { requiresTwoFactor, twoFactorError } from "@/components/security/two-factor-utils";
import { useI18n } from "@/i18n/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { KeyRound, Loader2, LogOut, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";

export function ReauthDialog() {
  const { messages } = useI18n();
  const copy = messages.shell.reauth;
  const auth = useAuth();
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const showCode = needsCode || Boolean(auth.user?.two_factor_enabled);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);

  useEffect(() => {
    if (!auth.reauthRequired) {
      setPassword("");
      setTwoFactorCode("");
      setNeedsCode(false);
      setError("");
    }
  }, [auth.reauthRequired, auth.user?.id]);

  if (!auth.reauthRequired || !auth.user) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password || pending.current || (showCode && !twoFactorCode.trim())) return;
    pending.current = true;
    setSubmitting(true);
    setError("");
    try {
      await auth.reauthenticate(password, twoFactorCode.trim() || undefined);
      setTwoFactorCode("");
      setNeedsCode(false);
      setPassword("");
    } catch (caught) {
      if (requiresTwoFactor(caught)) setNeedsCode(true);
      setError(twoFactorError(caught, messages.twoFactor));
    } finally {
      pending.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[1300] overflow-y-auto grid place-items-center bg-background/70 p-4 backdrop-blur-sm">
      <form className="panel motion-panel w-full max-w-[420px] rounded-md p-5 shadow-2xl" onSubmit={submit}>
        <div className="mb-4 flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-md border border-primary/35 bg-primary/10 text-primary">
            <ShieldCheck className="size-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{copy.title}</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {copy.hint}
            </p>
          </div>
        </div>

        {auth.reauthMessage ? (
          <p className="mb-3 rounded-md border border-border/80 bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
            {auth.reauthMessage}
          </p>
        ) : null}

        <div className="space-y-3">
          <label className="block space-y-1.5 text-sm font-medium">
            <span>{copy.username}</span>
            <Input value={auth.user.username} disabled autoComplete="username" />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            <span>{copy.password}</span>
            <Input
              disabled={submitting}
              autoFocus
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {showCode && <TwoFactorCodeField value={twoFactorCode} onChange={setTwoFactorCode} disabled={submitting} />}
        </div>

        {error ? <p role="alert" className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={auth.logout} disabled={submitting}>
            <LogOut />
            {copy.logout}
          </Button>
          <Button type="submit" disabled={submitting || !password || (showCode && !twoFactorCode.trim())}>
            {submitting ? <Loader2 className="animate-spin" /> : <KeyRound />}
            {copy.continue}
          </Button>
        </div>
      </form>
    </div>
  );
}
