import type { ReactNode } from "react";

export function StatusTile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="metric-tile min-w-0">
      <div className="mb-2 flex items-center gap-2 text-muted-foreground">
        {icon}
        <p className="text-[11px]">{label}</p>
      </div>
      <p className="truncate text-sm font-semibold">{value}</p>
    </div>
  );
}
