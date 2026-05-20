import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function Field({ children, className, label }: { children: ReactNode; className?: string; label: string }) {
  return (
    <div className={cn("min-w-0 space-y-2", className)}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
