import { request } from "@/lib/api/transport";
import type {
  RenderedImageFile,
  ToolListResponse
} from "@/types/app";

export function listTools() {
  return request<ToolListResponse>("/api/v1/tools");
}

export function getRenderedImage(artifactId: string, filename: RenderedImageFile, signal?: AbortSignal) {
  return request<Blob>(`/api/v1/tools/render-image/${encodeURIComponent(artifactId)}/${encodeURIComponent(filename)}`, { signal }, "blob");
}
