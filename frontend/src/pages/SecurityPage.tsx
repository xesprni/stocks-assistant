import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, CheckCircle2, ChevronRight, CircleAlert, Clock3, Globe2, History, KeyRound, Laptop, Loader2, LogOut, Search, ShieldCheck, Smartphone, Tablet, Trash2, Users, X, RefreshCw } from "lucide-react";

import type { ConfirmDialogOptions, ConfirmFn } from "@/components/common/ConfirmDialog";
import { SideDrawer } from "@/components/common/SideDrawer";
import { useToast } from "@/components/common/Toast";
import { ChangePasswordDialog } from "@/components/security/ChangePasswordDialog";
import { dateValue, deviceInfo, formatSessionDate, hasValidLogin, relativeSessionDate, sessionKey } from "@/components/security/session-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { deleteLoginDevice, deleteLoginRecord, listLoginSessions, revokeLoginSession, revokeOtherLoginDevices } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { securityCopy, type AppLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { LoginRecord, LoginSession, LoginSessionListResponse } from "@/types/app";

type DeviceFilter = "active" | "history" | "all";
const PAGE_SIZE = 12;

function replaceCount(template: string, count: number) {
  return template.replace("{count}", String(count));
}

function DeviceIcon({ userAgent, className }: { userAgent: string; className?: string; }) {
  const { kind } = deviceInfo(userAgent, "");
  const Icon = kind === "phone" ? Smartphone : kind === "tablet" ? Tablet : Laptop;
  return <Icon aria-hidden="true" className={className} />;
}

function StatusBadge({ record, language }: { record: LoginRecord; language: AppLanguage; }) {
  const t = securityCopy[language];
  const active = hasValidLogin(record);
  const expired = !active && !record.revoked_at && dateValue(record.expires_at) <= Date.now();
  return <Badge
    variant="outline"
    className={cn("gap-1.5 whitespace-nowrap font-medium", active ? "border-primary/20 bg-primary/5 text-primary" : "text-muted-foreground")}
  >
    {active ? <span
      className={cn("size-1.5 rounded-full", record.is_online ? "bg-emerald-600 dark:bg-emerald-400" : "bg-primary/60")}
    /> : <Clock3 className="size-3" aria-hidden="true" />}
    {record.is_online && active ? t.online : active ? t.active : expired ? t.expired : t.inactive}
  </Badge>;
}

