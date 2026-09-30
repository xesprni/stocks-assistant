import { AuthExpiredError, AuthSessionManager, waitWithSignal } from "@/lib/auth-session";
import { readStoredText, removeStoredValue, writeStoredValue } from "@/lib/local-storage";
import type {
  AuthTokenResponse
} from "@/types/app";

export const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export const ACCESS_TOKEN_KEY = "stocks_assistant_access_token";

export const REFRESH_TOKEN_KEY = "stocks_assistant_refresh_token";

export const DEVICE_ID_KEY = "stocks_assistant_device_id";

export const DEVICE_ID_HEADER = "X-Device-Id";

export const AUTH_EXPIRED_EVENT = "stocks-assistant:auth-expired";

export const AUTH_RETRY_EXCLUDED_PATHS = new Set([
  "/api/v1/auth/login",
  "/api/v1/auth/dev-login",
  "/api/v1/auth/logout",
  "/api/v1/auth/refresh",
  "/api/v1/auth/setup",
  "/api/v1/auth/setup/status",
]);

// GET 请求在途去重：同一 path 同时只保留一个请求，完成自动清除。
export const inflightGetRequests = new Map<string, Promise<unknown>>();

export const authSession = new AuthSessionManager({
  initial: { access_token: readStoredText(ACCESS_TOKEN_KEY), refresh_token: readStoredText(REFRESH_TOKEN_KEY) },
  persist(tokens) {
    for (const [key, value] of [[ACCESS_TOKEN_KEY, tokens.access_token], [REFRESH_TOKEN_KEY, tokens.refresh_token]]) {
      if (value) writeStoredValue(key, value);
      else removeStoredValue(key);
    }
  },
  async refresh(token, signal) {
    const response = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", [DEVICE_ID_HEADER]: getDeviceId() },
      body: JSON.stringify({ refresh_token: token, device_id: getDeviceId() }),
    });
    if (!response.ok) {
      const message = apiErrorDetail(await response.json().catch(() => null), "Authentication expired");
      if (response.status === 401 || response.status === 403) throw new AuthExpiredError(message);
      throw new ApiHttpError(response.status, message);
    }
    return response.json() as Promise<AuthTokenResponse>;
  },
  onExpired: notifyAuthExpired,
});

export class ApiHttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiHttpError";
    this.status = status;
  }
}

export function getStoredAccessToken() {
  return authSession.accessToken;
}

export function getStoredRefreshToken() {
  return authSession.refreshToken;
}

export function getDeviceId() {
  let deviceId = readStoredText(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = globalThis.crypto?.randomUUID?.() ?? `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    writeStoredValue(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

export function setAuthTokens(tokens: { access_token: string; refresh_token: string }) {
  authSession.replace(tokens);
  inflightGetRequests.clear();
}

export function getAuthSessionGeneration() { return authSession.generation; }

export function restoreAuthTokens(tokens: { access_token: string; refresh_token: string }, generation: number) {
  authSession.restore(tokens, generation);
}

export function clearAuthTokens() {
  authSession.clear();
  inflightGetRequests.clear();
}

export function notifyAuthExpired(message: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT, { detail: { message } }));
}

export function resolveAuthRecovery() { authSession.resolveRecovery(); }

export function rejectAuthRecovery(message = "Authentication required") { authSession.rejectRecovery(message); }

export function addAuthExpiredListener(listener: (message: string) => void) {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ message?: string }>).detail;
    listener(typeof detail?.message === "string" ? detail.message : "Authentication expired");
  };
  window.addEventListener(AUTH_EXPIRED_EVENT, handler);
  return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handler);
}

export function authHeaders(init?: RequestInit) {
  const headers = new Headers(init?.headers);
  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
  if (!isFormData && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  headers.set(DEVICE_ID_HEADER, getDeviceId());
  if (authSession.accessToken) headers.set("Authorization", `Bearer ${authSession.accessToken}`);
  return headers;
}

export function sessionSignal(signal?: AbortSignal | null) {
  return signal ? AbortSignal.any([signal, authSession.signal]) : authSession.signal;
}

/** Shared authentication boundary for JSON, blobs and both streaming protocols. */
export async function authenticatedFetch(path: string, init?: RequestInit, generation = authSession.generation): Promise<Response> {
  authSession.assertCurrent(generation);
  const signal = sessionSignal(init?.signal);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    signal.throwIfAborted();
    authSession.assertCurrent(generation);
    const access = authSession.accessToken;
    const response = await waitWithSignal(fetch(`${API_BASE}${path}`, { ...init, signal, headers: authHeaders(init) }), signal);
    authSession.assertCurrent(generation);
    if (response.status !== 401 || attempt > 0 || AUTH_RETRY_EXCLUDED_PATHS.has(path)) return response;
    await response.body?.cancel();
    await authSession.authorizeRetry(generation, access, signal);
  }
  throw new Error("Authentication required");
}

export function apiErrorDetail(body: unknown, fallback: string) {
  if (!body || typeof body !== "object") return fallback;
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const messages = detail.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item as { loc?: unknown; msg?: unknown };
      const message = typeof record.msg === "string" ? record.msg : "";
      if (!message) return [];
      const location = Array.isArray(record.loc)
        ? record.loc.filter((part) => part !== "body").map(String).join(" › ")
        : "";
      return [location ? `${location}: ${message}` : message];
    });
    if (messages.length) return messages.join("；");
  }
  if (detail && typeof detail === "object") {
    const message = (detail as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

export async function request<T>(path: string, init?: RequestInit, responseType: "json" | "blob" = "json"): Promise<T> {
  const generation = authSession.generation;
  const isGet = !init?.method || init.method === "GET";
  // Abortable requests own their lifetime and cannot share another caller's cancellation.
  const deduplicate = isGet && !init?.signal;
  const key = `${generation}:${responseType}:${path}`;
  if (deduplicate) {
    const existing = inflightGetRequests.get(key);
    if (existing) return existing as Promise<T>;
  }
  const run = async () => {
    const response = await authenticatedFetch(path, init, generation);
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new ApiHttpError(response.status, apiErrorDetail(body, response.statusText || "Request failed"));
    }
    const value = await (responseType === "blob" ? response.blob() : response.json());
    authSession.assertCurrent(generation);
    init?.signal?.throwIfAborted();
    return value as T;
  };
  const promise = run().finally(() => {
    if (inflightGetRequests.get(key) === promise) inflightGetRequests.delete(key);
  });
  if (deduplicate) inflightGetRequests.set(key, promise);
  return promise;
}
