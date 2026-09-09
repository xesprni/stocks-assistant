import type { AppConfig, ConfigDraft } from "@/types/app";

export type ConfigSaveState = "idle" | "pending" | "saving" | "saved" | "error";

type Options = {
  persist: (source: ConfigDraft, patch: Partial<ConfigDraft>) => Promise<AppConfig | null>;
  toDraft: (config: AppConfig) => ConfigDraft;
  onDraft: (draft: ConfigDraft) => void;
  onSaved: (config: AppConfig) => void;
  onState: (state: ConfigSaveState) => void;
  onError: (error: unknown) => void;
  canSave?: () => boolean;
};

const IMMEDIATE_KEYS = new Set([
  "llm_provider", "llm_auth_mode", "embedding_auth_mode", "longbridge_auth_mode",
  "llm_reasoning_effort", "llm_tool_choice", "app_language", "agent_tool_allowlist",
]);

export function configAutosaveDelay(patch: Partial<ConfigDraft>): number {
  const keys = Object.keys(patch);
  if (keys.some((key) => key === "system_prompt" || key === "mcp_servers_text")) return 1200;
  if (keys.some((key) => IMMEDIATE_KEYS.has(key) || typeof patch[key as keyof ConfigDraft] === "boolean")) return 0;
  return 800;
}

const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

// 保存队列独立于页面挂载，切换页面不会丢掉待保存内容；同一时间只发送一个请求。
export function createConfigAutosave(options: Options) {
  let saved: AppConfig | null = null;
  let draft: ConfigDraft | null = null;
  let pending: Partial<ConfigDraft> = {};
  let sending: Partial<ConfigDraft> = {};
  let externalUpdates: Partial<AppConfig> = {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | null = null;
  let requested = false;
  let composing = false;
  let disposed = false;

  const hasPending = () => Object.keys(pending).length > 0;
  const isDirty = () => hasPending() || inFlight !== null;
  const cancelTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  function schedule(delay: number) {
    cancelTimer();
    requested = false;
    if (!hasPending() || composing || disposed) return;
    options.onState(inFlight ? "saving" : "pending");
    if (delay === 0) void flush();
    else timer = setTimeout(() => { timer = undefined; void flush(); }, delay);
  }

  function patch(values: Partial<ConfigDraft>) {
    if (!draft || disposed) return;
    const changes = Object.fromEntries(Object.entries(values).filter(([key, value]) => !equal(draft?.[key as keyof ConfigDraft], value)));
    if (Object.keys(changes).length === 0) return;
    draft = { ...draft, ...changes };
    pending = { ...pending, ...changes };
    // 无请求在途时，改回已保存值应直接取消该字段，而不是再写一遍。
    if (saved && !inFlight) {
      const baseline = options.toDraft(saved);
      for (const key of Object.keys(pending) as Array<keyof ConfigDraft>) {
        if (equal(pending[key], baseline[key])) delete pending[key];
      }
    }
    options.onDraft(draft);
    if (!hasPending()) { cancelTimer(); options.onState(inFlight ? "saving" : "idle"); return; }
    schedule(configAutosaveDelay(changes));
  }

  async function run() {
    if (disposed || !draft || !hasPending()) return;
    const source = draft;
    const submitted = pending;
    sending = { ...submitted };
    pending = {};
    externalUpdates = {};
    requested = false;
    options.onState("saving");
    try {
      const result = await options.persist(source, submitted);
      if (disposed) return;
      if (result) saved = { ...result, ...externalUpdates };
      if (saved) {
        // 已保存的密钥由 toDraft 清空，但在请求期间继续输入的新密钥必须保留。
        draft = { ...options.toDraft(saved), ...pending };
        options.onSaved(saved);
        options.onDraft(draft);
      }
      options.onState(hasPending() ? "pending" : "saved");
    } catch (error) {
      if (disposed) return;
      pending = { ...submitted, ...pending };
      // 外部授权已确认的值不能被失败请求中的旧认证方式重新排队。
      for (const key of Object.keys(externalUpdates) as Array<keyof AppConfig>) {
        if (key in pending && equal(pending[key], submitted[key])) delete pending[key];
      }
      cancelTimer();
      requested = false;
      options.onState("error");
      options.onError(error);
    }
  }

  function flush(): Promise<void> {
    cancelTimer();
    if (disposed || !draft) return Promise.resolve();
    requested = true;
    if (inFlight) return inFlight;
    if (!hasPending() || composing || options.canSave?.() === false) return Promise.resolve();
    // 先设置 promise，再开始 persist，避免同步回调重入导致并行提交。
    inFlight = Promise.resolve().then(run).finally(() => {
      inFlight = null;
      sending = {};
      if (!disposed && requested && hasPending()) return flush();
    });
    return inFlight;
  }

  function acceptSaved(next: AppConfig) {
    if (disposed) return;
    if (inFlight && saved) {
      externalUpdates = { ...externalUpdates, ...Object.fromEntries(Object.entries(next).filter(([key, value]) => !equal(saved?.[key as keyof AppConfig], value))) };
    }
    saved = next;
    draft = { ...options.toDraft(next), ...sending, ...pending };
    options.onSaved(next);
    options.onDraft(draft);
  }

  function acceptSavedPatch(values: Partial<AppConfig>, discardKeys: Array<keyof ConfigDraft> = []) {
    if (!saved || disposed) return;
    for (const key of discardKeys) {
      delete pending[key];
      // 若旧认证方式已经发出，随后补写已确认的授权方式，保证服务端也保持一致。
      if (key in sending && !equal(sending[key], values[key as keyof AppConfig])) {
        pending = { ...pending, [key]: values[key as keyof AppConfig] };
      }
      delete sending[key];
    }
    acceptSaved({ ...saved, ...values });
    if (inFlight) {
      // 授权确认即便与旧基线相同，也必须压过在途响应里的旧认证方式。
      for (const key of discardKeys) {
        if (key in values) externalUpdates = { ...externalUpdates, [key]: values[key as keyof AppConfig] };
      }
    }
    if (hasPending()) schedule(configAutosaveDelay(pending));
    else if (!inFlight) { cancelTimer(); options.onState("idle"); }
  }

  function reset() {
    if (!saved || inFlight || disposed) return;
    cancelTimer();
    pending = {};
    requested = false;
    draft = options.toDraft(saved);
    options.onDraft(draft);
    options.onState("idle");
  }

  return {
    patch,
    flush,
    reset,
    acceptSaved,
    acceptSavedPatch,
    isDirty,
    compositionStart() { composing = true; cancelTimer(); },
    compositionEnd() { composing = false; schedule(configAutosaveDelay(pending)); },
    dispose() { disposed = true; cancelTimer(); },
  };
}
