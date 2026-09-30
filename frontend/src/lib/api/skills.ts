import { request } from "@/lib/api/transport";
import type {
  ClawHubInstallResponse,
  ClawHubSearchResponse,
  ClawHubSkillDetail,
  SkillListResponse
} from "@/types/app";

// ── Skills ────────────────────────────────────────────────────────────────────

export function listSkills() {
  return request<SkillListResponse>("/api/v1/skills");
}

export function toggleSkill(name: string, enabled: boolean) {
  return request<{ status: string; name: string; enabled: boolean }>(
    `/api/v1/skills/${encodeURIComponent(name)}/toggle`,
    { method: "POST", body: JSON.stringify({ enabled }) },
  );
}

export function refreshSkills() {
  return request<{ status: string; total: number }>("/api/v1/skills/refresh", { method: "POST" });
}

export function deleteSkill(name: string) {
  return request<{ status: string; name: string; deleted_path: string }>(
    `/api/v1/skills/${encodeURIComponent(name)}`,
    { method: "DELETE" },
  );
}

export function searchClawHubSkills(query: string, limit = 20) {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  return request<ClawHubSearchResponse>(`/api/v1/skills/clawhub/search?${params.toString()}`);
}

export function getClawHubSkill(slug: string) {
  return request<ClawHubSkillDetail>(`/api/v1/skills/clawhub/${encodeURIComponent(slug)}`);
}

export function installClawHubSkill(slug: string, payload?: { version?: string | null; tag?: string | null }) {
  return request<ClawHubInstallResponse>(`/api/v1/skills/clawhub/${encodeURIComponent(slug)}/install`, {
    method: "POST",
    body: JSON.stringify({
      version: payload?.version || undefined,
      tag: payload?.tag || undefined,
    }),
  });
}
