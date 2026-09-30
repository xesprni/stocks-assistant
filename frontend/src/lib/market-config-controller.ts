import type { ConfigSaveState } from "@/lib/config-autosave";
import type { MarketDashboardConfig } from "@/types/app";

export const MARKET_REFRESH_MIN = 1;
export const MARKET_REFRESH_MAX = 3600;
const MARKET_CONFIG_SAVE_DELAY_MS = 800;

export interface MarketConfigEditor {
  config: MarketDashboardConfig | null;
  saveState: ConfigSaveState;
  onPatch: (patch: Partial<MarketDashboardConfig>) => void;
  onSave: () => void;
}

interface Options {
  persist: (config: MarketDashboardConfig) => Promise<MarketDashboardConfig>;
  onDraft: (config: MarketDashboardConfig) => void;
  onSaved: (config: MarketDashboardConfig) => void;
  onState: (state: ConfigSaveState) => void;
  onSuccess: () => void;
  onError: (error: unknown) => void;
}

const equal = (a: MarketDashboardConfig | null, b: MarketDashboardConfig | null) =>
  JSON.stringify(a) === JSON.stringify(b);

// 生命周期由应用持有；离开行情页不会取消待保存内容或丢弃失败后的草稿。
export function createMarketConfigController(options: Options) {
  let saved: MarketDashboardConfig | null = null;
  let draft: MarketDashboardConfig | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | null = null;
  let requested = false;
  let disposed = false;
  const isDirty = () => inFlight !== null || !equal(draft, saved);
  const cancelTimer = () => { clearTimeout(timer); timer = undefined; };

  function acceptSaved(config: MarketDashboardConfig) {
    if (disposed) return;
    saved = draft = config;
    options.onSaved(config);
    options.onDraft(config);
  }

  function patch(values: Partial<MarketDashboardConfig>) {
    if (!draft || disposed) return;
    const next = { ...draft, ...values };
    if (equal(next, draft)) return;
    draft = next;
    options.onDraft(next);
    cancelTimer();
    requested = false;
    options.onState(inFlight ? "saving" : isDirty() ? "pending" : "idle");
    if (!isDirty()) return;
    if (values.indices !== undefined) void flush();
    else timer = setTimeout(() => { timer = undefined; void flush(); }, MARKET_CONFIG_SAVE_DELAY_MS);
  }

  function flush(): Promise<void> {
    cancelTimer();
    if (disposed) return Promise.resolve();
    requested = true;
    if (inFlight) return inFlight;
    if (!draft || equal(draft, saved) || !Number.isInteger(draft.refresh_interval)
      || draft.refresh_interval < MARKET_REFRESH_MIN || draft.refresh_interval > MARKET_REFRESH_MAX) {
      return Promise.resolve();
    }
    const submitted = draft;
    requested = false;
    inFlight = Promise.resolve().then(async () => {
      if (disposed) return;
      options.onState("saving");
      try {
        const result = await options.persist(submitted);
        if (disposed) return;
        saved = result;
        // 在途响应只替换未被继续编辑的草稿，后续修改按顺序补写。
        if (equal(draft, submitted)) {
          draft = result;
          options.onDraft(result);
        }
        options.onSaved(result);
        options.onState(equal(draft, saved) ? "saved" : "pending");
        options.onSuccess();
      } catch (error) {
        if (disposed) return;
        requested = false;
        cancelTimer();
        options.onState("error");
        options.onError(error);
      }
    }).finally(() => {
      inFlight = null;
      if (!disposed && requested) return flush();
    });
    return inFlight;
  }

  return {
    acceptSaved, patch, flush, isDirty,
    reset() {
      if (!saved || inFlight || disposed) return;
      cancelTimer();
      requested = false;
      draft = saved;
      options.onDraft(saved);
      options.onState("idle");
    },
    dispose() { disposed = true; cancelTimer(); },
  };
}
