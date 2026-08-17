import { useEffect, useRef } from "react";
import type { RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

type DialogStackEntry = {
  focusInside: () => void;
};

const dialogStack: DialogStackEntry[] = [];

function removeFromStack(entry: DialogStackEntry) {
  const index = dialogStack.indexOf(entry);
  if (index >= 0) dialogStack.splice(index, 1);
}

function isTopmost(entry: DialogStackEntry) {
  return dialogStack[dialogStack.length - 1] === entry;
}

function isVisibleFocusable(element: HTMLElement) {
  return (
    !element.hidden
    && !element.matches(":disabled")
    && element.getAttribute("aria-disabled") !== "true"
    && !element.closest("[aria-hidden='true'], [inert]")
    && element.getClientRects().length > 0
    && window.getComputedStyle(element).visibility !== "hidden"
  );
}

function focusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisibleFocusable);
}

function hasOpenListbox(container: HTMLElement, eventTarget: EventTarget | null) {
  const target = eventTarget instanceof Element ? eventTarget : null;
  const targetListbox = target?.closest("[role='listbox']");
  if (
    targetListbox
    && container.contains(targetListbox)
    && targetListbox.getAttribute("aria-hidden") !== "true"
    && targetListbox.getAttribute("data-state") !== "closed"
  ) return true;
  return Boolean(container.querySelector(
    "[aria-haspopup='listbox'][aria-expanded='true'], [role='listbox']:not([aria-hidden='true']):not([data-state='closed'])",
  ));
}

function canRestoreFocus(element: HTMLElement | null) {
  return Boolean(
    element?.isConnected
    && element !== document.body
    && element !== document.documentElement
    && isVisibleFocusable(element)
  );
}

/** 统一处理模态层的初始焦点、Escape、Tab 圈定与关闭后的焦点恢复。 */
export function useDialogFocus(
  open: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onEscape: () => void,
  initialFocusRef?: RefObject<HTMLElement | null>,
) {
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusInside = () => {
      const container = containerRef.current;
      if (!container) return;
      const preferred = initialFocusRef?.current;
      const target = preferred && isVisibleFocusable(preferred)
        ? preferred
        : focusableElements(container)[0] ?? container;
      target.focus({ preventScroll: true });
    };
    const entry: DialogStackEntry = { focusInside };
    dialogStack.push(entry);
    const frame = window.requestAnimationFrame(focusInside);

    function handleFocusIn(event: FocusEvent) {
      if (!isTopmost(entry)) return;
      const container = containerRef.current;
      const target = event.target;
      if (!container || !(target instanceof Node) || container.contains(target)) return;
      focusInside();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (!isTopmost(entry) || event.defaultPrevented || event.isComposing) return;
      const container = containerRef.current;
      if (!container) return;
      if (event.key === "Escape") {
        // 先让弹层内部的组合控件（如 Select listbox）消费 Escape。
        if (hasOpenListbox(container, event.target)) return;
        event.preventDefault();
        onEscapeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableElements(container);
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (!container.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("keydown", handleKeyDown);
      const wasTopmost = isTopmost(entry);
      removeFromStack(entry);
      const previousFocus = previousFocusRef.current;
      previousFocusRef.current = null;
      if (!wasTopmost) return;
      if (canRestoreFocus(previousFocus)) {
        previousFocus?.focus({ preventScroll: true });
      } else {
        dialogStack[dialogStack.length - 1]?.focusInside();
      }
    };
  }, [containerRef, initialFocusRef, open]);
}
