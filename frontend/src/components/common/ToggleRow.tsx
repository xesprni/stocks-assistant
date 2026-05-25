import type { ReactNode } from "react";

import { Switch } from "@/components/ui/switch";

export function ToggleRow({
  checked,
  icon,
  label,
  onCheckedChange,
}: {
  checked?: boolean;
  icon: ReactNode;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border border-border/80 bg-background/60 px-3 py-2 text-sm shadow-sm transition-colors hover:border-primary/35 hover:bg-background/85">
      <span className="flex min-w-0 items-center gap-2">
        {icon}
        <span className="truncate text-sm font-medium">{label}</span>
      </span>
      <Switch checked={Boolean(checked)} onCheckedChange={onCheckedChange} />
    </label>
  );
}
