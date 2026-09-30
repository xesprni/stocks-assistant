import { cn } from "@/lib/utils";

export function QuoteMetric({ label, tone, value }: { label: string; tone?: "up" | "down" | "flat"; value: string }) {
  return (
    <div className="rounded-md bg-muted/20 px-2 py-1.5">
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 truncate font-semibold",
          tone === "up" && "text-[var(--color-up)]",
          tone === "down" && "text-[var(--color-down)]",
        )}
      >
        {value}
      </p>
    </div>
  );
}
