import { API_BASE, authHeaders, authSession, clearAuthTokens, getDeviceId, request } from "@/lib/api/transport";
import type {
  AuthTokenResponse,
  AuthUser,
  ChangePasswordRequest,
  LoginDeviceHeartbeatResponse,
  LoginSessionListResponse,
  SetupStatusResponse,
  UserProfileUpdateRequest,
} from "@/types/app";

export function checkHealth() {
  return request<{ status: string }>("/api/v1/health");
}

export function getSetupStatus() {
  return request<SetupStatusResponse>("/api/v1/auth/setup/status");
}

export function setupAdmin(payload: { username: string; password: string; display_name?: string }) {
  return request<AuthTokenResponse>("/api/v1/auth/setup", {
    method: "POST",
    body: JSON.stringify({ ...payload, device_id: getDeviceId() }),
  });
}

export function login(payload: { username: string; password: string }) {
  return request<AuthTokenResponse>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ ...payload, device_id: getDeviceId() }),
  });
}

export function devLogin() {
  return request<AuthTokenResponse>("/api/v1/auth/dev-login", {
    method: "POST",
  });
}

export function getMe() {
  return request<AuthUser>("/api/v1/auth/me");
}

export function updateOwnProfile(payload: UserProfileUpdateRequest) {
  return request<AuthUser>("/api/v1/auth/me/profile", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function changeOwnPassword(payload: ChangePasswordRequest) {
  return request<{ status: string }>("/api/v1/auth/me/password", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function listLoginSessions(init?: RequestInit) {
  return request<LoginSessionListResponse>("/api/v1/auth/sessions", init);
}

export function revokeOtherLoginDevices() {
  return request<{ status: string; revoked_devices: number; revoked_sessions: number }>(
    "/api/v1/auth/sessions/revoke-others",
    { method: "POST" },
  );
}

export function heartbeatLoginDevice() {
  return request<LoginDeviceHeartbeatResponse>("/api/v1/auth/device/heartbeat", {
    method: "POST",
    body: JSON.stringify({ device_id: getDeviceId() }),
  });
}

export function revokeLoginSession(sessionId: string, userId?: string) {
  const query = userId ? `?user_id=${encodeURIComponent(userId)}` : "";
  return request<{ status: string; revoked_current: boolean }>(`/api/v1/auth/sessions/${encodeURIComponent(sessionId)}${query}`, {
    method: "DELETE",
  });
}

export function deleteLoginDevice(deviceId: string, userId?: string) {
  const query = userId ? `?user_id=${encodeURIComponent(userId)}` : "";
  return request<{ status: string; deleted: number; deleted_current: boolean }>(
    `/api/v1/auth/sessions/${encodeURIComponent(deviceId)}/device${query}`,
    { method: "DELETE" },
  );
}

export function deleteLoginRecord(deviceId: string, recordId: string, userId?: string) {
  const query = userId ? `?user_id=${encodeURIComponent(userId)}` : "";
  return request<{ status: string; deleted_current: boolean }>(
    `/api/v1/auth/sessions/${encodeURIComponent(deviceId)}/records/${encodeURIComponent(recordId)}${query}`,
    { method: "DELETE" },
  );
}

export async function logout() {
  const token = authSession.refreshToken;
  const headers = authHeaders();
  clearAuthTokens();
  if (token) {
    await fetch(`${API_BASE}/api/v1/auth/logout`, {
      method: "POST", headers, body: JSON.stringify({ refresh_token: token }),
    }).catch(() => null);
  }
}
