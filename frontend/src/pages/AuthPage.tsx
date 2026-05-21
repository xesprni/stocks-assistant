import { useState } from "react";
import { KeyRound, Loader2, ShieldCheck, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";

export function AuthPage() {
  const auth = useAuth();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const isSetup = auth.setupRequired;
  const title = isSetup ? "Initialize Administrator" : "Sign in to Stocks Assistant";
  const subtitle = isSetup
    ? "Create the first administrator to enable JWT authentication."
    : "Use your account to continue to the console.";
  const disabled = submitting || !username.trim() || password.length < 8 || (isSetup && password !== confirm);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (disabled) return;
    setSubmitting(true);
    setError("");
    try {
      if (isSetup) {
        await auth.setup({ username: username.trim(), password, display_name: displayName.trim() });
      } else {
        await auth.login(username.trim(), password);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-fluid-shell console-shell grid min-h-[100dvh] place-items-center p-4">
      <form
        className="auth-panel panel motion-panel relative z-10 w-full max-w-[420px] rounded-md p-5 shadow-xl"
        onSubmit={submit}
      >
        <div className="mb-5 flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-lg border border-primary/35 bg-primary/10 text-primary shadow-glow">
            {isSetup ? <ShieldCheck className="size-5" /> : <Sparkles className="size-5" />}
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">{title}</h1>
            <p className="text-xs leading-5 text-muted-foreground">{subtitle}</p>
          </div>
        </div>

        <div className="space-y-3">
          <label className="block space-y-1.5 text-sm font-medium">
            <span>Username</span>
            <Input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
          </label>
          {isSetup ? (
            <label className="block space-y-1.5 text-sm font-medium">
              <span>Display name</span>
              <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </label>
          ) : null}
          <label className="block space-y-1.5 text-sm font-medium">
            <span>Password</span>
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={isSetup ? "new-password" : "current-password"}
            />
          </label>
          {isSetup ? (
            <label className="block space-y-1.5 text-sm font-medium">
              <span>Confirm password</span>
              <Input
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                autoComplete="new-password"
              />
            </label>
          ) : null}
        </div>

        {error ? <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}

        <Button className="mt-5 w-full" disabled={disabled} type="submit">
          {submitting ? <Loader2 className="animate-spin" /> : <KeyRound />}
          {isSetup ? "Create administrator" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
