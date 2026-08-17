import { useEffect, useId, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { LayoutGrid, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Page } from "@/types/ui";

export type AppNavItem = {
  hint: string;
  href: string;
  icon: ReactNode;
  id: Page;
  label: string;
};

export type AppNavGroup = {
  id: string;
  items: AppNavItem[];
  label: string;
};

function followInternalNavigation(event: MouseEvent<HTMLAnchorElement>, item: AppNavItem, onNavigate: (page: Page) => void) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  onNavigate(item.id);
}

function NavigationItem({
  compact = false,
  currentPage,
  item,
  onNavigate,
}: {
  compact?: boolean;
  currentPage: Page | null;
  item: AppNavItem;
  onNavigate: (page: Page) => void;
}) {
  const active = item.id === currentPage;
  return (
    <a
      aria-current={active ? "page" : undefined}
      className={cn("app-navigation-item apple-pressable", compact && "app-navigation-item-compact")}
      data-active={active ? "true" : "false"}
      href={item.href}
      onClick={(event) => followInternalNavigation(event, item, onNavigate)}
    >
      <span className="app-navigation-icon" aria-hidden="true">{item.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.8125rem] font-semibold leading-5">{item.label}</span>
        {!compact ? <span className="block truncate text-[0.6875rem] leading-4 text-muted-foreground">{item.hint}</span> : null}
      </span>
    </a>
  );
}

export function AppNavigationPopover({
  closeLabel,
  currentPage,
  groups,
  label,
  onNavigate,
}: {
  closeLabel: string;
  currentPage: Page | null;
  groups: AppNavGroup[];
  label: string;
  onNavigate: (page: Page) => void;
}) {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current || !event.composedPath().includes(rootRef.current)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function navigate(page: Page) {
    setOpen(false);
    onNavigate(page);
  }

  return (
    <div className="relative" ref={rootRef}>
      <Button
        aria-controls={popoverId}
        aria-expanded={open}
        aria-label={open ? closeLabel : label}
        className="rounded-full"
        disabled={groups.length === 0}
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        size="icon"
        title={open ? closeLabel : label}
        type="button"
        variant="ghost"
      >
        {open ? <X /> : <LayoutGrid />}
      </Button>
      {open ? (
        <nav
          aria-label={label}
          className="app-navigation-popover apple-material-thick absolute left-0 top-[calc(100%+0.55rem)] z-[1000] max-h-[min(74dvh,42rem)] w-[min(25rem,calc(100vw-1rem))] overflow-y-auto rounded-[1.25rem] border border-border/60 p-2 shadow-2xl"
          id={popoverId}
        >
          <div className="space-y-3">
            {groups.map((group) => (
              <section aria-labelledby={`popover-nav-group-${group.id}`} key={group.id}>
                <h2 className="app-navigation-group-label px-2" id={`popover-nav-group-${group.id}`}>{group.label}</h2>
                <div className="mt-1 grid grid-cols-2 gap-1">
                  {group.items.map((item) => (
                    <NavigationItem compact currentPage={currentPage} item={item} key={item.id} onNavigate={navigate} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
