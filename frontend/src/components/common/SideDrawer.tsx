import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Loader2, Save, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SideDrawer({
  cancelText,
  children,
  closeLabel = "Close drawer",
  footer,
  formId,
  isSaving = false,
  onClose,
  open,
  panelClassName,
  saveDisabled = false,
  saveText,
  subtitle,
  title,
}: {
  cancelText?: string;
  children: ReactNode;
  closeLabel?: string;
  footer?: ReactNode;
  formId?: string;
  isSaving?: boolean;
  onClose: () => void;
  open: boolean;
  panelClassName?: string;
  saveDisabled?: boolean;
  saveText?: string;
  subtitle?: string;
  title: string;
}) {
  if (!open || typeof document === "undefined") return null;

  const defaultFooter = formId && cancelText && saveText ? (
    <>
      <Button variant="outline" size="sm" type="button" className="w-20" onClick={onClose}>
        {cancelText}
      </Button>
      <Button form={formId} size="sm" type="submit" className="w-20" disabled={isSaving || saveDisabled}>
        {isSaving ? <Loader2 className="animate-spin" /> : <Save />}
        {saveText}
      </Button>
    </>
  ) : null;
  const resolvedFooter = footer ?? defaultFooter;

  const drawer = (
    <div className="fixed inset-0 z-[1100]">
      <button
        aria-label={closeLabel}
        className="absolute inset-0 bg-background/55 backdrop-blur-[2px]"
        onClick={onClose}
        type="button"
      />
      <aside className={cn(
        "absolute inset-x-0 bottom-0 flex max-h-[86dvh] w-full flex-col overflow-hidden rounded-t-xl border-t border-border bg-card shadow-2xl lg:inset-x-auto lg:right-0 lg:top-0 lg:h-[100dvh] lg:max-h-none lg:max-w-[520px] lg:rounded-none lg:border-l lg:border-t-0",
        panelClassName,
      )}>
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border/80 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{title}</p>
            {subtitle ? <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p> : null}
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 [-webkit-overflow-scrolling:touch]">{children}</div>
        {resolvedFooter ? <div className="flex shrink-0 justify-end gap-2 border-t border-border/80 bg-background/80 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">{resolvedFooter}</div> : null}
      </aside>
    </div>
  );

  return createPortal(drawer, document.body);
}
