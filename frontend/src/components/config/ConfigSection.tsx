import { cn } from "@/lib/utils";
import { type ReactNode } from "react";

export function ConfigSection({
  children,
  className,
  description,
  icon,
  title,
}: {
  children: ReactNode;
  className?: string;
  description?: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <section className={cn("config-section min-w-0 rounded-xl border border-border/70 bg-card/70", className)}>
      <div className="flex items-start gap-3 border-b border-border/50 px-4 py-4 sm:px-6">
        <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted/60">{icon}</div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-6">{title}</h3>
          {description ? <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      <div className="p-4 sm:p-6">{children}</div>
    </section>
  );
}
