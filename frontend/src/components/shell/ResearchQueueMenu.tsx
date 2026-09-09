import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Bell, CheckCheck, Loader2, RefreshCw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { listAlertEvents } from "@/lib/api";
import { localeFor, type AppLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { AlertEvent } from "@/types/app";
import type { Page } from "@/types/ui";

const SEVERITY_PRIORITY: Record<AlertEvent["severity"], number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
const SEVERITY_COLOR: Record<AlertEvent["severity"], string> = {
  critical: "bg-destructive", high: "bg-orange-500", medium: "bg-amber-500", low: "bg-sky-500", info: "bg-muted-foreground",
};
const UNREAD_LIMIT = 500;

export function ResearchQueueMenu({
  active,
  language,
  onOpenEvent,
  onOpenInbox,
  page,
}: {
  active: boolean;
  language: AppLanguage;
  onOpenEvent?: (symbol: string) => void;
  onOpenInbox: () => void;
  page: Page | null;
}) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<AlertEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 64, maxHeight: 480 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const refreshRef = useRef<() => void>(() => undefined);
  const panelId = useId();
  const titleId = useId();
  const copy = language === "en"
    ? {
      title: "Daily Research Queue", subtitle: "Unread changes ranked by severity", inbox: "Open inbox", close: "Close research queue",
      empty: "You're all caught up", emptyHint: "No unread changes require review.", loading: "Loading changes…", retry: "Retry",
      failed: "Unable to load the research queue.", stale: "Unable to refresh. Showing the last loaded changes.", unavailable: "Unread count unavailable",
      unread: "unread changes", severity: { critical: "Critical", high: "High", medium: "Medium", low: "Low", info: "Info" },
    }
    : {
      title: "每日研究队列", subtitle: "按严重度排序的待复核变化", inbox: "打开收件箱", close: "关闭研究队列",
      empty: "已处理所有待复核变化", emptyHint: "目前没有需要复核的未读变化。", loading: "正在加载变化…", retry: "重试",
      failed: "暂时无法加载研究队列。", stale: "刷新失败，当前显示上次加载的变化。", unavailable: "未读数量暂不可用",
      unread: "条未读变化", severity: { critical: "严重", high: "高", medium: "中", low: "低", info: "提示" },
    };
  const unreadCount = events?.length;
  const badgeCount = unreadCount !== undefined && unreadCount > 99 ? "99+" : String(unreadCount ?? "");
  const countLabel = failed ? copy.unavailable : unreadCount === undefined ? copy.loading : `${unreadCount >= UNREAD_LIMIT ? `${UNREAD_LIMIT}+` : unreadCount} ${copy.unread}`;

  useEffect(() => {
    let disposed = false;
    let pending = false;
    async function refresh() {
      if (!active || document.visibilityState === "hidden" || pending) return;
      pending = true;
      setLoading(true);
      try {
        const next = await listAlertEvents(undefined, "unread", UNREAD_LIMIT);
        if (disposed) return;
        setEvents(next.sort((left, right) => SEVERITY_PRIORITY[right.severity] - SEVERITY_PRIORITY[left.severity] || right.occurred_at.localeCompare(left.occurred_at)));
        setFailed(false);
      } catch {
        if (!disposed) setFailed(true);
      } finally {
        pending = false;
        if (!disposed) setLoading(false);
      }
    }
    refreshRef.current = () => void refresh();
    void refresh();
    const interval = window.setInterval(() => void refresh(), 60_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [active, page]);

  useEffect(() => {
    setOpen(false);
  }, [active, page]);

  useEffect(() => {
    if (!open) return;
    refreshRef.current();
    closeRef.current?.focus({ preventScroll: true });
    function close(restoreFocus = false) {
      setOpen(false);
      if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
    }
    function onPointerDown(event: PointerEvent) {
      const path = event.composedPath();
      if (!path.includes(panelRef.current as EventTarget) && !path.includes(triggerRef.current as EventTarget)) close();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close(true);
    }
    function onFocusIn(event: FocusEvent) {
      const target = event.target as Node | null;
      if (target && !panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) close();
    }
    function onResize() { close(true); }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  function toggle() {
    if (!open) {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) {
        const width = Math.min(368, window.innerWidth - 16);
        const top = rect.bottom + 10;
        setPosition({ left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)), top, maxHeight: window.innerHeight - top - 12 });
      }
    }
    setOpen((current) => !current);
  }

  function navigate(event: MouseEvent<HTMLAnchorElement>, symbol?: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
    if (symbol && onOpenEvent) onOpenEvent(symbol);
    else onOpenInbox();
  }

  return (
    <>
      <Button
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${copy.title} · ${countLabel}`}
        className={cn("relative rounded-full", open && "bg-muted text-foreground")}
        onClick={toggle}
        ref={triggerRef}
        size="icon"
        title={`${copy.title} · ${countLabel}`}
        type="button"
        variant="ghost"
      >
        <Bell />
        {failed ? <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 grid size-4 place-items-center rounded-full bg-amber-500 text-[10px] font-bold text-white ring-2 ring-background">!</span>
          : unreadCount ? <span aria-hidden="true" className="absolute -right-1 -top-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] font-bold leading-4 text-primary-foreground ring-2 ring-background tabular-nums">{badgeCount}</span> : null}
      </Button>
      {open && createPortal(
        <div
          aria-labelledby={titleId}
          className="apple-material-thick fixed z-[1100] flex w-[min(23rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-2xl border border-border/65 text-popover-foreground shadow-2xl"
          id={panelId}
          ref={panelRef}
          role="dialog"
          style={position}
        >
          <div className="flex shrink-0 items-start justify-between gap-2 px-4 pb-3 pt-4">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold tracking-tight" id={titleId}>{copy.title}</h2>
              <p className="mt-1 text-[11px] text-muted-foreground">{copy.subtitle}</p>
            </div>
            <Button aria-label={copy.close} className="-mr-1 -mt-1 size-7 rounded-full" onClick={() => { setOpen(false); triggerRef.current?.focus({ preventScroll: true }); }} ref={closeRef} size="icon" type="button" variant="ghost"><X className="size-3.5" /></Button>
          </div>
          <div aria-busy={loading} aria-live="polite" className="min-h-0 overflow-y-auto">
            {failed ? <div className="flex items-center gap-2 bg-amber-500/10 px-4 py-2 text-xs text-muted-foreground"><p className="flex-1">{events ? copy.stale : copy.failed}</p><Button className="shrink-0" disabled={loading} onClick={() => refreshRef.current()} size="sm" type="button" variant="ghost"><RefreshCw className={cn(loading && "animate-spin")} />{copy.retry}</Button></div> : null}
            {events?.length ? <div className="divide-y divide-border/45 px-2">{events.slice(0, 5).map((event) => (
              <a className="group flex gap-3 px-2 py-3 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" href={onOpenEvent ? `/security/${encodeURIComponent(event.symbol)}/alerts` : "/alerts"} key={event.id} onClick={(click) => navigate(click, event.symbol)}>
                <span aria-hidden="true" className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", SEVERITY_COLOR[event.severity])} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3 text-[10px] text-muted-foreground"><span className="truncate font-semibold tracking-wide text-foreground/80">{event.symbol}</span><span>{copy.severity[event.severity]}</span></div>
                  <p className="mt-1 line-clamp-2 text-xs font-medium leading-relaxed group-hover:text-primary">{event.title}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">{new Date(event.occurred_at).toLocaleString(localeFor(language), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                </div>
              </a>
            ))}</div> : loading && !events ? <div className="flex items-center justify-center gap-2 px-4 py-10 text-xs text-muted-foreground"><Loader2 className="size-4 animate-spin" />{copy.loading}</div>
              : events && !failed ? <div className="px-4 py-8 text-center"><CheckCheck className="mx-auto mb-3 size-6 text-primary/65" /><p className="text-sm font-medium">{copy.empty}</p><p className="mt-1.5 text-xs text-muted-foreground">{copy.emptyHint}</p></div> : null}
          </div>
          <a className="flex shrink-0 items-center justify-between border-t border-border/55 px-4 py-3 text-xs font-semibold text-primary transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" href="/alerts" onClick={(event) => navigate(event)}>{copy.inbox}<ArrowRight className="size-3.5" /></a>
        </div>, document.body,
      )}
    </>
  );
}
