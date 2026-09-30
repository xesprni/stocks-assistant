import type { ChatTraceEvent } from "@/types/app";
import {
  Check,
  CircleDot,
  Loader2,
  X
} from "lucide-react";

export function TraceIcon({ status }: { status: ChatTraceEvent["status"] }) {
  if (status === "running") return <Loader2 className="size-3 animate-spin text-primary" />;
  if (status === "done") return <Check className="size-3 text-emerald-500" />;
  if (status === "error") return <X className="size-3 text-destructive" />;
  return <CircleDot className="size-3 text-muted-foreground" />;
}

export function ChatTraceList({ trace }: { trace?: ChatTraceEvent[] }) {
  if (!trace?.length) return null;

  return (
    <div className="mb-3 space-y-1 rounded-md border border-border/80 bg-background/70 px-2.5 py-2 text-xs text-muted-foreground shadow-sm">
      {trace.map((item) => (
        <div className="flex min-w-0 items-start gap-2" key={item.id}>
          <span className="mt-1 shrink-0">
            <TraceIcon status={item.status} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-medium text-foreground/85">{item.label}</span>
              <span className="text-[10px] text-muted-foreground/80">{item.createdAt}</span>
            </div>
            {item.detail ? <p className="mt-0.5 break-words text-[11px] leading-4">{item.detail}</p> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
