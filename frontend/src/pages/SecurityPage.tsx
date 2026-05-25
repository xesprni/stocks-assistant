import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock, Laptop, Loader2, LogOut, RefreshCw, ShieldCheck, Smartphone, XCircle } from "lucide-react";

import type { ConfirmFn } from "@/components/common/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listLoginSessions, revokeLoginSession } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { AppLanguage } from "@/lib/i18n";
import type { LoginSession } from "@/types/app";

const copy = {
  zh: {
    title: "登录安全",
    subtitle: "查看当前账号的登录设备，并让不再使用的设备下线",
    refresh: "刷新",
    loading: "正在加载登录设备...",
    empty: "暂无登录设备",
    current: "当前设备",
    active: "在线",
    inactive: "已下线",
    firstSeen: "首次登录",
    lastSeen: "最近活动",
    expires: "需要重新登录",
    ip: "登录 IP",
    lastIp: "最近 IP",
    sessionPolicy: "登录策略",
    sessionPolicyHint: "访问令牌短时有效；刷新令牌会滑动续期，但设备登录最长保留 {days} 天，到期后需要重新输入密码。当前账号最多保留 {devices} 台活跃设备。",
    revoke: "下线",
    revokeCurrent: "退出当前设备",
    revokeConfirmTitle: "让该设备下线？",
    revokeConfirmBody: "该设备的刷新令牌会立即失效，现有访问令牌也会在下次请求时被拒绝。",
    revokeCurrentConfirmBody: "当前设备会退出登录，其他页面内容不会被保存为新的请求。",
    cancel: "取消",
    confirm: "下线",
    loadFailed: "加载登录设备失败",
    revokeFailed: "设备下线失败",
  },
  en: {
    title: "Login Security",
    subtitle: "Review signed-in devices for this account and sign out devices you no longer use",
    refresh: "Refresh",
    loading: "Loading login devices...",
    empty: "No login devices",
    current: "Current device",
    active: "Online",
    inactive: "Signed out",
    firstSeen: "First seen",
    lastSeen: "Last seen",
    expires: "Re-login by",
    ip: "Login IP",
    lastIp: "Recent IP",
    sessionPolicy: "Login policy",
    sessionPolicyHint: "Access tokens are short-lived. Refresh tokens rotate while active, but each device session lasts at most {days} days before a password prompt. This account can keep up to {devices} active devices.",
    revoke: "Sign out",
    revokeCurrent: "Sign out here",
    revokeConfirmTitle: "Sign out this device?",
    revokeConfirmBody: "This device's refresh token will be revoked immediately, and existing access tokens will be rejected on the next request.",
    revokeCurrentConfirmBody: "This device will return to the sign-in screen. Unsaved requests will not be retried.",
    cancel: "Cancel",
    confirm: "Sign out",
    loadFailed: "Failed to load login devices",
    revokeFailed: "Failed to sign out device",
  },
} as const;

function formatDate(value: string, language: AppLanguage) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(language === "en" ? "en-US" : "zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function deviceName(userAgent: string, language: AppLanguage) {
  const source = userAgent || "";
  const os = /Windows/i.test(source)
    ? "Windows"
    : /Mac OS|Macintosh/i.test(source)
      ? "macOS"
      : /Android/i.test(source)
        ? "Android"
        : /iPhone|iPad/i.test(source)
          ? "iOS"
          : /Linux/i.test(source)
            ? "Linux"
            : language === "en" ? "Unknown device" : "未知设备";
  const browser = /Edg\//i.test(source)
    ? "Edge"
    : /Chrome\//i.test(source)
      ? "Chrome"
      : /Firefox\//i.test(source)
        ? "Firefox"
        : /Safari\//i.test(source)
          ? "Safari"
          : "";
  return browser ? `${browser} · ${os}` : os;
}

function isMobileDevice(userAgent: string) {
  return /Android|iPhone|iPad|Mobile/i.test(userAgent);
}

function policyText(template: string, days: number, devices: number) {
  return template.replace("{days}", String(days)).replace("{devices}", String(devices));
}

