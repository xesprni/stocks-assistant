import { PageFallback } from "@/components/shell/PageFallback";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { useFluidSheet } from "@/hooks/useFluidSheet";
import type { AppLanguage } from "@/i18n";
import { getMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  MessageSquareText,
  Search
} from "lucide-react";
import type { ReactNode } from "react";
import { Suspense, useLayoutEffect } from "react";

export function DashboardMobileChatDock({
  chatPanel,
  fullscreen,
  isOpen,
  language,
  onOpenChange,
  onFullscreenChange,
}: {
  chatPanel: (onClose: () => void) => ReactNode;
  fullscreen: boolean;
  isOpen: boolean;
  language: AppLanguage;
  onOpenChange: (open: boolean) => void;
  onFullscreenChange: (fullscreen: boolean) => void;
}) {
  const mobileChatLabel = getMessages(language).shell.mobileChatLabel;

  function finishClose() {
    onFullscreenChange(false);
    onOpenChange(false);
  }
  const { dragHandleProps, layerRef, panelRef, present: drawerPresent, requestClose } = useFluidSheet<HTMLElement>({
    axis: "y",
    onDismiss: finishClose,
    open: isOpen,
  });
  useDialogFocus(isOpen, panelRef, requestClose);

  useLayoutEffect(() => {
    if (!drawerPresent) return;
    const viewport = window.visualViewport;
    const updateViewport = () => {
      const layer = layerRef.current;
      if (!layer) return;
      // iOS 软键盘只缩小 visualViewport；抽屉必须跟随可视区，不能依赖 100dvh。
      const height = viewport?.height ?? window.innerHeight;
      layer.style.top = `${viewport?.offsetTop ?? 0}px`;
      layer.style.height = `${height}px`;
      layer.style.setProperty("--chat-viewport-height", `${height}px`);
      layer.dataset.compact = String(height <= 560);
    };
    updateViewport();
    viewport?.addEventListener("resize", updateViewport);
    viewport?.addEventListener("scroll", updateViewport);
    window.addEventListener("resize", updateViewport);
    return () => {
      viewport?.removeEventListener("resize", updateViewport);
      viewport?.removeEventListener("scroll", updateViewport);
      window.removeEventListener("resize", updateViewport);
    };
  }, [drawerPresent, layerRef]);

  return (
    <>
      {!drawerPresent ? (
        <div className="dashboard-chat-searchbar fixed inset-x-0 bottom-0 z-[920] px-3 pb-[calc(0.85rem+env(safe-area-inset-bottom))] pt-3 xl:hidden">
          <button
            aria-label={mobileChatLabel}
            className="flex h-14 w-full items-center gap-3 rounded-[2rem] border border-border/75 bg-card px-4 text-left text-base font-semibold text-muted-foreground shadow-[0_-10px_30px_hsl(var(--background)_/_0.75),0_14px_34px_hsl(var(--foreground)_/_0.13)] transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            onClick={() => onOpenChange(true)}
            title={mobileChatLabel}
            type="button"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground">
              <Search className="size-4" />
            </span>
            <span className="min-w-0 flex-1 truncate">{mobileChatLabel}</span>
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted/55 text-muted-foreground">
              <MessageSquareText className="size-4" />
            </span>
          </button>
        </div>
      ) : null}
      {drawerPresent ? (
        <div
          className={cn("dashboard-chat-drawer-layer fluid-sheet-layer fixed inset-0 xl:hidden", fullscreen ? "z-[980]" : "z-[950]")}
          ref={layerRef}
        >
          <div
            aria-hidden="true"
            className="fluid-sheet-backdrop absolute inset-0"
            onClick={requestClose}
          />
          <aside
            aria-label={mobileChatLabel}
            aria-modal="true"
            className={cn(
              "dashboard-chat-drawer fluid-sheet-panel apple-material-thick absolute inset-x-0 bottom-0 flex flex-col overflow-hidden border border-border/60 shadow-2xl",
              fullscreen
                ? "h-full rounded-none border-x-0 border-b-0 pt-[env(safe-area-inset-top)]"
                : "h-[min(86%,46rem)] rounded-t-[1.5rem]",
            )}
            ref={panelRef}
            role="dialog"
            tabIndex={-1}
          >
            <div
              aria-hidden="true"
              className="dashboard-chat-grabber sheet-drag-handle flex h-4 shrink-0 touch-none items-center justify-center"
              {...dragHandleProps}
            >
              <span className="h-1 w-10 rounded-full bg-muted-foreground/35" />
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <Suspense fallback={<PageFallback />}>{chatPanel(requestClose)}</Suspense>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
