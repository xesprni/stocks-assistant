// ── Skills ────────────────────────────────────────────────────────────────────

export interface SkillInfo {
  name: string;
  description: string;
  enabled: boolean;
  file_path: string | null;
  source?: "builtin" | "custom" | "clawhub" | string | null;
  clawhub_slug?: string | null;
  clawhub_version?: string | null;
  clawhub_owner?: string | null;
  clawhub_url?: string | null;
}

export interface SkillListResponse {
  skills: SkillInfo[];
  total: number;
}

export interface ClawHubSearchResult {
  slug: string;
  name: string;
  summary: string;
  description: string;
  owner: string | null;
  version: string | null;
  updated_at: string | null;
  canonical_url: string | null;
  scan_status: string | null;
  moderation_status: string | null;
}

export interface ClawHubSearchResponse {
  results: ClawHubSearchResult[];
  total: number;
}

export interface ClawHubSkillDetail extends ClawHubSearchResult {
  scan: Record<string, unknown>;
  skill_md: string;
  preview_error: string | null;
  scan_error: string | null;
}

export interface ClawHubInstallResponse {
  status: string;
  message: string;
  installed_path: string;
  skill: SkillInfo;
}
