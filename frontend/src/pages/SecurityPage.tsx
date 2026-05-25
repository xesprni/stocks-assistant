import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock, Laptop, Loader2, LogOut, RefreshCw, ShieldCheck, Smartphone, Trash2, XCircle } from "lucide-react";

import type { ConfirmFn } from "@/components/common/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { deleteLoginDevice, deleteLoginRecord, listLoginSessions, revokeLoginSession } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { AppLanguage } from "@/lib/i18n";
import type { LoginRecord, LoginSession } from "@/types/app";

const copy = {
  zh: {
    title: "登录安全",
    subtitle: "查看当前账号的登录设备，并让不再使用的设备下线",
    adminSubtitle: "查看所有用户的登录设备，并让不再使用的设备下线",
    refresh: "刷新",
    loading: "正在加载登录设备...",
    empty: "暂无登录设备",
    current: "当前设备",
    active: "在线",
    signedIn: "已登录",
    inactive: "已下线",
    firstSeen: "首次登录",
    lastSeen: "最近活动",
    expires: "需要重新登录",
    ip: "登录 IP",
    lastIp: "最近 IP",
    owner: "用户",
    deviceId: "设备 ID",
    sessions: "登录次数",
    devices: "设备",
    records: "登录记录",
    recordId: "记录 ID",
    sessionPolicy: "登录策略",
    sessionPolicyHint: "访问令牌短时有效；刷新令牌会滑动续期，但设备登录最长保留 {days} 天，到期后需要重新输入密码。当前账号最多保留 {devices} 台活跃设备。",
    revoke: "下线",
    revokeCurrent: "退出当前设备",
    revokeConfirmTitle: "让该设备下线？",
    revokeConfirmBody: "该设备的刷新令牌会立即失效，现有访问令牌也会在下次请求时被拒绝。",
    revokeCurrentConfirmBody: "当前设备会退出登录，其他页面内容不会被保存为新的请求。",
    delete: "删除",
    deleteDevice: "删除设备",
    deleteRecord: "删除记录",
    deleteDeviceConfirmTitle: "删除该设备？",
    deleteDeviceConfirmBody: "该设备下的登录记录和刷新令牌会被永久删除。",
    deleteRecordConfirmTitle: "删除该登录记录？",
    deleteRecordConfirmBody: "这条登录记录和关联刷新令牌会被永久删除。",
    cancel: "取消",
    confirm: "下线",
    confirmDelete: "删除",
    loadFailed: "加载登录设备失败",
    revokeFailed: "设备下线失败",
    deleteFailed: "删除登录信息失败",
  },
  en: {
    title: "Login Security",
    subtitle: "Review signed-in devices for this account and sign out devices you no longer use",
    adminSubtitle: "Review signed-in devices for all users and sign out devices no longer in use",
    refresh: "Refresh",
    loading: "Loading login devices...",
    empty: "No login devices",
    current: "Current device",
    active: "Online",
    signedIn: "Signed in",
    inactive: "Signed out",
    firstSeen: "First seen",
    lastSeen: "Last seen",
    expires: "Re-login by",
    ip: "Login IP",
    lastIp: "Recent IP",
    owner: "User",
    deviceId: "Device ID",
    sessions: "Sign-ins",
    devices: "devices",
    records: "Login records",
    recordId: "Record ID",
    sessionPolicy: "Login policy",
    sessionPolicyHint: "Access tokens are short-lived. Refresh tokens rotate while active, but each device session lasts at most {days} days before a password prompt. This account can keep up to {devices} active devices.",
    revoke: "Sign out",
    revokeCurrent: "Sign out here",
    revokeConfirmTitle: "Sign out this device?",
    revokeConfirmBody: "This device's refresh token will be revoked immediately, and existing access tokens will be rejected on the next request.",
    revokeCurrentConfirmBody: "This device will return to the sign-in screen. Unsaved requests will not be retried.",
    delete: "Delete",
    deleteDevice: "Delete device",
    deleteRecord: "Delete record",
    deleteDeviceConfirmTitle: "Delete this device?",
    deleteDeviceConfirmBody: "All login records and refresh tokens for this device will be permanently deleted.",
    deleteRecordConfirmTitle: "Delete this login record?",
    deleteRecordConfirmBody: "This login record and its refresh token will be permanently deleted.",
    cancel: "Cancel",
    confirm: "Sign out",
    confirmDelete: "Delete",
    loadFailed: "Failed to load login devices",
    revokeFailed: "Failed to sign out device",
    deleteFailed: "Failed to delete login information",
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

function shortId(value: string) {
  if (!value) return "-";
  return value.length > 16 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

export function SecurityPage({ confirmAction, language }: { confirmAction: ConfirmFn; language: AppLanguage }) {
  const auth = useAuth();
  const t = copy[language];
  const isAdmin = auth.can("users:manage");
  const [sessions, setSessions] = useState<LoginSession[]>([]);
  const [maxLifetimeDays, setMaxLifetimeDays] = useState(30);
  const [maxDevices, setMaxDevices] = useState(5);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState("");

  const onlineCount = useMemo(() => sessions.filter((session) => session.is_online).length, [sessions]);
  const userGroups = useMemo(() => {
    const groups = new Map<string, {
      userId: string;
      username: string;
      displayName: string;
      sessions: LoginSession[];
    }>();
    for (const session of sessions) {
      const key = session.user_id || "unknown";
      const existing = groups.get(key);
      if (existing) {
        existing.sessions.push(session);
      } else {
        groups.set(key, {
          userId: key,
          username: session.username,
          displayName: session.display_name,
          sessions: [session],
        });
      }
    }
    return [...groups.values()].sort((left, right) => {
      const leftOnline = left.sessions.filter((session) => session.is_online).length;
      const rightOnline = right.sessions.filter((session) => session.is_online).length;
      return rightOnline - leftOnline || (right.sessions[0]?.last_seen_at ?? "").localeCompare(left.sessions[0]?.last_seen_at ?? "");
    });
  }, [sessions]);

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
      const result = await revokeLoginSession(session.id, isAdmin ? session.user_id : undefined);
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

  async function handleDeleteDevice(session: LoginSession) {
    const confirmed = await confirmAction({
      cancelText: t.cancel,
      confirmText: t.confirmDelete,
      destructive: true,
      title: t.deleteDeviceConfirmTitle,
      description: session.is_current ? t.revokeCurrentConfirmBody : t.deleteDeviceConfirmBody,
    });
    if (!confirmed) return;

    setDeleting(`device:${session.user_id}:${session.id}`);
    setError("");
    try {
      const result = await deleteLoginDevice(session.id, isAdmin ? session.user_id : undefined);
      if (result.deleted_current) {
        await auth.logout();
        return;
      }
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.deleteFailed);
    } finally {
      setDeleting(null);
    }
  }

  async function handleDeleteRecord(session: LoginSession, record: LoginRecord) {
    const confirmed = await confirmAction({
      cancelText: t.cancel,
      confirmText: t.confirmDelete,
      destructive: true,
      title: t.deleteRecordConfirmTitle,
      description: record.is_current ? t.revokeCurrentConfirmBody : t.deleteRecordConfirmBody,
    });
    if (!confirmed) return;

    setDeleting(`record:${record.id}`);
    setError("");
    try {
      const result = await deleteLoginRecord(session.id, record.id, isAdmin ? session.user_id : undefined);
      if (result.deleted_current) {
        await auth.logout();
        return;
      }
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.deleteFailed);
    } finally {
      setDeleting(null);
    }
  }

  function renderRecord(session: LoginSession, record: LoginRecord) {
    const statusText = record.is_online ? t.active : record.is_active ? t.signedIn : t.inactive;
    const StatusIcon = record.is_online || record.is_active ? CheckCircle2 : XCircle;
    return (
      <div key={record.id} className="flex min-w-0 items-center gap-2 border-t border-border/60 py-2 first:border-t-0">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-[11px] text-foreground">{shortId(record.id)}</p>
            {record.is_current ? <Badge variant="outline">{t.current}</Badge> : null}
            <Badge variant={record.is_online ? "secondary" : record.is_active ? "outline" : "muted"}>
              <StatusIcon className="size-3" />
              {statusText}
            </Badge>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {formatDate(record.created_at, language)} · {formatDate(record.last_seen_at, language)}
          </p>
        </div>
        <Button
          aria-label={t.deleteRecord}
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
          disabled={deleting === `record:${record.id}`}
          onClick={() => void handleDeleteRecord(session, record)}
          size="icon"
          variant="ghost"
        >
          {deleting === `record:${record.id}` ? <Loader2 className="animate-spin" /> : <Trash2 />}
        </Button>
      </div>
    );
  }

  function renderDevice(session: LoginSession) {
    const DeviceIcon = isMobileDevice(session.user_agent) ? Smartphone : Laptop;
    const statusText = session.is_online ? t.active : session.is_active ? t.signedIn : t.inactive;
    const StatusIcon = session.is_online || session.is_active ? CheckCircle2 : XCircle;
    const deletingDevice = deleting === `device:${session.user_id}:${session.id}`;
    return (
      <article key={`${session.user_id}:${session.id}`} className="rounded-md border border-border/80 bg-background/60 p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <DeviceIcon className="size-4 text-primary" />
              <p className="text-sm font-semibold">{deviceName(session.user_agent, language)}</p>
              {isAdmin ? <Badge variant="outline">{session.username || session.user_id}</Badge> : null}
              {session.is_current ? <Badge variant="outline">{t.current}</Badge> : null}
              <Badge variant={session.is_online ? "secondary" : session.is_active ? "outline" : "muted"}>
                <StatusIcon className="size-3" />
                {statusText}
              </Badge>
            </div>
            <p className="mt-1 line-clamp-2 break-all text-xs text-muted-foreground">{session.user_agent || deviceName("", language)}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={session.is_current ? "destructive" : "outline"}
              onClick={() => void handleRevoke(session)}
              disabled={!session.is_active || revoking === session.id}
            >
              {revoking === session.id ? <Loader2 className="animate-spin" /> : <LogOut />}
              {session.is_current ? t.revokeCurrent : t.revoke}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleDeleteDevice(session)}
              disabled={deletingDevice}
            >
              {deletingDevice ? <Loader2 className="animate-spin" /> : <Trash2 />}
              {t.deleteDevice}
            </Button>
          </div>
        </div>

        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          <Info label={t.firstSeen} value={formatDate(session.created_at, language)} />
          <Info label={t.lastSeen} value={formatDate(session.last_seen_at, language)} />
          <Info label={t.expires} value={formatDate(session.expires_at, language)} />
          {isAdmin ? <Info label={t.owner} value={session.display_name ? `${session.display_name} · ${session.username}` : session.username || session.user_id} /> : null}
          {isAdmin ? <Info label={t.deviceId} value={session.device_id || session.id} /> : null}
          <Info label={t.ip} value={session.ip_address || "-"} />
          <Info label={t.lastIp} value={session.last_ip_address || "-"} />
          <Info label={t.sessions} value={String(session.session_count || 1)} />
        </div>

        {session.records?.length ? (
          <div className="mt-3 border-t border-border/70 pt-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold">{t.records}</p>
              <Badge variant="outline">{session.records.length}</Badge>
            </div>
            <div className="mt-2">
              {session.records.map((record) => renderRecord(session, record))}
            </div>
          </div>
        ) : null}
      </article>
    );
  }

  return (
    <section className="panel motion-panel page-enter flex min-h-0 min-w-0 flex-1 flex-col rounded-md lg:h-full">
      <div className="panel-header flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" />
            <p className="font-semibold">{t.title}</p>
          </div>
          <p className="text-xs text-muted-foreground">{isAdmin ? t.adminSubtitle : t.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{onlineCount} {t.active}</Badge>
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
        ) : isAdmin ? (
          <div className="space-y-5">
            {userGroups.map((group) => {
              const groupOnline = group.sessions.filter((session) => session.is_online).length;
              const owner = group.displayName ? `${group.displayName} · ${group.username}` : group.username || group.userId;
              return (
                <section key={group.userId} className="space-y-3 border-b border-border/70 pb-5 last:border-b-0 last:pb-0">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{owner}</p>
                      <p className="mt-0.5 break-all text-xs text-muted-foreground">{group.userId}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{group.sessions.length} {t.devices}</Badge>
                      <Badge variant="secondary">{groupOnline} {t.active}</Badge>
                    </div>
                  </div>
                  <div className="grid gap-3 xl:grid-cols-2">
                    {group.sessions.map((session) => renderDevice(session))}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {sessions.map((session) => renderDevice(session))}
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
