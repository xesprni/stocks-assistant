import { request } from "@/lib/api/transport";
import type {
  MemoryFile,
  MemoryFileContent,
  MemorySearchResult,
  MemoryStatus
} from "@/types/app";

// ── Memory ────────────────────────────────────────────────────────────────────

export function searchMemory(query: string, options?: { limit?: number; min_score?: number }) {
  const params = new URLSearchParams({ q: query });
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.min_score != null) params.set("min_score", String(options.min_score));
  return request<MemorySearchResult[]>(`/api/v1/memory/search?${params.toString()}`);
}

export function addMemory(content: string, options?: { scope?: string; source?: string }) {
  return request<{ status: string }>("/api/v1/memory/add", {
    method: "POST",
    body: JSON.stringify({ content, scope: options?.scope ?? "user", source: options?.source ?? "manual" }),
  });
}

export function syncMemory() {
  return request<{ status: string }>("/api/v1/memory/sync", { method: "POST" });
}

export function clearMemory() {
  return request<{ status: string; deleted_files: number; deleted_chunks: number; deleted_index_files: number }>(
    "/api/v1/memory/clear",
    { method: "DELETE" },
  );
}

export function getMemoryStatus() {
  return request<MemoryStatus>("/api/v1/memory/status");
}

export function listMemoryFiles() {
  return request<{ files: MemoryFile[] }>("/api/v1/memory/files");
}

export function getMemoryFile(path: string) {
  return request<MemoryFileContent>(`/api/v1/memory/files/${encodeURIComponent(path)}`);
}

export function deleteMemoryFile(path: string) {
  return request<{ status: string; deleted_file: boolean; deleted_chunks: number }>(
    `/api/v1/memory/files/${encodeURIComponent(path)}`,
    { method: "DELETE" },
  );
}

export function deleteMemoryIndex(path: string) {
  return request<{ status: string; deleted_file: boolean; deleted_chunks: number }>(
    `/api/v1/memory/index/${encodeURIComponent(path)}`,
    { method: "DELETE" },
  );
}
