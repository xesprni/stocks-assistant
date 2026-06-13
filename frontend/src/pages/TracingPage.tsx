import { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronRight, CircleDot, Cpu, Loader2, MessageSquareText, RefreshCw, Search, Settings2, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSessionTraces, listChatSessionPage } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { AgentTraceEvent, Conversation, TraceSessionResponse } from "@/types/app";

function formatDateTime(iso?: string | null) {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDurationMs(value?: number | null) {
  if (value == null) return "-";
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(2)}s`;
}

function statusTone(status: string): "default" | "danger" | "muted" | "outline" {
  if (status === "error") return "danger";
  if (status === "running") return "muted";
  if (status === "done" || status === "success") return "default";
  return "outline";
}

function TraceStatusIcon({ status }: { status: string }) {
  if (status === "running") return <Loader2 className="size-4 animate-spin text-primary" />;
  if (status === "error") return <X className="size-4 text-destructive" />;
  if (status === "done" || status === "success") return <Check className="size-4 text-emerald-500" />;
  return <CircleDot className="size-4 text-muted-foreground" />;
}

const TRACE_SESSION_PAGE_SIZE = 10;
const JSON_PREVIEW_MAX_CHARS = 180;

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return Array.isArray(value) || isJsonRecord(value);
}

function parseJsonContainerString(value: string): Record<string, unknown> | unknown[] | null {
  const trimmed = value.trim();
  if (!trimmed || !["{", "["].includes(trimmed[0])) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return isJsonContainer(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function jsonPreview(value: unknown) {
  const text = JSON.stringify(value);
  if (!text) return "";
  return text.length > JSON_PREVIEW_MAX_CHARS ? `${text.slice(0, JSON_PREVIEW_MAX_CHARS)}...` : text;
}

function primitiveTone(value: unknown) {
  if (value === null) return "text-muted-foreground";
  if (typeof value === "string") return "text-emerald-600 dark:text-emerald-400";
  if (typeof value === "number") return "text-sky-600 dark:text-sky-400";
  if (typeof value === "boolean") return "text-violet-600 dark:text-violet-400";
  return "text-muted-foreground";
}

function formatPrimitive(value: unknown) {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === undefined) return "undefined";
  return String(value);
}

export function TracingPage({
  activeSessionId,
  onOpenConfig,
  tracingEnabled,
}: {
  activeSessionId: string | null;
  onOpenConfig: () => void;
  tracingEnabled: boolean;
}) {
  const [sessions, setSessions] = useState<Conversation[]>([]);
  const [sessionPage, setSessionPage] = useState(1);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [isSessionLoading, setIsSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const [sessionIdInput, setSessionIdInput] = useState("");
  const [selectedSession, setSelectedSession] = useState<Conversation | null>(null);
  const [traceData, setTraceData] = useState<TraceSessionResponse | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [traceError, setTraceError] = useState("");

  useEffect(() => {
    loadSessionPage(sessionPage);
  }, [sessionPage]);

  async function loadSessionPage(page = sessionPage) {
    setIsSessionLoading(true);
    setSessionError("");
    try {
      const offset = (page - 1) * TRACE_SESSION_PAGE_SIZE;
      const next = await listChatSessionPage(TRACE_SESSION_PAGE_SIZE, offset);
      setSessions(next.sessions);
      setSessionTotal(next.total);
    } catch (caught) {
      setSessionError(caught instanceof Error ? caught.message : "会话加载失败");
      setSessions([]);
      setSessionTotal(0);
    } finally {
      setIsSessionLoading(false);
    }
  }

  async function loadTraces(targetSessionId = selectedSession?.id ?? sessionIdInput) {
    const clean = targetSessionId.trim();
    if (!clean) {
      setTraceError("请输入 session id");
      return;
    }
    setIsLoading(true);
    setTraceError("");
    try {
      const next = await getSessionTraces(clean, 20);
      setTraceData(next);
      const firstRun = next.runs[0] ?? null;
      setSelectedRunId(firstRun?.id ?? null);
      setExpandedEventId(null);
    } catch (caught) {
      setTraceError(caught instanceof Error ? caught.message : "调用链加载失败");
      setTraceData(null);
      setSelectedRunId(null);
      setExpandedEventId(null);
    } finally {
      setIsLoading(false);
    }
  }

  function openSession(session: Conversation) {
    setSelectedSession(session);
    setTraceData(null);
    setSelectedRunId(null);
    setExpandedEventId(null);
    loadTraces(session.id);
  }

  function openSessionById() {
    const clean = sessionIdInput.trim();
    if (!clean) {
      setSessionError("请输入 session id");
      return;
    }
    const existing = sessions.find((item) => item.id === clean);
    setSelectedSession(existing ?? {
      id: clean,
      title: "Session",
      messages: [],
      createdAt: "",
      updatedAt: "",
    });
    setTraceData(null);
    setSelectedRunId(null);
    setExpandedEventId(null);
    loadTraces(clean);
  }

  function backToSessions() {
    setSelectedSession(null);
    setTraceData(null);
    setSelectedRunId(null);
    setExpandedEventId(null);
    setTraceError("");
  }

  const selectedRun = traceData?.runs.find((run) => run.id === selectedRunId) ?? traceData?.runs[0] ?? null;
  const pageCount = Math.max(1, Math.ceil(sessionTotal / TRACE_SESSION_PAGE_SIZE));
  const pageStart = sessionTotal === 0 ? 0 : (sessionPage - 1) * TRACE_SESSION_PAGE_SIZE + 1;
  const pageEnd = Math.min(sessionTotal, sessionPage * TRACE_SESSION_PAGE_SIZE);

  return (
    <section className="panel motion-panel page-enter flex min-h-0 min-w-0 flex-1 flex-col rounded-md lg:h-full">
      <div className="page-toolbar flex flex-wrap items-center justify-end gap-2">
        {selectedSession ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={backToSessions}>
              <ChevronRight className="rotate-180" />
              Sessions
            </Button>
            <Button size="sm" disabled={isLoading} onClick={() => loadTraces(selectedSession.id)}>
              {isLoading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Refresh
            </Button>
          </div>
        ) : (
          <form
            className="flex min-w-0 flex-col gap-2 md:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              openSessionById();
            }}
          >
            <Input
              className="min-w-0 md:w-[340px]"
              placeholder="Session ID"
              value={sessionIdInput}
              onChange={(event) => setSessionIdInput(event.target.value)}
            />
            <Button size="sm" disabled={!sessionIdInput.trim()} type="submit">
              <Search />
              Open
            </Button>
            {activeSessionId ? (
              <Button
                size="sm"
                type="button"
                variant="outline"
                onClick={() => {
                  const current = sessions.find((item) => item.id === activeSessionId);
                  openSession(current ?? {
                    id: activeSessionId,
                    title: "当前会话",
                    messages: [],
                    createdAt: "",
                    updatedAt: "",
                  });
                }}
              >
                <MessageSquareText />
                Current
              </Button>
            ) : null}
            <Button size="sm" type="button" variant="outline" disabled={isSessionLoading} onClick={() => loadSessionPage(sessionPage)}>
              {isSessionLoading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Refresh
            </Button>
          </form>
        )}
      </div>

      {!tracingEnabled ? (
        <div className="mx-3 mt-3 flex flex-col gap-2 rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300 md:flex-row md:items-center md:justify-between">
          <span>调用追踪未开启，新的 Agent 会话不会写入 trace。开启并保存配置后，请重新发起一次对话。</span>
          <Button size="sm" variant="outline" onClick={onOpenConfig}>
            <Settings2 />
            Open Config
          </Button>
        </div>
      ) : null}

      {!selectedSession ? (
        <div className="panel-body flex min-h-0 flex-1 flex-col gap-3 lg:overflow-hidden">
          {sessionError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {sessionError}
            </div>
          ) : null}
          <div className="min-h-0 flex-1 rounded-md border border-border/80 bg-background/35 p-1.5 lg:overflow-y-auto">
            {isSessionLoading ? (
              <div className="grid place-items-center py-14 text-sm text-muted-foreground">
                <Loader2 className="mb-2 size-5 animate-spin text-primary" />
                加载会话...
              </div>
            ) : null}
            {!isSessionLoading && sessions.length === 0 ? (
              <div className="rounded-md border border-dashed border-border/80 px-3 py-10 text-center text-sm text-muted-foreground">
                暂无会话。
              </div>
            ) : null}
            <div className="space-y-1.5">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => openSession(session)}
                  className="block w-full min-w-0 rounded-md border border-border/80 bg-muted/15 px-2.5 py-2 text-left transition-colors hover:border-primary/45 hover:bg-primary/5"
                >
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold">{session.title}</span>
                    {session.id === activeSessionId ? <Badge variant="outline" className="h-5 px-1.5 text-[10px]">Current</Badge> : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] leading-4 text-muted-foreground">
                    <span>{formatDateTime(session.updatedAt)}</span>
                    <span>{session.messageCount ?? session.messages.length} messages</span>
                    <span className="truncate">{session.id}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2 rounded-md border border-border/80 bg-background/35 px-3 py-2 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
            <span>{pageStart}-{pageEnd} / {sessionTotal}</span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={sessionPage <= 1 || isSessionLoading}
                onClick={() => setSessionPage((page) => Math.max(1, page - 1))}
              >
                <ChevronRight className="rotate-180" />
                Prev
              </Button>
              <Badge variant="outline">{sessionPage} / {pageCount}</Badge>
              <Button
                size="sm"
                variant="outline"
                disabled={sessionPage >= pageCount || isSessionLoading}
                onClick={() => setSessionPage((page) => Math.min(pageCount, page + 1))}
              >
                Next
                <ChevronRight />
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="panel-body grid min-h-0 flex-1 gap-3 lg:overflow-y-auto xl:grid-cols-[280px_minmax(0,1fr)] xl:overflow-hidden">
          <div className="min-h-0 rounded-md border border-border/80 bg-background/35 p-1.5 lg:overflow-y-auto">
            <div className="mb-2 flex items-center justify-between px-1">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{selectedSession.title}</p>
                <p className="truncate text-xs text-muted-foreground">{selectedSession.id}</p>
              </div>
              <Badge variant="outline">{traceData?.total ?? 0}</Badge>
            </div>
            {traceError ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {traceError}
              </div>
            ) : null}
            {!traceError && isLoading ? (
              <div className="grid place-items-center py-10 text-sm text-muted-foreground">
                <Loader2 className="mb-2 size-5 animate-spin text-primary" />
                加载调用链...
              </div>
            ) : null}
            {!traceError && !isLoading && traceData && traceData.runs.length === 0 ? (
              <div className="rounded-md border border-dashed border-border/80 px-3 py-8 text-center text-sm text-muted-foreground">
                当前 session 暂无 trace。请确认已开启调用追踪并发起新的对话。
              </div>
            ) : null}
            <div className="space-y-1.5">
              {traceData?.runs.map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => {
                  setSelectedRunId(run.id);
                  setExpandedEventId(null);
                }}
                className={cn(
                  "block w-full rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors",
                  selectedRun?.id === run.id
                    ? "border-primary/60 bg-primary/10 text-foreground"
                    : "border-border/80 bg-muted/20 text-muted-foreground hover:border-primary/40 hover:text-foreground",
                )}
              >
                <div className="mb-0.5 flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{formatDateTime(run.started_at)}</span>
                  <Badge variant={statusTone(run.status)} className="h-5 px-1.5 text-[10px]">{run.status}</Badge>
                </div>
                <div className="flex items-center justify-between gap-2 text-[10px]">
                  <span>{run.events.length} nodes</span>
                  <span>{formatDurationMs(run.duration_ms)}</span>
                </div>
                {run.final_response_preview ? (
                  <p className="mt-1 line-clamp-1 text-[11px] leading-4">{run.final_response_preview}</p>
                ) : null}
              </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 rounded-md border border-border/80 bg-background/35 p-3 lg:overflow-y-auto">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">Timeline</p>
                <p className="truncate text-xs text-muted-foreground">{selectedRun?.id ?? "未选择 run"}</p>
              </div>
              {selectedRun ? <Badge variant={statusTone(selectedRun.status)}>{selectedRun.status}</Badge> : null}
            </div>
            {selectedRun ? (
              <TraceTimeline
                events={selectedRun.events}
                expandedEventId={expandedEventId}
                onToggleEvent={(eventId) => setExpandedEventId((current) => (current === eventId ? null : eventId))}
              />
            ) : (
              <div className="rounded-md border border-dashed border-border/80 px-3 py-8 text-center text-sm text-muted-foreground">
                选择一个 run 后查看 timeline。
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function TraceTimeline({
  events,
  expandedEventId,
  onToggleEvent,
}: {
  events: AgentTraceEvent[];
  expandedEventId: string | null;
  onToggleEvent: (eventId: string) => void;
}) {
  if (!events.length) {
    return (
      <div className="rounded-md border border-dashed border-border/80 px-3 py-8 text-center text-sm text-muted-foreground">
        暂无 timeline 节点。
      </div>
    );
  }

  const laneDepthFor = (event: AgentTraceEvent) => {
    if (event.node_type === "subagent_batch") return 0;
    if (event.node_type.startsWith("subagent")) return 1;
    return 0;
  };

  return (
    <div className="space-y-0">
      {events.map((event, index) => {
        const expanded = expandedEventId === event.id;
        const depth = laneDepthFor(event);
        return (
          <div
            className="grid grid-cols-[32px_minmax(0,1fr)] gap-3"
            key={event.id}
            style={{ marginLeft: depth ? `${Math.min(depth, 6) * 18}px` : undefined }}
          >
            <div className="relative flex justify-center">
              {index < events.length - 1 ? (
                <span className="absolute top-8 bottom-0 w-px bg-border" />
              ) : null}
              <span className={cn(
                "relative z-10 mt-1 grid size-7 place-items-center rounded-full border bg-background",
                expanded ? "border-primary/70 text-primary" : "border-border text-muted-foreground",
              )}>
                <TraceStatusIcon status={event.status} />
              </span>
            </div>
            <div className="pb-3">
              <button
                type="button"
                onClick={() => onToggleEvent(event.id)}
                className={cn(
                  "w-full rounded-md border px-3 py-2 text-left transition-colors",
                  expanded
                    ? "border-primary/60 bg-primary/10"
                    : "border-border/75 bg-muted/15 hover:border-primary/40",
                )}
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold">{event.title}</span>
                  <Badge variant="outline">{event.node_type}</Badge>
                  <Badge variant={statusTone(event.status)}>{event.status}</Badge>
                  <span className="text-xs text-muted-foreground">{formatDurationMs(event.duration_ms)}</span>
                </div>
                <div className="mt-1 flex min-w-0 items-center justify-between gap-3">
                  <span className="truncate text-xs text-muted-foreground">{event.summary || formatDateTime(event.started_at)}</span>
                  <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", expanded ? "rotate-180" : "")} />
                </div>
              </button>
              {expanded ? <TraceNodeDetail event={event} /> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TraceNodeDetail({ event }: { event: AgentTraceEvent }) {
  return (
    <div className="mt-2 rounded-md border border-border/75 bg-background/55 p-3">
      <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
        <span>Seq {event.seq}</span>
        <span>{formatDateTime(event.started_at)} · {formatDurationMs(event.duration_ms)}</span>
        <span className="truncate">Event {event.id}</span>
        <span className="truncate">Parent {event.parent_id ?? "-"}</span>
      </div>
      <TracePayloadViewer value={event.payload} />
    </div>
  );
}

function TracePayloadViewer({ value }: { value: unknown }) {
  const parsed = typeof value === "string" ? parseJsonContainerString(value) : null;
  const displayValue = parsed ?? value;
  if (!isJsonContainer(displayValue)) {
    return (
      <pre className="mt-3 max-h-[360px] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
        {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
      </pre>
    );
  }

  return (
    <div className="mt-3 max-h-[420px] overflow-auto rounded-md border border-border/60 bg-muted/20 p-2 font-mono text-xs leading-5">
      <JsonTreeNode value={displayValue} defaultExpanded />
    </div>
  );
}

function JsonTreeNode({
  value,
  name,
  depth = 0,
  defaultExpanded = false,
}: {
  value: unknown;
  name?: string;
  depth?: number;
  defaultExpanded?: boolean;
}) {
  const parsedString = typeof value === "string" ? parseJsonContainerString(value) : null;
  const displayValue = parsedString ?? value;
  const [expanded, setExpanded] = useState(defaultExpanded || depth < 2);

  if (isJsonContainer(displayValue)) {
    const isArray = Array.isArray(displayValue);
    const entries = isArray
      ? displayValue.map((item, index) => [`[${index}]`, item] as const)
      : Object.entries(displayValue);
    const openMark = isArray ? "[" : "{";
    const closeMark = isArray ? "]" : "}";
    const typeLabel = isArray ? `Array(${entries.length})` : `Object(${entries.length})`;

    return (
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="grid size-5 shrink-0 place-items-center rounded border border-transparent text-muted-foreground hover:border-border hover:bg-background/70 hover:text-foreground"
            aria-label={expanded ? "Collapse JSON node" : "Expand JSON node"}
            title={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
          {name ? <span className="shrink-0 text-primary">{name}:</span> : null}
          <span className="shrink-0 text-muted-foreground">{expanded ? openMark : typeLabel}</span>
          {parsedString ? <Badge variant="outline" className="h-5 px-1.5 text-[10px]">JSON</Badge> : null}
          {!expanded ? (
            <span className="min-w-0 truncate text-muted-foreground">{jsonPreview(displayValue)}</span>
          ) : null}
        </div>
        {expanded ? (
          <div className="ml-2.5 border-l border-border/70 pl-3">
            {entries.length === 0 ? (
              <div className="text-muted-foreground">{openMark}{closeMark}</div>
            ) : (
              entries.map(([entryName, entryValue]) => (
                <JsonTreeNode
                  key={`${entryName}-${typeof entryValue}`}
                  name={entryName}
                  value={entryValue}
                  depth={depth + 1}
                />
              ))
            )}
            <div className="text-muted-foreground">{closeMark}</div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-start gap-2 pl-5">
      {name ? <span className="shrink-0 text-primary">{name}:</span> : null}
      <span className={cn("min-w-0 whitespace-pre-wrap break-words", primitiveTone(displayValue))}>
        {formatPrimitive(displayValue)}
      </span>
    </div>
  );
}
