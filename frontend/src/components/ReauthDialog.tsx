import { useState, type FormEvent } from "react";
import { KeyRound, Loader2, LogOut, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";

export function ReauthDialog() {
  const auth = useAuth();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (!auth.reauthRequired || !auth.user) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await auth.reauthenticate(password);
      setPassword("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[1300] grid place-items-center bg-background/70 p-4 backdrop-blur-sm">
      <form className="panel motion-panel w-full max-w-[420px] rounded-md p-5 shadow-2xl" onSubmit={submit}>
        <div className="mb-4 flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-md border border-primary/35 bg-primary/10 text-primary">
            <ShieldCheck className="size-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold">需要重新登录</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              为了安全，登录设备会定期要求重新验证。当前页面和已填写内容会保留。
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
            <span>账号</span>
            <Input value={auth.user.username} disabled autoComplete="username" />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            <span>密码</span>
            <Input
              autoFocus
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
        </div>

        {error ? <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={auth.logout} disabled={submitting}>
            <LogOut />
            退出
          </Button>
          <Button type="submit" disabled={submitting || !password}>
            {submitting ? <Loader2 className="animate-spin" /> : <KeyRound />}
            继续
          </Button>
        </div>
      </form>
    </div>
  );
}
