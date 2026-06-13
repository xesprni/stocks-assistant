import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";

import { cn } from "@/lib/utils";

type ToastKind = "success" | "error" | "info";
type ToastState = "open" | "closing";

type ToastItem = {
  id: number;
  kind: ToastKind;
  message: string;
  state: ToastState;
  title?: string;
};

type ToastInput = {
  duration?: number;
  kind?: ToastKind;
  message: string;
  title?: string;
};

type ToastContextValue = {
  dismissToast: (id: number) => void;
  showToast: (toast: ToastInput) => number;
};

const ToastContext = createContext<ToastContextValue | null>(null);

function toastDuration(kind: ToastKind, duration?: number) {
  if (typeof duration === "number") return duration;
  return kind === "success" ? 2200 : 4600;
}

function ToastIcon({ kind }: { kind: ToastKind }) {
  if (kind === "success") return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />;
  if (kind === "error") return <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />;
  return <Info className="mt-0.5 size-4 shrink-0 text-secondary" />;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef(new Map<number, number>());
  const exitTimersRef = useRef(new Map<number, number>());

  const clearTimer = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer) window.clearTimeout(timer);
    timersRef.current.delete(id);
  }, []);

  const clearExitTimer = useCallback((id: number) => {
    const timer = exitTimersRef.current.get(id);
    if (timer) window.clearTimeout(timer);
    exitTimersRef.current.delete(id);
  }, []);

  const dismissToast = useCallback((id: number) => {
    clearTimer(id);
    clearExitTimer(id);
    setToasts((current) => current.map((toast) => (toast.id === id ? { ...toast, state: "closing" } : toast)));
    const exitTimer = window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
      exitTimersRef.current.delete(id);
    }, 180);
    exitTimersRef.current.set(id, exitTimer);
  }, [clearExitTimer, clearTimer]);

  const showToast = useCallback((input: ToastInput) => {
    const kind = input.kind ?? "info";
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((current) => [
      ...current.slice(-2),
      {
        id,
        kind,
        message: input.message,
        state: "open",
        title: input.title,
      },
    ]);
    const timer = window.setTimeout(() => dismissToast(id), toastDuration(kind, input.duration));
    timersRef.current.set(id, timer);
    return id;
  }, [dismissToast]);

  useEffect(() => () => {
    for (const timer of timersRef.current.values()) window.clearTimeout(timer);
    for (const timer of exitTimersRef.current.values()) window.clearTimeout(timer);
  }, []);

  const value = useMemo(() => ({ dismissToast, showToast }), [dismissToast, showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[1300] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((toast) => (
          <div
            className={cn(
              "app-toast pointer-events-auto flex items-start gap-3 rounded-md border bg-popover px-3 py-3 text-sm text-popover-foreground shadow-lg",
              toast.kind === "success" && "border-primary/35",
              toast.kind === "error" && "border-destructive/45",
              toast.kind === "info" && "border-secondary/45",
            )}
            data-state={toast.state}
            key={toast.id}
            role={toast.kind === "error" ? "alert" : "status"}
          >
            <ToastIcon kind={toast.kind} />
            <div className="min-w-0 flex-1">
              {toast.title ? <p className="mb-0.5 font-semibold leading-5">{toast.title}</p> : null}
              <p className="break-words leading-5">{toast.message}</p>
            </div>
            <button
              aria-label="Close"
              className="rounded-sm p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
              onClick={() => dismissToast(toast.id)}
              type="button"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}

export function useErrorToast(message: string, title?: string) {
  const { showToast } = useToast();
  const lastMessageRef = useRef("");

  useEffect(() => {
    const text = message.trim();
    if (!text) {
      lastMessageRef.current = "";
      return;
    }
    if (lastMessageRef.current === text) return;
    lastMessageRef.current = text;
    showToast({ kind: "error", message: text, title });
  }, [message, showToast, title]);
}
