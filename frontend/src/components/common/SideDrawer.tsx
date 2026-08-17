import { useId, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Loader2, Save, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { useFluidSheet } from "@/hooks/useFluidSheet";
import { cn } from "@/lib/utils";

export function SideDrawer({
  cancelText,
  children,
  closeLabel,
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
  const titleId = useId();
  const subtitleId = useId();
  const resolvedCloseLabel = closeLabel
    ?? (typeof document !== "undefined" && document.documentElement.lang.startsWith("zh") ? "关闭抽屉" : "Close drawer");
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const { dragHandleProps, layerRef, panelRef, present, requestClose } = useFluidSheet<HTMLElement>({
    axis: "responsive",
    onDismiss: onClose,
    open,
  });
  useDialogFocus(open, panelRef, requestClose, closeButtonRef);

  const defaultFooter = formId && cancelText && saveText ? (
    <>
      <Button variant="outline" size="sm" type="button" className="min-w-20" onClick={requestClose}>
        {cancelText}
      </Button>
      <Button form={formId} size="sm" type="submit" className="min-w-20" disabled={isSaving || saveDisabled}>
        {isSaving ? <Loader2 className="animate-spin" /> : <Save />}
        {saveText}
      </Button>
    </>
  ) : null;
  const resolvedFooter = footer ?? defaultFooter;

  if (!present || typeof document === "undefined") return null;

  const drawer = (
    <div className="fluid-sheet-layer fixed inset-0 z-[1100]" ref={layerRef}>
      <div
        aria-hidden="true"
        className="fluid-sheet-backdrop absolute inset-0"
        onClick={requestClose}
      />
      <aside
        aria-describedby={subtitle ? subtitleId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className={cn(
          "fluid-sheet-panel apple-material-thick absolute inset-x-0 bottom-0 flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-[1.5rem] border-t border-border/60 shadow-2xl lg:inset-x-auto lg:right-0 lg:top-0 lg:h-[100dvh] lg:max-h-none lg:max-w-[520px] lg:rounded-none lg:border-l lg:border-t-0",
          panelClassName,
        )}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <div
          aria-hidden="true"
          className="sheet-drag-handle flex h-6 shrink-0 touch-none items-center justify-center lg:hidden"
          {...dragHandleProps}
        >
          <span className="h-1 w-10 rounded-full bg-muted-foreground/35" />
        </div>
        <div className="sheet-header flex shrink-0 items-start justify-between gap-3 px-5 pb-3 pt-2 lg:pt-4">
          <div className="min-w-0">
            <h2 className="truncate text-[1.05rem] font-semibold tracking-[-0.012em]" id={titleId}>{title}</h2>
            {subtitle ? <p className="mt-1 text-sm leading-5 text-muted-foreground" id={subtitleId}>{subtitle}</p> : null}
          </div>
          <Button
            aria-label={resolvedCloseLabel}
            className="shrink-0 rounded-full"
            onClick={requestClose}
            ref={closeButtonRef}
            size="icon"
            title={resolvedCloseLabel}
            type="button"
            variant="ghost"
          >
            <X className="size-4" />
          </Button>
        </div>
        <div className="sheet-scroll-edge min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-3 [-webkit-overflow-scrolling:touch]">{children}</div>
        {resolvedFooter ? (
          <div className="sheet-footer flex shrink-0 justify-end gap-2 px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3">
            {resolvedFooter}
          </div>
        ) : null}
      </aside>
    </div>
  );

  return createPortal(drawer, document.body);
}
