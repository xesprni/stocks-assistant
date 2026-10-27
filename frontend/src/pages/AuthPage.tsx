import { useI18n } from "@/i18n/react";
import { TwoFactorCodeField } from "@/components/security/TwoFactorCodeField";
import { emptyTwoFactorInput, isCompleteTwoFactorInput, requiresTwoFactor, twoFactorError, type TwoFactorInput } from "@/components/security/two-factor-utils";
import { useRef, useState } from "react";
import { KeyRound, Loader2, ShieldCheck, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";

export function AuthPage() {
  const auth = useAuth();
  const { messages } = useI18n();
  const copy = messages.auth;
  const pending = useRef(false);
  const [twoFactorCode, setTwoFactorCode] = useState(emptyTwoFactorInput);
  const [needsCode, setNeedsCode] = useState(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const isSetup = auth.setupRequired;
  const title = isSetup ? copy.setupTitle : copy.loginTitle;
  const subtitle = isSetup ? copy.setupHint : copy.loginHint;
  const disabled = submitting || (!isSetup && needsCode && !isCompleteTwoFactorInput(twoFactorCode)) || !username.trim() || password.length < 8 || (isSetup && password !== confirm);

  async function authenticate(code: TwoFactorInput = twoFactorCode) {
    if (pending.current || !username.trim() || password.length < 8 ||
      (isSetup ? password !== confirm : needsCode && !isCompleteTwoFactorInput(code))) return;
    pending.current = true;
    setSubmitting(true);
    setError("");
    try {
      if (isSetup) {
        await auth.setup({ username: username.trim(), password, display_name: displayName.trim() });
      } else {
        await auth.login(username.trim(), password, code.code.trim() || undefined);
      }
    } catch (caught) {
      if (requiresTwoFactor(caught)) setNeedsCode(true);
      setError(twoFactorError(caught, messages.twoFactor));
    } finally {
      pending.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-fluid-shell console-shell flex h-[100dvh] min-h-0 items-start justify-center overflow-y-auto overscroll-contain p-4 [-webkit-overflow-scrolling:touch]">
      <form
        className="auth-panel panel motion-panel relative z-10 my-auto w-full max-w-[430px] shrink-0 rounded-[1.5rem] p-6 shadow-xl sm:p-8"
        onSubmit={(event) => { event.preventDefault(); void authenticate(); }}
      >
        <div className="mb-7 flex items-start gap-3.5">
          <div className="grid size-12 shrink-0 place-items-center rounded-[1rem] border border-primary/25 bg-primary text-primary-foreground shadow-[0_10px_28px_hsl(var(--primary)_/_0.22)]">
            {isSetup ? <ShieldCheck className="size-5" /> : <Sparkles className="size-5" />}
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold leading-7 tracking-[-0.02em]">{title}</h1>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">{subtitle}</p>
          </div>
        </div>

        <div className="space-y-4">
          <label className="block space-y-2 text-sm font-medium">
            <span>{copy.username}</span>
            <Input value={username} disabled={submitting} onChange={(event) => { setUsername(event.target.value); setNeedsCode(false); setTwoFactorCode(emptyTwoFactorInput()); setError(""); }} autoComplete="username" />
          </label>
          {isSetup ? (
            <label className="block space-y-2 text-sm font-medium">
              <span>{copy.displayName}</span>
              <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </label>
          ) : null}
          <label className="block space-y-2 text-sm font-medium">
            <span>{copy.password}</span>
            <Input
              disabled={submitting}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={isSetup ? "new-password" : "current-password"}
            />
          </label>
          {isSetup ? (
            <label className="block space-y-2 text-sm font-medium">
              <span>{copy.confirm}</span>
              <Input
                disabled={submitting}
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                autoComplete="new-password"
              />
            </label>
          ) : null}
          {!isSetup && needsCode && <TwoFactorCodeField autoFocus value={twoFactorCode}
            onChange={(code) => { if (code.method !== twoFactorCode.method) setError(""); setTwoFactorCode(code); }}
            onComplete={(code) => { void authenticate(code); }} disabled={submitting} />}
        </div>

        {error ? <p role="alert" className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}

        <Button className="mt-6 w-full" disabled={disabled} size="lg" type="submit">
          {submitting ? <Loader2 className="animate-spin" /> : <KeyRound />}
          {isSetup ? copy.create : copy.login}
        </Button>
      </form>
    </div>
  );
}
