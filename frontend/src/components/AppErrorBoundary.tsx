import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
};

const AUTO_RELOAD_KEY = "stocks-assistant-error-boundary-auto-reload";
const AUTO_RELOAD_WINDOW_MS = 60_000;
const PRESERVED_STORAGE_KEYS = new Set([
  "stocks_assistant_access_token",
  "stocks_assistant_refresh_token",
  "stocks_assistant_device_id",
]);

function safeSessionGet(key: string) {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSessionSet(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // 恢复逻辑不能依赖 sessionStorage 一定可用。
  }
}

function isChunkLoadError(error: Error | null) {
  const message = error?.message ?? "";
  return /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError/i.test(message);
}

function recentlyAutoReloaded() {
  const timestamp = Number(safeSessionGet(AUTO_RELOAD_KEY) || 0);
  return Number.isFinite(timestamp) && Date.now() - timestamp < AUTO_RELOAD_WINDOW_MS;
}

function clearRecoverableClientState() {
  try {
    window.sessionStorage.clear();
  } catch {
    // 页面恢复失败时 sessionStorage 可能正是异常来源，忽略后继续处理 localStorage。
  }

  try {
    const keysToRemove: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || PRESERVED_STORAGE_KEYS.has(key)) continue;
      if (key.startsWith("stocks-assistant") || key.startsWith("stocks_assistant")) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // localStorage 不可访问时，刷新仍然是可用的恢复路径。
  }
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("App render failed", error, info);
    if (isChunkLoadError(error) && !recentlyAutoReloaded()) {
      safeSessionSet(AUTO_RELOAD_KEY, String(Date.now()));
      window.location.reload();
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    const message = this.state.error.message || "Unknown error";
    return (
      <div className="console-shell grid min-h-[100dvh] place-items-center bg-background p-4 text-foreground">
        <div className="w-full max-w-[460px] rounded-md border border-border bg-card p-5 shadow-sm">
          <p className="text-base font-semibold">页面加载失败</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            浏览器恢复、缓存失效或本地状态异常时可能出现空白页。可以先刷新；如果仍然失败，清理本地页面状态后重新进入。
          </p>
          <div className="mt-3 rounded-md bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
            {message}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground"
              onClick={() => window.location.reload()}
              type="button"
            >
              刷新页面
            </button>
            <button
              className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-background px-3 text-xs font-semibold"
              onClick={() => {
                clearRecoverableClientState();
                window.location.assign("/");
              }}
              type="button"
            >
              清理本地状态
            </button>
          </div>
        </div>
      </div>
    );
  }
}
