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
    <label className="apple-pressable flex min-h-11 items-center justify-between gap-3 rounded-[0.75rem] border border-border/70 bg-[var(--control-bg)] px-3 py-2 text-sm shadow-[var(--control-shadow)] transition-[background-color,border-color,box-shadow,transform] hover:border-primary/35 hover:bg-[var(--control-hover-bg)] focus-within:border-primary/55 focus-within:ring-4 focus-within:ring-primary/15">
      <span className="flex min-w-0 items-center gap-2">
        {icon}
        <span className="truncate text-sm font-medium">{label}</span>
      </span>
      <Switch checked={Boolean(checked)} onCheckedChange={onCheckedChange} />
    </label>
  );
}
