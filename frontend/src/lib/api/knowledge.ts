import { request } from "@/lib/api/transport";
import type {
  KnowledgeFileContent,
  KnowledgeGraph,
  KnowledgeSaveResponse,
  KnowledgeTree
} from "@/types/app";

// ── Knowledge ─────────────────────────────────────────────────────────────────

export function getKnowledgeTree() {
  return request<{ tree: KnowledgeTree }>("/api/v1/knowledge/tree").then((res) => ({
    root_files: res.tree.root_files ?? [],
    tree: res.tree.tree ?? [],
    stats: res.tree.stats ?? { pages: 0, size: 0 },
    enabled: res.tree.enabled ?? true,
  }));
}

export function getKnowledgeFile(path: string) {
  const params = new URLSearchParams({ path });
  return request<KnowledgeFileContent>(`/api/v1/knowledge/read?${params.toString()}`);
}

export function getKnowledgeGraph() {
  return request<KnowledgeGraph>("/api/v1/knowledge/graph");
}

export function saveKnowledgeFile(payload: { filename: string; content: string; directory?: string }) {
  return request<KnowledgeSaveResponse>("/api/v1/knowledge/files", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function uploadKnowledgeFile(file: File, directory?: string) {
  const content = await file.text();
  return saveKnowledgeFile({ filename: file.name, content, directory });
}

export function saveKnowledgeUrl(payload: { url: string; filename?: string; directory?: string }) {
  return request<KnowledgeSaveResponse>("/api/v1/knowledge/url", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