export function SecurityPage({ confirmAction, language }: { confirmAction: ConfirmFn; language: AppLanguage }) {
  const auth = useAuth();
  const t = copy[language];
  const [sessions, setSessions] = useState<LoginSession[]>([]);
  const [maxLifetimeDays, setMaxLifetimeDays] = useState(30);
  const [maxDevices, setMaxDevices] = useState(5);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState("");

  const activeCount = useMemo(() => sessions.filter((session) => session.is_active).length, [sessions]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await listLoginSessions();
      setSessions(response.sessions);
      setMaxLifetimeDays(response.max_lifetime_days);
      setMaxDevices(response.max_devices_per_user);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.loadFailed);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleRevoke(session: LoginSession) {
    const confirmed = await confirmAction({
      cancelText: t.cancel,
      confirmText: t.confirm,
      destructive: true,
      title: t.revokeConfirmTitle,
      description: session.is_current ? t.revokeCurrentConfirmBody : t.revokeConfirmBody,
    });
    if (!confirmed) return;

    setRevoking(session.id);
    setError("");
    try {
      const result = await revokeLoginSession(session.id);
      if (result.revoked_current) {
        await auth.logout();
        return;
      }
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.revokeFailed);
    } finally {
      setRevoking(null);
    }
  }

  return (
    <section className="panel motion-panel page-enter flex min-h-0 min-w-0 flex-1 flex-col rounded-md lg:h-full">
      <div className="panel-header flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" />
            <p className="font-semibold">{t.title}</p>
          </div>
          <p className="text-xs text-muted-foreground">{t.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{activeCount} {t.active}</Badge>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {t.refresh}
          </Button>
        </div>
      </div>

      <div className="panel-body min-h-0 flex-1 space-y-4 lg:overflow-y-auto">
        {error ? <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}

        <div className="rounded-md border border-border/80 bg-background/60 p-3">
          <div className="flex items-start gap-2">
            <Clock className="mt-0.5 size-4 text-secondary" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">{t.sessionPolicy}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{policyText(t.sessionPolicyHint, maxLifetimeDays, maxDevices)}</p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 rounded-md border border-border/80 bg-muted/20 px-3 py-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t.loading}
          </div>
        ) : sessions.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/80 px-3 py-8 text-center text-sm text-muted-foreground">{t.empty}</div>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {sessions.map((session) => {
              const DeviceIcon = isMobileDevice(session.user_agent) ? Smartphone : Laptop;
              return (
                <article key={session.id} className="rounded-md border border-border/80 bg-background/60 p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <DeviceIcon className="size-4 text-primary" />
                        <p className="text-sm font-semibold">{deviceName(session.user_agent, language)}</p>
                        {session.is_current ? <Badge variant="outline">{t.current}</Badge> : null}
                        <Badge variant={session.is_active ? "secondary" : "muted"}>
                          {session.is_active ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
                          {session.is_active ? t.active : t.inactive}
                        </Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 break-all text-xs text-muted-foreground">{session.user_agent || deviceName("", language)}</p>
                    </div>
                    <Button
                      size="sm"
                      variant={session.is_current ? "destructive" : "outline"}
                      onClick={() => void handleRevoke(session)}
                      disabled={!session.is_active || revoking === session.id}
                    >
                      {revoking === session.id ? <Loader2 className="animate-spin" /> : <LogOut />}
                      {session.is_current ? t.revokeCurrent : t.revoke}
                    </Button>
                  </div>

                  <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                    <Info label={t.firstSeen} value={formatDate(session.created_at, language)} />
                    <Info label={t.lastSeen} value={formatDate(session.last_seen_at, language)} />
                    <Info label={t.expires} value={formatDate(session.expires_at, language)} />
                    <Info label={t.ip} value={session.ip_address || "-"} />
                    <Info label={t.lastIp} value={session.last_ip_address || "-"} />
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/15 px-2.5 py-2">
      <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
      <p className="mt-1 break-all text-xs text-foreground">{value}</p>
    </div>
  );
}