export function SecurityPage({ confirmAction, language }: { confirmAction: ConfirmFn; language: AppLanguage; }) {
  const auth = useAuth();
  const { showToast } = useToast();
  const t = securityCopy[language];
  const isAdmin = auth.permissions.has("*") || Boolean(auth.user?.roles.includes("admin"));
  const [data, setData] = useState<LoginSessionListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState(0);
  const [scope, setScope] = useState("mine");
  const [filter, setFilter] = useState<DeviceFilter>("active");
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("all");
  const [sort, setSort] = useState("recent");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [recordCount, setRecordCount] = useState(PAGE_SIZE);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const mutationLock = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  const [now, setNow] = useState(Date.now);
  const allUsers = isAdmin && scope === "all";

  const load = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const response = await listLoginSessions({ signal: controller.signal });
      if (controller.signal.aborted) return;
      setData(response);
      setUpdatedAt(Date.now());
      setNow(Date.now());
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : t.loadFailed);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [t.loadFailed]);

  useEffect(() => {
    void load();
    return () => requestRef.current?.abort();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => setVisibleCount(PAGE_SIZE), [query, filter, scope, owner, sort]);
  useEffect(() => setRecordCount(PAGE_SIZE), [selectedKey]);

  const sessions = data?.sessions ?? [];
  const ownSessions = sessions.filter((session) => session.user_id === auth.user?.id);
  const current = ownSessions.find((session) => session.is_current);
  const trustedCurrent = current?.records.some((record) => record.is_current && hasValidLogin(record, now));
  const otherCount = ownSessions.filter((session) => hasValidLogin(session, now) && !session.is_current).length;
  const scopedSessions = allUsers ? sessions : ownSessions;
  const counts = {
    active: scopedSessions.filter((session) => hasValidLogin(session, now)).length,
    online: scopedSessions.filter((session) => session.is_online && hasValidLogin(session, now)).length,
    history: scopedSessions.filter((session) => !hasValidLogin(session, now)).length,
    all: scopedSessions.length,
  };
  const owners = useMemo(() => {
    const users = new Map<string, string>();
    for (const session of data?.sessions ?? []) users.set(session.user_id, session.display_name ? `${session.display_name} (@${session.username})` : session.username || t.unknownOwner);
    return [...users].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data, t.unknownOwner]);
  const filtered = scopedSessions.filter((session) => {
    if (filter === "active" && !hasValidLogin(session, now)) return false;
    if (filter === "history" && hasValidLogin(session, now)) return false;
    if (allUsers && owner !== "all" && session.user_id !== owner) return false;
    const searchable = [deviceInfo(session.user_agent, t.unknownDevice).name, session.user_agent, session.ip_address, session.last_ip_address, ...(allUsers ? [session.username, session.display_name] : [])].join(" ").toLocaleLowerCase();
    return searchable.includes(query.trim().toLocaleLowerCase());
  }).sort((left, right) => {
    const time = dateValue(right.last_seen_at) - dateValue(left.last_seen_at);
    return Number(right.is_current) - Number(left.is_current) || (sort === "recent" ? time : -time) || sessionKey(left).localeCompare(sessionKey(right));
  });
  const selected = sessions.find((session) => sessionKey(session) === selectedKey);
  const records = [...(selected?.records ?? [])].sort((a, b) => dateValue(b.created_at) - dateValue(a.created_at));
  const hasFilters = Boolean(query.trim() || (allUsers && owner !== "all"));
  const disabled = pending !== null;

  function resetFilters() {
    setQuery("");
    setOwner("all");
    setFilter("all");
  }

  async function runAction(key: string, options: ConfirmDialogOptions, action: () => Promise<{ current?: boolean; message: string; }>) {
    // 将确认过程也纳入互斥，避免连续点击生成多个相互覆盖的确认或并发撤销。
    if (mutationLock.current) return;
    mutationLock.current = true;
    setPending(key);
    try {
      if (!await confirmAction(options)) return;
      const result = await action();
      showToast({ kind: "success", message: result.message });
      if (result.current) {
        await auth.logout();
        return;
      }
      await load();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : t.actionFailed;
      showToast({ kind: "error", message: message === "Current login device could not be verified; please sign in again" ? t.noCurrentHint : message });
    } finally {
      mutationLock.current = false;
      setPending(null);
    }
  }

  function signOut(session: LoginSession) {
    void runAction(`revoke:${sessionKey(session)}`, {
      title: session.is_current ? t.signOutHere : t.signOutConfirm,
      description: session.is_current ? t.currentBody : t.signOutBody.replace("{device}", deviceInfo(session.user_agent, t.unknownDevice).name),
      cancelText: t.cancel, confirmText: t.signOut, destructive: true,
    }, async () => {
      const result = await revokeLoginSession(session.id, isAdmin ? session.user_id : undefined);
      return { current: result.revoked_current, message: t.signedOut };
    });
  }

  function signOutOthers() {
    void runAction("others", {
      title: t.othersConfirm, description: t.othersBody, cancelText: t.cancel, confirmText: t.signOutOthers, destructive: true,
    }, async () => {
      const result = await revokeOtherLoginDevices();
      return { message: replaceCount(t.othersSuccess, result.revoked_devices) };
    });
  }

  function removeDevice(session: LoginSession) {
    void runAction(`delete:${sessionKey(session)}`, {
      title: t.deleteDeviceConfirm,
      description: `${t.deleteDeviceBody.replace("{device}", deviceInfo(session.user_agent, t.unknownDevice).name)}${session.is_current ? ` ${t.currentBody}` : ""}`,
      cancelText: t.cancel, confirmText: t.confirmDelete, destructive: true,
    }, async () => {
      const result = await deleteLoginDevice(session.id, isAdmin ? session.user_id : undefined);
      setSelectedKey(null);
      return { current: result.deleted_current, message: t.deleted };
    });
  }

  function removeRecord(session: LoginSession, record: LoginRecord) {
    void runAction(`record:${record.id}`, {
      title: t.deleteRecordConfirm, description: `${t.deleteRecordBody}${(record.is_current || (session.is_current && !session.records.some((item) => item.is_current))) ? ` ${t.currentBody}` : ""}`,
      cancelText: t.cancel, confirmText: t.confirmDelete, destructive: true,
    }, async () => {
      const result = await deleteLoginRecord(session.id, record.id, isAdmin ? session.user_id : undefined);
      return { current: result.deleted_current, message: t.deleted };
    });
  }

  return (
    <section
      className="page-enter flex min-h-0 min-w-0 flex-1 flex-col lg:h-full"
      aria-labelledby="security-title"
    >
      <div className="min-h-0 flex-1 space-y-5 pb-6 lg:overflow-y-auto lg:pr-1">
        <header className="flex flex-wrap items-start justify-between gap-4 pt-2">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-primary">
              <ShieldCheck className="size-4" aria-hidden="true" />
              {auth.user?.display_name || auth.user?.username}
            </div>
            <h1 id="security-title" className="text-2xl font-semibold tracking-tight">{t.title}</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">{t.subtitle}</p>
          </div>
          <div className="flex items-center gap-3">
            {updatedAt > 0 && <span className="hidden text-xs text-muted-foreground sm:inline">
              {t.updated} {new Date(updatedAt).toLocaleTimeString(language === "en" ? "en-US" : "zh-CN", { hour: "2-digit", minute: "2-digit" })}
            </span>}
            <Button
              variant="outline"
              onClick={() => void load()}
              disabled={loading || disabled}
            >
              <RefreshCw className={loading ? "animate-spin" : ""} />
              {t.refresh}
            </Button>
          </div>
        </header>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
          <article className="rounded-2xl border border-primary/20 bg-primary/[0.035] p-4">
            <div className="flex items-start gap-4">
              <div
                className="grid size-10 shrink-0 place-items-center rounded-xl border border-primary/10 bg-card text-primary"
              >
                <DeviceIcon userAgent={current?.user_agent ?? ""} className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold">{t.currentDevice}</h2>
                  {current && <Badge variant="outline" className="border-primary/15 bg-primary/5 text-primary">{t.currentHint}</Badge>}
                </div>
                {loading && !data ? <div className="mt-3 h-4 w-40 animate-pulse rounded bg-muted" /> : <>
                  <p className="mt-2 text-sm font-medium">
                    {current ? deviceInfo(current.user_agent, t.unknownDevice).name : error ? t.loadFailed : t.noCurrent}
                  </p>
                  <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">
                    {current ? `${current.last_ip_address || current.ip_address || "—"} · ${auth.user?.username}` : !error && t.noCurrentHint}
                  </p>
                </>}
              </div>
              {current && <Button
                size="icon"
                variant="ghost"
                aria-label={`${t.details} · ${t.currentDevice}`}
                onClick={() => setSelectedKey(sessionKey(current))}
              >
                <ArrowUpRight />
              </Button>}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-primary/10 pt-3">
              <p className="max-w-sm text-xs leading-5 text-muted-foreground">
                {data && !trustedCurrent ? t.noCurrentHint : data && otherCount === 0 ? t.othersEmpty : t.othersHint}
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={!trustedCurrent || !otherCount || loading || disabled}
                onClick={signOutOthers}
              >
                {pending === "others" ? <Loader2 className="animate-spin" /> : <LogOut />}
                {t.signOutOthers}
              </Button>
            </div>
          </article>
          <article className="flex flex-col justify-between gap-4 rounded-2xl border border-border/70 bg-card/70 p-4">
            <div className="flex items-start gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted/70 text-muted-foreground">
                <KeyRound className="size-5" />
              </div>
              <div>
                <h2 className="font-semibold">{t.passwordTitle}</h2>
                <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{t.passwordHint}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{t.passwordOwner}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPasswordOpen(true)}
                disabled={disabled}
              >
                {t.changePassword}
                <ChevronRight />
              </Button>
            </div>
          </article>
        </div>

        <section className="space-y-4" aria-labelledby="security-devices-title">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="security-devices-title" className="text-base font-semibold">{t.devicesTitle}</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{t.devicesHint}</p>
            </div>
            {isAdmin && <div
              className="inline-flex rounded-xl border border-border/60 bg-muted/50 p-1"
              role="group"
              aria-label={t.ownerFilter}
            >
              {[["mine", t.myDevices], ["all", t.allUsers]].map(([value, label]) => <Button
                key={value}
                size="sm"
                variant="ghost"
                aria-pressed={scope === value}
                className={cn("rounded-lg", scope === value && "bg-card shadow-sm")}
                onClick={() => { setScope(value); setOwner("all"); }}
              >
                {value === "all" && <Users />}
                {label}
              </Button>)}
            </div>}
          </div>
          <div className="grid grid-cols-3 gap-2 sm:gap-4">
            {([
              ["active", t.activeDevices, t.activeHint, Laptop],
              ["online", t.online, t.onlineHint, Globe2],
              ["history", t.history, t.historyHint, History],
            ] as const).map(([key, title, hint, Icon]) => <div key={key} className="rounded-xl border border-border/60 bg-card/50 p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">{title}</span>
                <Icon className="hidden size-4 text-muted-foreground/70 sm:block" aria-hidden="true" />
              </div>
              <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">
                {data ? counts[key] : "—"}
                {key === "active" && !allUsers && data && <span className="ml-1 text-sm font-normal text-muted-foreground">/ {data.max_devices_per_user}
                </span>}
              </p>
              <p className="mt-1 hidden text-[11px] leading-4 text-muted-foreground sm:block">{hint}</p>
            </div>)}
          </div>

          <Tabs value={filter} onValueChange={(value) => setFilter(value as DeviceFilter)}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <TabsList aria-label={t.status}>
                {([["active", t.active], ["history", t.history], ["all", t.all]] as const).map(([value, label]) => <TabsTrigger
                  key={value}
                  value={value}
                  className="gap-2"
                >
                  {label}
                  <span className="text-[11px] tabular-nums opacity-60">{data ? counts[value] : "—"}</span>
                </TabsTrigger>)}
              </TabsList>
              <p className={cn("text-xs", allUsers ? "text-primary" : "text-muted-foreground")}>
                {allUsers ? t.adminScope : t.myScope}
              </p>
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <div className="relative min-w-0 flex-1">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  aria-label={allUsers ? t.adminSearch : t.search}
                  placeholder={allUsers ? t.adminSearch : t.search}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="h-10 pl-9 pr-10"
                />
                {query && <Button
                  className="absolute right-1 top-0.5 size-9"
                  size="icon"
                  variant="ghost"
                  aria-label={t.clearSearch}
                  onClick={() => setQuery("")}
                >
                  <X />
                </Button>}
              </div>
              {allUsers && <Select
                aria-label={t.ownerFilter}
                className="sm:w-48"
                value={owner}
                onValueChange={setOwner}
                options={[{ value: "all", label: t.allOwners }, ...owners.map(([value, label]) => ({ value, label }))]}
              />}
              <Select
                aria-label={t.sort}
                className="sm:w-48"
                value={sort}
                onValueChange={setSort}
                options={[{ value: "recent", label: t.recentFirst }, { value: "oldest", label: t.oldestFirst }]}
              />
            </div>
            <TabsContent
              value={filter}
              className="mt-3"
              aria-busy={loading}
            >
              {error && <div
                role="alert"
                className="mb-3 flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4"
              >
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{data ? t.stale : t.loadFailed}</p>
                  <p className="mt-1 break-words text-xs text-muted-foreground">{error}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loading || disabled}
                  onClick={() => void load()}
                >
                  {t.retry}
                </Button>
              </div>}
              {!data && loading ? <div role="status" className="space-y-1 rounded-xl border border-border/60 p-4">
                <p className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  {t.loading}
                </p>
                {[0, 1, 2].map((value) => <div key={value} className="h-20 animate-pulse rounded-lg bg-muted/60" />)}
              </div>
                : data && filtered.length ? <div className="overflow-hidden rounded-xl border border-border/70 bg-card/60">
                  <div
                    className={cn("hidden gap-4 border-b border-border/60 bg-muted/35 px-5 py-3 text-[11px] font-medium text-muted-foreground lg:grid", allUsers ? "grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(8rem,0.7fr)_6rem]" : "grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_minmax(8rem,0.7fr)_6rem]")}
                    aria-hidden="true"
                  >
                    <span>{t.device}</span>
                    {allUsers && <span>{t.owner}</span>}
                    <span>{t.activity}</span>
                    <span>{t.status}</span>
                    <span />
                  </div>
                  <ul className="divide-y divide-border/60">
                    {filtered.slice(0, visibleCount).map((session) => <li
                      key={sessionKey(session)}
                      className={cn("grid gap-3 px-4 py-4 transition-colors hover:bg-muted/20 sm:px-5 lg:items-center lg:gap-4", session.is_current && "bg-primary/[0.025]", allUsers ? "lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(8rem,0.7fr)_6rem]" : "lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_minmax(8rem,0.7fr)_6rem]")}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div
                          className={cn("grid size-10 shrink-0 place-items-center rounded-xl", session.is_current ? "bg-primary/10 text-primary" : "bg-muted/65 text-muted-foreground")}
                        >
                          <DeviceIcon userAgent={session.user_agent} className="size-5" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <p className="text-sm font-medium">{deviceInfo(session.user_agent, t.unknownDevice).name}</p>
                            {session.is_current && <span className="text-[10px] font-semibold text-primary">{t.currentDevice}</span>}
                          </div>
                          <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                            {session.last_ip_address || session.ip_address || "—"}
                          </p>
                        </div>
                      </div>
                      {allUsers && <div className="min-w-0 pl-[52px] lg:pl-0">
                        <p className="truncate text-xs font-medium">{session.display_name || session.username || t.unknownOwner}</p>
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">@{session.username}
                        </p>
                      </div>}
                      <div className="pl-[52px] lg:pl-0">
                        <p className="text-xs">
                          <span className="mr-2 text-muted-foreground lg:hidden">{t.activity}</span>
                          <time dateTime={session.last_seen_at} title={formatSessionDate(session.last_seen_at, language)}>
                            {relativeSessionDate(session.last_seen_at, language, now)}
                          </time>
                        </p>
                        <p className="mt-1 hidden text-[11px] text-muted-foreground lg:block">
                          {formatSessionDate(session.last_seen_at, language)}
                        </p>
                      </div>
                      <div className="pl-[52px] lg:pl-0">
                        <StatusBadge record={session} language={language} />
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto text-primary"
                        aria-label={`${t.details} · ${deviceInfo(session.user_agent, t.unknownDevice).name}${allUsers ? ` · ${session.username}` : ""}`}
                        onClick={() => setSelectedKey(sessionKey(session))}
                      >
                        {t.details}
                        <ChevronRight className="!size-3.5" />
                      </Button>
                    </li>)}
                  </ul>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-5 py-3">
                    <p role="status" className="text-xs text-muted-foreground">
                      {t.showing.replace("{shown}", String(Math.min(visibleCount, filtered.length))).replace("{total}", String(filtered.length))}
                    </p>
                    {visibleCount < filtered.length && <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setVisibleCount((value) => value + PAGE_SIZE)}
                    >
                      {t.more}
                    </Button>}
                  </div>
                </div> : data && <div className="rounded-xl border border-dashed border-border bg-card/40 px-4 py-12 text-center">
                  <Search className="mx-auto size-7 text-muted-foreground/60" aria-hidden="true" />
                  <h3 className="mt-4 text-sm font-semibold">
                    {hasFilters ? t.noResults : scopedSessions.length === 0 ? t.empty : filter === "history" ? t.noHistory : t.noActive}
                  </h3>
                  <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-muted-foreground">
                    {hasFilters ? t.noResultsHint : filter === "history" ? t.noHistoryHint : t.emptyHint}
                  </p>
                  {(hasFilters || scopedSessions.length > 0) && <Button
                    className="mt-4"
                    variant="outline"
                    size="sm"
                    onClick={resetFilters}
                  >
                    {hasFilters ? t.resetFilters : t.showAll}
                  </Button>}
                </div>}
            </TabsContent>
          </Tabs>
        </section>

        {data && <section className="rounded-xl border border-border/60 bg-muted/20 p-4" aria-labelledby="security-policy">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div>
              <h2 id="security-policy" className="text-xs font-semibold">{t.policyTitle}</h2>
              <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
                {[[t.policyDevices, data.max_devices_per_user], [t.policyDays, data.max_lifetime_days], [t.policyRefresh, data.refresh_token_days]].map(([template, count]) => <li key={template} className="flex items-center gap-1.5">
                  <CheckCircle2 className="size-3 shrink-0" aria-hidden="true" />
                  {replaceCount(String(template), Number(count))}
                </li>)}
              </ul>
              <p className="mt-2 text-[11px] leading-5 text-muted-foreground">{t.policyHint}</p>
            </div>
          </div>
        </section>}
      </div>

      <SideDrawer
        open={Boolean(selected)}
        onClose={() => setSelectedKey(null)}
        dismissDisabled={disabled}
        title={selected ? deviceInfo(selected.user_agent, t.unknownDevice).name : t.details}
        subtitle={selected ? `${selected.display_name || selected.username} · ${t.devicesTitle}` : undefined}
        closeLabel={t.close}

        footer={selected && <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={disabled || loading}
            onClick={() => removeDevice(selected)}
          >
            {pending === `delete:${sessionKey(selected)}` ? <Loader2 className="animate-spin" /> : <Trash2 />}
            {t.deleteDevice}
          </Button>
          {hasValidLogin(selected, now) && <Button
            variant="outline"
            size="sm"
            disabled={disabled || loading}
            onClick={() => signOut(selected)}
          >
            {pending === `revoke:${sessionKey(selected)}` ? <Loader2 className="animate-spin" /> : <LogOut />}
            {selected.is_current ? t.signOutHere : t.signOut}
          </Button>}
        </div>}
      >
        {selected && <div className="space-y-6">
          <div className="flex items-center gap-2">
            <StatusBadge record={selected} language={language} />
            {selected.is_current && <Badge variant="outline">{t.currentDevice}</Badge>}
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-5">
            {[[t.firstSeen, formatSessionDate(selected.created_at, language)], [t.lastSeen, formatSessionDate(selected.last_seen_at, language)], [t.expires, formatSessionDate(selected.expires_at, language)], [t.loginCount, String(selected.session_count || 1)], [t.loginIp, selected.ip_address || "—"], [t.lastIp, selected.last_ip_address || "—"]].map(([label, value]) => <div key={label} className="min-w-0">
              <dt className="text-[11px] text-muted-foreground">{label}</dt>
              <dd className="mt-1.5 break-words text-xs font-medium">{value}</dd>
            </div>)}
          </dl>
          <section className="border-t border-border/70 pt-5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{t.records}</h3>
              <Badge variant="outline">{records.length}</Badge>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t.recordsHint} {t.minuteNote}
            </p>
            <ol className="mt-3 divide-y divide-border/60">
              {records.slice(0, recordCount).map((record) => <li key={record.id} className="py-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium">{formatSessionDate(record.created_at, language)}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <StatusBadge record={record} language={language} />
                      {record.is_current && <span className="text-[11px] text-primary">{t.sessionCurrent}</span>}
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    disabled={disabled || loading}
                    aria-label={`${t.deleteRecord} · ${formatSessionDate(record.created_at, language)}`}
                    onClick={() => removeRecord(selected, record)}
                  >
                    {pending === `record:${record.id}` ? <Loader2 className="animate-spin" /> : <Trash2 />}
                  </Button>
                </div>
                <dl className="mt-3 space-y-1 text-[11px] text-muted-foreground">
                  <div className="flex flex-wrap justify-between gap-x-2">
                    <dt>{t.lastSeen}</dt>
                    <dd>{formatSessionDate(record.last_seen_at, language)}</dd>
                  </div>
                  <div className="flex flex-wrap justify-between gap-x-2">
                    <dt>{t.lastIp}</dt>
                    <dd className="break-all font-mono">{record.last_ip_address || record.ip_address || "—"}</dd>
                  </div>
                </dl>
                <details className="mt-2 text-[11px] text-muted-foreground">
                  <summary
                    className="cursor-pointer rounded py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t.recordId}
                  </summary>
                  <p className="mt-1 break-all font-mono">{record.id}</p>
                </details>
              </li>)}
            </ol>
            {!records.length && <p className="py-6 text-xs text-muted-foreground">{t.noRecords}</p>}
            {recordCount < records.length && <Button
              size="sm"
              variant="outline"
              onClick={() => setRecordCount((value) => value + PAGE_SIZE)}
            >
              {t.more}
            </Button>}
          </section>
          <details className="rounded-xl border border-border/60 p-3">
            <summary
              className="cursor-pointer rounded text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t.technical}
            </summary>
            <dl className="mt-4 space-y-4 text-xs">
              <div>
                <dt className="text-muted-foreground">{t.deviceId}</dt>
                <dd className="mt-1 break-all font-mono text-[11px]">{selected.device_id || selected.id}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t.userAgent}</dt>
                <dd className="mt-1 break-all text-[11px] leading-5">{selected.user_agent || "—"}</dd>
              </div>
            </dl>
          </details>
          <p className="text-[11px] leading-5 text-muted-foreground">{t.dangerHint}</p>
        </div>}
      </SideDrawer>
      <ChangePasswordDialog
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        language={language}
      />
    </section>
  );
}
