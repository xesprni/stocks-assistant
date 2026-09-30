import { cn } from "@/lib/utils";

export function ChartHoverCard({
  metrics,
  title,
}: {
  metrics: Array<{ label: string; tone?: "up" | "down" | "flat"; value: string }>;
  title: string;
}) {
  return (
    <div className="rounded-md border border-border/80 bg-popover/95 px-3 py-2 text-xs text-popover-foreground shadow-lg shadow-foreground/10 backdrop-blur">
      <div className="mb-1.5 font-mono text-[11px] font-semibold text-muted-foreground">{title}</div>
      <div className="grid gap-1.5">
        {metrics.map((metric) => (
          <div className="grid grid-cols-[auto_minmax(5rem,1fr)] items-center gap-3" key={metric.label}>
            <span className="text-[10px] text-muted-foreground">{metric.label}</span>
            <span
              className={cn(
                "text-right font-mono font-semibold tabular-nums text-foreground",
                metric.tone === "up" && "text-[var(--color-up)]",
                metric.tone === "down" && "text-[var(--color-down)]",
              )}
            >
              {metric.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
