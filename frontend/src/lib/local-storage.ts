export function readStoredValue<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const value = window.localStorage.getItem(key) as T | null;
    return value && allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function writeStoredValue(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // localStorage 可能被隐私模式或浏览器策略禁用，忽略即可退回当前页面状态。
  }
}

export function readStoredText(key: string, fallback = "") {
  if (typeof window === "undefined") return fallback;
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function readStoredBoolean(key: string, fallback: boolean) {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(key);
    if (stored == null) return fallback;
    return stored === "true";
  } catch {
    return fallback;
  }
}

export function writeStoredBoolean(key: string, value: boolean) {
  writeStoredValue(key, String(value));
}
